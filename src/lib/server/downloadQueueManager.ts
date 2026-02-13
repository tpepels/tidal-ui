/**
 * Server-side download queue manager
 * Manages background download jobs that run independently of browser sessions
 */

import type { AudioQuality } from '$lib/types';
import { getConnectedRedis } from './redis';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { checkAlbumInLibrary, checkTrackInLibrary } from './mediaLibrary';

/**
 * Initialize queue system: clean up stale processing jobs from crashes
 */
export async function initializeQueue(): Promise<void> {
	console.log('[Queue] Initializing...');
	const client = await getConnectedRedis();

	if (client) {
		try {
			const jobs = await client.hgetall(QUEUE_KEY);
			let recovered = 0;

			for (const [jobId, value] of Object.entries(jobs)) {
				const job = JSON.parse(value) as QueuedJob;
				
				if (job.status === 'processing') {
					console.log(`[Queue] Recovering job ${jobId} from crash (was processing)`);
					// Re-queue jobs so local long-running downloads can resume after restart.
					await client.hset(
						QUEUE_KEY,
						jobId,
						JSON.stringify({
							...job,
							status: 'queued' as const,
							progress: 0,
							error: undefined,
							lastError: 'Recovered after server restart while processing',
							startedAt: undefined,
							completedAt: undefined,
							lastUpdatedAt: Date.now(),
							cancellationRequested: false,
							pauseRequested: false,
							nextRetryAt: Date.now() + 1000
						})
					);
					recovered++;
				}
			}

			if (recovered > 0) {
				console.log(`[Queue] Recovered ${recovered} jobs from crash`);
			}
		} catch (err) {
			console.warn('[Queue] Initialization error:', err);
		}
	} else {
		await loadMemoryQueueFromDisk();
	}

	console.log('[Queue] Initialization complete');
}

export type JobType = 'track' | 'album';
export type JobStatus =
	| 'queued'
	| 'processing'
	| 'paused'
	| 'completed'
	| 'failed'
	| 'cancelled';
export type JobPriority = 'low' | 'normal' | 'high';
export type ErrorCategory = 'network' | 'api_error' | 'rate_limit' | 'auth' | 'not_found' | 'server_error' | 'unknown';
export type QueueSource = 'redis' | 'memory';

/**
 * Error categorization for retry logic
 */
export interface CategorizedError {
	category: ErrorCategory;
	isRetryable: boolean;
	retryAfterMs?: number; // For rate limiting
	message: string;
}

/**
 * Categorize errors to determine if they're retryable
 */
export function categorizeError(error: string | Error, statusCode?: number): CategorizedError {
	const message = error instanceof Error ? error.message : error;
	const lowerMsg = message.toLowerCase();
	
	// Rate limiting
	if (statusCode === 429 || lowerMsg.includes('rate limit') || lowerMsg.includes('too many requests')) {
		return {
			category: 'rate_limit',
			isRetryable: true,
			retryAfterMs: 60000, // Wait 1 minute
			message
		};
	}
	
	// Network errors (usually retryable)
	if (lowerMsg.includes('timeout') || lowerMsg.includes('econnrefused') || 
	    lowerMsg.includes('enotfound') || lowerMsg.includes('network')) {
		return {
			category: 'network',
			isRetryable: true,
			retryAfterMs: 5000, // Wait 5 seconds
			message
		};
	}
	
	// Authentication errors (not retryable without fixing config)
	if (statusCode === 401 || statusCode === 403 || lowerMsg.includes('unauthorized') || lowerMsg.includes('forbidden')) {
		return {
			category: 'auth',
			isRetryable: false,
			message
		};
	}
	
	// Not found (not retryable)
	if (statusCode === 404 || lowerMsg.includes('not found')) {
		return {
			category: 'not_found',
			isRetryable: false,
			message
		};
	}
	
	// Server errors (retryable with backoff)
	if (statusCode && statusCode >= 500) {
		return {
			category: 'server_error',
			isRetryable: true,
			retryAfterMs: 30000, // Wait 30 seconds
			message
		};
	}
	
	// API errors (might be retryable)
	if (statusCode && statusCode >= 400) {
		return {
			category: 'api_error',
			isRetryable: false, // Most 4xx errors are not retryable
			message
		};
	}
	
	// Unknown errors - cautiously mark as retryable
	return {
		category: 'unknown',
		isRetryable: true,
		retryAfterMs: 10000,
		message
	};
}

