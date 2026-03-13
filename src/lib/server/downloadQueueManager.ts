import { checkAlbumInLibrary, checkTrackInLibrary } from './mediaLibrary';
import {
	buildQueueMetrics,
	categorizeError,
	isDuplicateJobMatch,
	resetTrackProgressForRetry,
	selectNextQueuedJob,
	shouldCleanupJob,
	summarizeQueueStats
} from './downloadQueuePolicy';
import {
	clearQueueJobProcessing,
	getLocalRetentionConfig,
	getProcessingJobsSnapshot,
	getQueueSnapshotFromRepository,
	markQueueJobProcessing,
	patchQueueJob,
	readQueueJob,
	recoverQueueStorage,
	removeQueueJob,
	removeQueueJobs,
	writeQueueJob
} from './downloadQueueRepository';
import type {
	AlbumJob,
	DownloadJob,
	JobPriority,
	QueueMetrics,
	QueuedJob,
	QueueSource,
	QueueStats,
	TrackJob
} from './downloadQueueTypes';

export type {
	AlbumJob,
	CategorizedError,
	DownloadJob,
	ErrorCategory,
	JobPriority,
	JobStatus,
	JobType,
	QueueSource,
	QueuedJob,
	TrackJob
} from './downloadQueueTypes';
export { categorizeError } from './downloadQueuePolicy';

/**
 * Initialize queue system: clean up stale processing jobs from crashes
 */
export async function initializeQueue(): Promise<void> {
	console.log('[Queue] Initializing...');
	const recovery = await recoverQueueStorage();
	if (recovery.recovered > 0) {
		console.log(`[Queue] Recovered ${recovery.recovered} jobs from crash`);
	}
	console.log('[Queue] Initialization complete');
}

async function isJobAlreadyInLocalLibrary(job: DownloadJob): Promise<{
	exists: boolean;
	detail?: string;
	matchedTracks?: number;
}> {
	try {
		if (job.type === 'album') {
			const result = await checkAlbumInLibrary({
				artistName: job.artistName,
				albumTitle: job.albumTitle,
				expectedTrackCount: job.trackCount
			});
			return {
				exists: result.exists,
				detail: result.exists ? 'Album already present in local library' : undefined,
				matchedTracks: result.matchedTracks
			};
		}
		const result = await checkTrackInLibrary({
			artistName: job.artistName,
			albumTitle: job.albumTitle,
			trackTitle: job.trackTitle
		});
		return {
			exists: result.exists,
			detail: result.exists ? 'Track already present in local library' : undefined
		};
	} catch (error) {
		console.warn('[Queue] Local media check failed:', error);
		return { exists: false };
	}
}

/**
 * Get a snapshot of the queue with source info.
 */
export async function getQueueSnapshot(): Promise<{
	jobs: QueuedJob[];
	source: QueueSource;
	warning?: string;
}> {
	return getQueueSnapshotFromRepository();
}

/**
 * Add a job to the queue with duplicate detection
 */
export async function enqueueJob(
	job: DownloadJob,
	options?: {
		priority?: JobPriority;
		maxRetries?: number;
		checkDuplicate?: boolean;
		forceOverwrite?: boolean;
	}
): Promise<string> {
	const now = Date.now();
	const forceOverwrite =
		options?.forceOverwrite === true ||
		(job.type === 'album' && job.forceOverwrite === true) ||
		(job.type === 'track' && job.forceOverwrite === true);

	if (options?.checkDuplicate !== false && !forceOverwrite) {
		const library = await isJobAlreadyInLocalLibrary(job);
		if (library.exists) {
			const existingLibraryJob = (await getAllJobs()).find((entry) => {
				if (entry.status !== 'completed') return false;
				if (entry.job.type !== job.type) return false;
				if (job.type === 'album' && entry.job.type === 'album') {
					return entry.job.albumId === job.albumId && entry.job.quality === job.quality;
				}
				if (job.type === 'track' && entry.job.type === 'track') {
					return entry.job.trackId === job.trackId && entry.job.quality === job.quality;
				}
				return false;
			});
			if (existingLibraryJob) {
				return existingLibraryJob.id;
			}

			const libraryJobId = `job-${now}-${Math.random().toString(36).slice(2, 11)}`;
			const completedLibraryJob: QueuedJob = {
				id: libraryJobId,
				job,
				status: 'completed',
				progress: 1,
				createdAt: now,
				completedAt: now,
				lastUpdatedAt: now,
				error: library.detail,
				priority: options?.priority || 'normal',
				maxRetries: options?.maxRetries ?? 3,
				retryCount: 0,
				trackCount: job.type === 'album' ? job.trackCount : undefined,
				completedTracks:
					job.type === 'album' ? (library.matchedTracks ?? job.trackCount) : undefined
			};

			const source = await writeQueueJob(completedLibraryJob);
			console.log(
				source === 'redis'
					? `[Queue] Skipped ${job.type} job; already in local library (${libraryJobId})`
					: `[Queue] Skipped ${job.type} job in memory; already in local library (${libraryJobId})`
			);
			return libraryJobId;
		}
	}

	// Duplicate detection
	if (options?.checkDuplicate !== false) {
		const duplicate = await findDuplicateJob(job);
		if (duplicate) {
			console.log(`[Queue] Duplicate job found: ${duplicate.id} (status: ${duplicate.status})`);
			// If duplicate is queued or processing, return existing job ID
			if (
				duplicate.status === 'queued' ||
				duplicate.status === 'processing' ||
				duplicate.status === 'paused'
			) {
				return duplicate.id;
			}
			// If duplicate failed and is retryable, requeue it
			if (
				duplicate.status === 'failed' &&
				duplicate.errorCategory &&
				['network', 'rate_limit', 'server_error', 'unknown'].includes(duplicate.errorCategory)
			) {
				await updateJobStatus(duplicate.id, {
					status: 'queued',
					progress: 0,
					error: undefined,
					failureCode: undefined,
					retryCount: (duplicate.retryCount || 0) + 1,
					nextRetryAt: undefined,
					cancellationRequested: false,
					pauseRequested: false
				});
				console.log(`[Queue] Requeued failed job: ${duplicate.id}`);
				return duplicate.id;
			}
		}
	}

	const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

	const queuedJob: QueuedJob = {
		id: jobId,
		job,
		status: 'queued',
		progress: 0,
		createdAt: Date.now(),
		priority: options?.priority || 'normal',
		maxRetries: options?.maxRetries ?? 3,
		retryCount: 0,
		trackCount: job.type === 'album' ? job.trackCount : undefined
	};

	const source = await writeQueueJob(queuedJob);
	console.log(
		source === 'redis'
			? `[Queue] Job ${jobId} enqueued (${job.type})`
			: `[Queue] Job ${jobId} enqueued in memory (${job.type})`
	);
	return jobId;
}

/**
 * Find duplicate job (same type and ID)
 */
export async function findDuplicateJob(job: DownloadJob): Promise<QueuedJob | null> {
	const jobs = await getAllJobs();
	for (const existingJob of jobs) {
		if (isDuplicateJobMatch(existingJob, job)) {
			return existingJob;
		}
	}

	return null;
}

/**
 * Get next job from queue (with priority and retry logic)
 */
export async function dequeueJob(): Promise<QueuedJob | null> {
	const now = Date.now();
	const snapshot = await getQueueSnapshotFromRepository();
	const job = selectNextQueuedJob(snapshot.jobs, getProcessingJobsSnapshot(), now);
	if (job) {
		markQueueJobProcessing(job.id);
		return job;
	}

	return null;
}

/**
 * Update job status
 */