export interface TrackJob {
	type: 'track';
	trackId: number;
	quality: AudioQuality;
	albumTitle?: string;
	artistName?: string;
	trackTitle?: string;
	trackNumber?: number;
	coverUrl?: string;
}

export interface AlbumJob {
	type: 'album';
	albumId: number;
	quality: AudioQuality;
	albumTitle?: string;
	artistName?: string;
	trackCount?: number;
}

export type DownloadJob = TrackJob | AlbumJob;

export interface QueuedJob {
	id: string;
	job: DownloadJob;
	status: JobStatus;
	progress: number; // 0-1
	error?: string;
	errorCategory?: ErrorCategory;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	lastUpdatedAt?: number;
	trackCount?: number; // For albums
	completedTracks?: number; // For albums
	// Retry logic
	retryCount?: number;
	maxRetries?: number;
	nextRetryAt?: number;
	lastError?: string;
	// Prioritization
	priority?: JobPriority;
	// Cancellation
	cancellationRequested?: boolean;
	pauseRequested?: boolean;
	// Per-track progress (album jobs)
	trackProgress?: Array<{
		trackId: number;
		trackTitle?: string;
		status: 'pending' | 'downloading' | 'completed' | 'failed';
		error?: string;
	}>;
	// Metrics
	downloadTimeMs?: number;
	fileSize?: number;
	fallbackHistory?: AudioQuality[];
}

// In-memory queue (falls back when Redis unavailable)
const memoryQueue = new Map<string, QueuedJob>();
const processingJobs = new Set<string>();

const QUEUE_KEY = 'tidal:downloadQueue';
const QUEUE_STATE_FILE = path.join(process.cwd(), 'data', 'download-queue-state.v1.json');
const LOCAL_MODE_ENABLED = process.env.LOCAL_MODE !== 'false';
const LOCAL_MODE_HIDE_MULTI_PROCESS_WARNING = LOCAL_MODE_ENABLED;
const LOCAL_COMPLETED_RETENTION_MS =
	Math.max(60_000, Number(process.env.LOCAL_COMPLETED_RETENTION_MS || 30 * 60 * 1000));
const LOCAL_CANCELLED_RETENTION_MS =
	Math.max(60_000, Number(process.env.LOCAL_CANCELLED_RETENTION_MS || 6 * 60 * 60 * 1000));
const LOCAL_FAILED_RETENTION_MS = Math.max(
	60_000,
	Number(process.env.LOCAL_FAILED_RETENTION_MS || 7 * 24 * 60 * 60 * 1000)
);
const LOCAL_PAUSED_RETENTION_MS = Math.max(
	60_000,
	Number(process.env.LOCAL_PAUSED_RETENTION_MS || 14 * 24 * 60 * 60 * 1000)
);

let memoryStateLoaded = false;

async function saveMemoryQueueToDisk(): Promise<void> {
	try {
		await fs.mkdir(path.dirname(QUEUE_STATE_FILE), { recursive: true });
		const entries = Array.from(memoryQueue.values()).sort((a, b) => a.createdAt - b.createdAt);
		await fs.writeFile(
			QUEUE_STATE_FILE,
			JSON.stringify(
				{
					version: 1,
					savedAt: Date.now(),
					jobs: entries
				},
				null,
				2
			)
		);
	} catch (error) {
		console.warn('[Queue] Failed to persist memory queue state:', error);
	}
}

async function loadMemoryQueueFromDisk(): Promise<void> {
	if (memoryStateLoaded) {
		return;
	}
	memoryStateLoaded = true;
	try {
		const raw = await fs.readFile(QUEUE_STATE_FILE, 'utf8');
		const payload = JSON.parse(raw) as { version?: number; jobs?: QueuedJob[] };
		if (!payload || payload.version !== 1 || !Array.isArray(payload.jobs)) {
			return;
		}
		const now = Date.now();
		for (const job of payload.jobs) {
			if (!job || typeof job !== 'object' || typeof job.id !== 'string') {
				continue;
			}
			// Processing jobs cannot be resumed safely after restart; keep them actionable.
			if (job.status === 'processing') {
				memoryQueue.set(job.id, {
					...job,
					status: 'queued',
					progress: 0,
					error: undefined,
					lastError:
						job.lastError ??
						job.error ??
						'Recovered after restart while processing',
					completedAt: undefined,
					lastUpdatedAt: now,
					startedAt: undefined,
					cancellationRequested: false,
					pauseRequested: false,
					nextRetryAt: now + 1000
				});
				continue;
			}
			memoryQueue.set(job.id, job);
		}
		if (memoryQueue.size > 0) {
			console.log(`[Queue] Restored ${memoryQueue.size} job(s) from local queue state`);
		}
	} catch {
		// No persisted state yet.
	}
}