export async function updateJobStatus(jobId: string, updates: Partial<QueuedJob>): Promise<void> {
	const result = await patchQueueJob(jobId, updates);
	if (result?.job.status !== 'processing') {
		clearQueueJobProcessing(jobId);
	}
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string): Promise<QueuedJob | null> {
	return readQueueJob(jobId);
}

/**
 * Get all jobs
 */
export async function getAllJobs(): Promise<QueuedJob[]> {
	const snapshot = await getQueueSnapshot();
	return snapshot.jobs;
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
	queued: number;
	processing: number;
	paused: number;
	completed: number;
	failed: number;
	total: number;
}> {
	const { jobs } = await getQueueSnapshot();
	return summarizeQueueStats(jobs);
}

/**
 * List queue job IDs that should be treated as active for library maintenance safety checks.
 * Includes queued/processing jobs and delayed retries.
 */
export async function getActiveJobIdsForMaintenance(now = Date.now()): Promise<string[]> {
	const jobs = await getAllJobs();
	const active = new Set<string>();
	for (const job of jobs) {
		if (!job?.id) continue;
		if (job.status === 'queued' || job.status === 'processing') {
			active.add(job.id);
			continue;
		}
		if (typeof job.nextRetryAt === 'number' && job.nextRetryAt > now) {
			active.add(job.id);
		}
	}
	return Array.from(active);
}

/**
 * Clear completed/failed jobs older than specified time
 */
export async function cleanupOldJobs(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
	const now = Date.now();
	const jobs = await getAllJobs();
	const retentionConfig = getLocalRetentionConfig();
	const completedRetention = retentionConfig.localModeEnabled
		? retentionConfig.completedMs
		: olderThanMs;
	const failedRetention = retentionConfig.localModeEnabled ? retentionConfig.failedMs : olderThanMs;
	const cancelledRetention = retentionConfig.localModeEnabled
		? retentionConfig.cancelledMs
		: olderThanMs;
	const pausedRetention = retentionConfig.localModeEnabled ? retentionConfig.pausedMs : olderThanMs;
	const jobIdsToDelete: string[] = [];

	for (const job of jobs) {
		if (
			shouldCleanupJob(job, now, {
				completedMs: completedRetention,
				failedMs: failedRetention,
				cancelledMs: cancelledRetention,
				pausedMs: pausedRetention
			})
		) {
			jobIdsToDelete.push(job.id);
		}
	}

	const cleaned = await removeQueueJobs(jobIdsToDelete);

	if (cleaned > 0) {
		console.log(
			`[Queue] Cleaned up ${cleaned} old jobs (older than ${Math.round(olderThanMs / 1000)}s)`
		);
	}
	return cleaned;
}

/**
 * Delete a job from the queue (permanent removal, for failed jobs marked for deletion)
 */
export async function deleteJob(jobId: string): Promise<boolean> {
	const result = await removeQueueJob(jobId);
	if (!result.deleted) {
		return false;
	}
	console.log(
		result.source === 'redis'
			? `[Queue] Job ${jobId} permanently deleted`
			: `[Queue] Job ${jobId} deleted from memory`
	);
	return true;
}

/**
 * Request cancellation of a job (safe to call on any status)
 */
export async function requestCancellation(jobId: string): Promise<boolean> {
	const job = await getJob(jobId);
	if (!job) return false;

	// If not yet processing, mark as cancelled immediately
	if (job.status === 'queued' || job.status === 'paused') {
		await updateJobStatus(jobId, {
			status: 'cancelled',
			cancellationRequested: true,
			pauseRequested: false,
			completedAt: Date.now()
		});
		clearQueueJobProcessing(jobId);
		console.log(`[Queue] Job ${jobId} cancelled (was ${job.status})`);
		return true;
	}

	// If processing, flag for cancellation (worker will check this)
	if (job.status === 'processing') {
		await updateJobStatus(jobId, {
			cancellationRequested: true,
			pauseRequested: false
		});
		console.log(`[Queue] Cancellation requested for job ${jobId} (currently processing)`);
		return true;
	}

	return false;
}

/**
 * Pause a queued job, or request pause for processing jobs.
 */
export async function requestPause(jobId: string): Promise<boolean> {
	const job = await getJob(jobId);
	if (!job) return false;

	if (job.status === 'queued') {
		await updateJobStatus(jobId, {
			status: 'paused',
			pauseRequested: true,
			cancellationRequested: false
		});
		clearQueueJobProcessing(jobId);
		return true;
	}

	if (job.status === 'processing') {
		await updateJobStatus(jobId, {
			pauseRequested: true
		});
		return true;
	}

	return false;
}

/**
 * Resume a paused job.
 */
export async function requestResume(jobId: string): Promise<boolean> {
	const job = await getJob(jobId);
	if (!job) return false;
	if (job.status !== 'paused') return false;

	await updateJobStatus(jobId, {
		status: 'queued',
		progress: 0,
		error: undefined,
		nextRetryAt: undefined,
		pauseRequested: false,
		cancellationRequested: false
	});
	return true;
}

/**
 * Request a manual retry for a failed/cancelled job.
 * This re-queues the same job payload and clears failure state.
 */
export async function requestRetry(jobId: string): Promise<boolean> {
	const job = await getJob(jobId);
	if (!job) {
		return false;
	}

	if (job.status !== 'failed' && job.status !== 'cancelled' && job.status !== 'paused') {
		return false;
	}

	await updateJobStatus(jobId, {
		status: 'queued',
		progress: 0,
		error: undefined,
		errorCategory: undefined,
		failureCode: undefined,
		completedAt: undefined,
		startedAt: undefined,
		downloadTimeMs: undefined,
		fileSize: undefined,
		lastError: undefined,
		nextRetryAt: undefined,
		cancellationRequested: false,
		pauseRequested: false,
		retryCount: 0,
		completedTracks: 0,
		trackProgress: resetTrackProgressForRetry(job.trackProgress),
		fallbackHistory: []
	});

	clearQueueJobProcessing(jobId);
	console.log(`[Queue] Job ${jobId} manually re-queued`);
	return true;
}

/**
 * Cleanup stuck jobs in 'processing' state > timeout
 */
export async function cleanupStuckJobs(timeoutMs: number = 300000): Promise<number> {
	const now = Date.now();
	const jobs = await getAllJobs();
	let cleaned = 0;

	for (const job of jobs) {
		if (job.status === 'processing' && job.startedAt) {
			const lastUpdate = job.lastUpdatedAt ?? job.startedAt;
			const processingTime = now - lastUpdate;

			if (processingTime > timeoutMs) {
				const minutes = Math.round(processingTime / 60000);
				const duration =
					processingTime > 120000 ? `${minutes}m` : `${Math.round(processingTime / 1000)}s`;

				await updateJobStatus(job.id, {
					status: 'failed',
					error: `Job stuck in processing for ${duration}, likely crashed`,
					errorCategory: 'unknown',
					completedAt: Date.now()
				});

				clearQueueJobProcessing(job.id);
				cleaned++;
				console.log(`[Queue] Cleaned up stuck job ${job.id} (stuck for ${duration})`);
			}
		}
	}

	if (cleaned > 0) {
		console.log(`[Queue] Cleaned up ${cleaned} stuck jobs`);
	}
	return cleaned;
}

/**
 * Get metrics and analytics
 */
export async function getMetrics(): Promise<{
	total_jobs: number;
	queued: number;
	processing: number;
	paused: number;
	completed: number;
	failed: number;
	cancelled: number;
	avg_success_rate: number; // percentage
	avg_retry_count: number;
	total_download_time_ms: number;
	avg_job_duration_ms: number;
	failure_by_code: Record<string, number>;
}> {
	const jobs = await getAllJobs();
	return buildQueueMetrics(jobs);
}