async function persistMemoryQueueIfNeeded(usingRedis: boolean): Promise<void> {
	if (usingRedis) {
		return;
	}
	await saveMemoryQueueToDisk();
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

function getRedisWarning(): string {
	if (LOCAL_MODE_HIDE_MULTI_PROCESS_WARNING) {
		return '';
	}
	return 'Redis unavailable or disabled; using in-memory queue. If the worker runs in a separate process, the UI may not reflect active jobs.';
}

/**
 * Get a snapshot of the queue with source info.
 */
export async function getQueueSnapshot(): Promise<{
	jobs: QueuedJob[];
	source: QueueSource;
	warning?: string;
}> {
	const client = await getConnectedRedis();
	if (client) {
		try {
			const jobs = await client.hgetall(QUEUE_KEY);
			return {
				jobs: Object.values(jobs).map((value) => JSON.parse(value) as QueuedJob),
				source: 'redis'
			};
		} catch (err) {
			console.warn('[Queue] Redis getAll failed:', err);
		}
	}

	await loadMemoryQueueFromDisk();
	const warning = getRedisWarning();

	return {
		jobs: Array.from(memoryQueue.values()),
		source: 'memory',
		warning: warning || undefined
	};
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
	}
): Promise<string> {
	const now = Date.now();

	if (options?.checkDuplicate !== false) {
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
				completedTracks: job.type === 'album' ? library.matchedTracks ?? job.trackCount : undefined
			};

			const client = await getConnectedRedis();
			if (client) {
				try {
					await client.hset(QUEUE_KEY, libraryJobId, JSON.stringify(completedLibraryJob));
					console.log(`[Queue] Skipped ${job.type} job; already in local library (${libraryJobId})`);
					return libraryJobId;
				} catch (err) {
					console.warn('[Queue] Redis save failed for library-skip job, using memory:', err);
				}
			}

			await loadMemoryQueueFromDisk();
			memoryQueue.set(libraryJobId, completedLibraryJob);
			await persistMemoryQueueIfNeeded(false);
			console.log(`[Queue] Skipped ${job.type} job in memory; already in local library (${libraryJobId})`);
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
			if (duplicate.status === 'failed' && duplicate.errorCategory && 
			    ['network', 'rate_limit', 'server_error', 'unknown'].includes(duplicate.errorCategory)) {
				await updateJobStatus(duplicate.id, {
					status: 'queued',
					progress: 0,
					error: undefined,
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

	const client = await getConnectedRedis();
	if (client) {
		try {
			await client.hset(QUEUE_KEY, jobId, JSON.stringify(queuedJob));
			console.log(`[Queue] Job ${jobId} enqueued (${job.type})`);
			return jobId;
		} catch (err) {
			console.warn('[Queue] Redis enqueue failed, using memory:', err);
		}
	}

	// Fallback to memory
	await loadMemoryQueueFromDisk();
	memoryQueue.set(jobId, queuedJob);
	await persistMemoryQueueIfNeeded(false);
	console.log(`[Queue] Job ${jobId} enqueued in memory (${job.type})`);
	return jobId;
}

/**
 * Find duplicate job (same type and ID)
 */
export async function findDuplicateJob(job: DownloadJob): Promise<QueuedJob | null> {
	const jobs = await getAllJobs();
	const now = Date.now();
	
	for (const existingJob of jobs) {
		// Skip old completed jobs (older than 1 hour)
		if (existingJob.status === 'completed' && existingJob.completedAt && 
		    (now - existingJob.completedAt) > 3600000) {
			continue;
		}
		
		// Check if same type and ID
		if (existingJob.job.type === job.type) {
			if (job.type === 'track' && existingJob.job.type === 'track') {
				if (existingJob.job.trackId === job.trackId && 
				    existingJob.job.quality === job.quality) {
					return existingJob;
				}
			} else if (job.type === 'album' && existingJob.job.type === 'album') {
				if (existingJob.job.albumId === job.albumId && 
				    existingJob.job.quality === job.quality) {
					return existingJob;
				}
			}
		}
	}
	
	return null;
}

/**
 * Get next job from queue (with priority and retry logic)
 */
export async function dequeueJob(): Promise<QueuedJob | null> {
	const client = await getConnectedRedis();
	const now = Date.now();

	if (client) {
		try {
			const jobs = await client.hgetall(QUEUE_KEY);
			const priorityMap = { high: 3, normal: 2, low: 1 };
			
			const queuedJobs = Object.entries(jobs)
				.map(([, value]) => JSON.parse(value) as QueuedJob)
				.filter(j => {
					// Skip if already processing
					if (processingJobs.has(j.id)) return false;
					// Skip if cancellation requested
					if (j.cancellationRequested) return false;
					// Only queued jobs
					if (j.status !== 'queued') return false;
					// Check retry timing
					if (j.nextRetryAt && j.nextRetryAt > now) return false;
					return true;
				})
				// Sort by priority (high to low) then by creation time (oldest first)
				.sort((a, b) => {
					const priorityDiff = priorityMap[b.priority || 'normal'] - priorityMap[a.priority || 'normal'];
					if (priorityDiff !== 0) return priorityDiff;
					return a.createdAt - b.createdAt;
				});
			
			if (queuedJobs.length > 0) {
				const job = queuedJobs[0];
				processingJobs.add(job.id);
				return job;
			}
			return null;
		} catch (err) {
			console.warn('[Queue] Redis dequeue failed:', err);
		}
	}

	// Fallback to memory
	await loadMemoryQueueFromDisk();
	const priorityMap = { high: 3, normal: 2, low: 1 };
	const availableJobs = Array.from(memoryQueue.values())
		.filter(j => {
			if (processingJobs.has(j.id)) return false;
			if (j.cancellationRequested) return false;
			if (j.status !== 'queued') return false;
			if (j.nextRetryAt && j.nextRetryAt > now) return false;
			return true;
		})
		.sort((a, b) => {
			const priorityDiff = priorityMap[b.priority || 'normal'] - priorityMap[a.priority || 'normal'];
			if (priorityDiff !== 0) return priorityDiff;
			return a.createdAt - b.createdAt;
		});
		
	if (availableJobs.length > 0) {
		const job = availableJobs[0];
		processingJobs.add(job.id);
		return job;
	}
	
	return null;
}

/**
 * Update job status
 */
export async function updateJobStatus(
	jobId: string, 
	updates: Partial<QueuedJob>
): Promise<void> {
	const client = await getConnectedRedis();
	const stampedUpdates = { ...updates, lastUpdatedAt: Date.now() };
	
	if (client) {
		try {
			const existing = await client.hget(QUEUE_KEY, jobId);
			if (existing) {
				const job = JSON.parse(existing) as QueuedJob;
				const updated = { ...job, ...stampedUpdates };
				await client.hset(QUEUE_KEY, jobId, JSON.stringify(updated));
				
				// Remove from processing set for any non-processing terminal or queued state transition.
				if (updated.status && updated.status !== 'processing') {
					processingJobs.delete(jobId);
				}
				return;
			}
		} catch (err) {
			console.warn('[Queue] Redis update failed:', err);
		}
	}

	// Fallback to memory
	await loadMemoryQueueFromDisk();
	const job = memoryQueue.get(jobId);
	if (job) {
		Object.assign(job, stampedUpdates);
		if (job.status !== 'processing') {
			processingJobs.delete(jobId);
		}
		await persistMemoryQueueIfNeeded(false);
	}
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string): Promise<QueuedJob | null> {
	const client = await getConnectedRedis();
	
	if (client) {
		try {
			const data = await client.hget(QUEUE_KEY, jobId);
			if (data) {
				return JSON.parse(data) as QueuedJob;
			}
		} catch (err) {
			console.warn('[Queue] Redis get failed:', err);
		}
	}

	// Fallback to memory
	await loadMemoryQueueFromDisk();
	return memoryQueue.get(jobId) || null;
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
	return {
		queued: jobs.filter(j => j.status === 'queued').length,
		processing: jobs.filter(j => j.status === 'processing').length,
		paused: jobs.filter(j => j.status === 'paused').length,
		completed: jobs.filter(j => j.status === 'completed').length,
		failed: jobs.filter(j => j.status === 'failed').length,
		total: jobs.length
	};
}

/**
 * Clear completed/failed jobs older than specified time
 */
export async function cleanupOldJobs(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
	const now = Date.now();
	const jobs = await getAllJobs();
	let cleaned = 0;

	const client = await getConnectedRedis();
	const completedRetention = LOCAL_MODE_ENABLED ? LOCAL_COMPLETED_RETENTION_MS : olderThanMs;
	const failedRetention = LOCAL_MODE_ENABLED ? LOCAL_FAILED_RETENTION_MS : olderThanMs;
	const cancelledRetention = LOCAL_MODE_ENABLED ? LOCAL_CANCELLED_RETENTION_MS : olderThanMs;
	const pausedRetention = LOCAL_MODE_ENABLED ? LOCAL_PAUSED_RETENTION_MS : olderThanMs;
	
	for (const job of jobs) {
		const endedAt = job.completedAt ?? job.lastUpdatedAt ?? job.startedAt ?? job.createdAt;
		const ageMs = now - endedAt;
		const shouldClean =
			(job.status === 'completed' && ageMs > completedRetention) ||
			(job.status === 'failed' && ageMs > failedRetention) ||
			(job.status === 'cancelled' && ageMs > cancelledRetention) ||
			(job.status === 'paused' && ageMs > pausedRetention);
		
		if (shouldClean) {
			if (client) {
				try {
					await client.hdel(QUEUE_KEY, job.id);
					cleaned++;
				} catch (err) {
					console.warn('[Queue] Redis cleanup failed:', err);
				}
			} else {
				memoryQueue.delete(job.id);
				cleaned++;
			}
		}
	}

	if (!client && cleaned > 0) {
		await persistMemoryQueueIfNeeded(false);
	}

	if (cleaned > 0) {
		console.log(`[Queue] Cleaned up ${cleaned} old jobs (older than ${Math.round(olderThanMs / 1000)}s)`);
	}
	return cleaned;
}

/**
 * Delete a job from the queue (permanent removal, for failed jobs marked for deletion)
 */
export async function deleteJob(jobId: string): Promise<boolean> {
	const client = await getConnectedRedis();
	
	if (client) {
		try {
			const result = await client.hdel(QUEUE_KEY, jobId);
			if (result > 0) {
				console.log(`[Queue] Job ${jobId} permanently deleted`);
				return true;
			}
		} catch (err) {
			console.warn('[Queue] Redis delete failed:', err);
		}
	}

	// Fallback to memory
	await loadMemoryQueueFromDisk();
	if (memoryQueue.has(jobId)) {
		memoryQueue.delete(jobId);
		await persistMemoryQueueIfNeeded(false);
		console.log(`[Queue] Job ${jobId} deleted from memory`);
		return true;
	}
	
	return false;
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
		processingJobs.delete(jobId);
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
		processingJobs.delete(jobId);
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

function resetTrackProgressForRetry(
	trackProgress: QueuedJob['trackProgress']
): QueuedJob['trackProgress'] | undefined {
	if (!trackProgress || !Array.isArray(trackProgress)) {
		return undefined;
	}
	return trackProgress.map((track) => ({
		...track,
		status: 'pending',
		error: undefined
	}));
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

	processingJobs.delete(jobId);
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
				const duration = processingTime > 120000 ? `${minutes}m` : `${Math.round(processingTime / 1000)}s`;
				
				await updateJobStatus(job.id, {
					status: 'failed',
					error: `Job stuck in processing for ${duration}, likely crashed`,
					errorCategory: 'unknown',
					completedAt: Date.now()
				});
				
				processingJobs.delete(job.id);
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
}> {
	const jobs = await getAllJobs();
	const completed = jobs.filter(j => j.status === 'completed');
	const failed = jobs.filter(j => j.status === 'failed');
	const total = completed.length + failed.length;
	
	const totalTime = jobs.reduce((sum, j) => {
		if (j.startedAt && j.completedAt) {
			return sum + (j.completedAt - j.startedAt);
		}
		return sum;
	}, 0);
	
	const avgRetries = jobs.reduce((sum, j) => sum + (j.retryCount || 0), 0) / Math.max(jobs.length, 1);
	
	return {
		total_jobs: jobs.length,
		queued: jobs.filter(j => j.status === 'queued').length,
		processing: jobs.filter(j => j.status === 'processing').length,
		paused: jobs.filter(j => j.status === 'paused').length,
		completed: completed.length,
		failed: failed.length,
		cancelled: jobs.filter(j => j.status === 'cancelled').length,
		avg_success_rate: total > 0 ? Math.round((completed.length / total) * 100) : 0,
		avg_retry_count: Math.round(avgRetries * 100) / 100,
		total_download_time_ms: totalTime,
		avg_job_duration_ms: total > 0 ? Math.round(totalTime / total) : 0
	};
}
