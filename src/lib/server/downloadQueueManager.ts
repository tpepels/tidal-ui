/**
 * Server-side download queue manager
 * Manages background download jobs that run independently of browser sessions
 */

import type { AudioQuality } from '$lib/types';
import { getConnectedRedis } from './redis';

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
					// Mark as failed with recovery message
					await client.hset(
						QUEUE_KEY,
						jobId,
						JSON.stringify({
							...job,
							status: 'failed' as const,
							error: 'Recovered from server crash while processing',
							completedAt: Date.now()
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
	}

	console.log('[Queue] Initialization complete');
}

export type JobType = 'track' | 'album';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
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
}

// In-memory queue (falls back when Redis unavailable)
const memoryQueue = new Map<string, QueuedJob>();
const processingJobs = new Set<string>();

const QUEUE_KEY = 'tidal:downloadQueue';

function getRedisWarning(): string {
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

	return {
		jobs: Array.from(memoryQueue.values()),
		source: 'memory',
		warning: getRedisWarning()
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
	// Duplicate detection
	if (options?.checkDuplicate !== false) {
		const duplicate = await findDuplicateJob(job);
		if (duplicate) {
			console.log(`[Queue] Duplicate job found: ${duplicate.id} (status: ${duplicate.status})`);
			// If duplicate is queued or processing, return existing job ID
			if (duplicate.status === 'queued' || duplicate.status === 'processing') {
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
					nextRetryAt: undefined
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
	memoryQueue.set(jobId, queuedJob);
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
				
				// Remove from processing set if completed/failed
				if (updated.status === 'completed' || updated.status === 'failed') {
					processingJobs.delete(jobId);
				}
				return;
			}
		} catch (err) {
			console.warn('[Queue] Redis update failed:', err);
		}
	}

	// Fallback to memory
	const job = memoryQueue.get(jobId);
	if (job) {
		Object.assign(job, stampedUpdates);
		if (job.status === 'completed' || job.status === 'failed') {
			processingJobs.delete(jobId);
		}
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
	completed: number;
	failed: number;
	total: number;
}> {
	const { jobs } = await getQueueSnapshot();
	return {
		queued: jobs.filter(j => j.status === 'queued').length,
		processing: jobs.filter(j => j.status === 'processing').length,
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
	
	for (const job of jobs) {
		const isOld = job.completedAt && (now - job.completedAt) > olderThanMs;
		const shouldClean = isOld && (job.status === 'completed' || job.status === 'failed');
		
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
	if (memoryQueue.has(jobId)) {
		memoryQueue.delete(jobId);
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
	if (job.status === 'queued') {
		await updateJobStatus(jobId, {
			status: 'cancelled',
			cancellationRequested: true,
			completedAt: Date.now()
		});
		processingJobs.delete(jobId);
		console.log(`[Queue] Job ${jobId} cancelled (was queued)`);
		return true;
	}
	
	// If processing, flag for cancellation (worker will check this)
	if (job.status === 'processing') {
		await updateJobStatus(jobId, {
			cancellationRequested: true
		});
		console.log(`[Queue] Cancellation requested for job ${jobId} (currently processing)`);
		return true;
	}
	
	return false;
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

	if (job.status !== 'failed' && job.status !== 'cancelled') {
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
		retryCount: 0,
		completedTracks: 0,
		trackProgress: resetTrackProgressForRetry(job.trackProgress)
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
		completed: completed.length,
		failed: failed.length,
		cancelled: jobs.filter(j => j.status === 'cancelled').length,
		avg_success_rate: total > 0 ? Math.round((completed.length / total) * 100) : 0,
		avg_retry_count: Math.round(avgRetries * 100) / 100,
		total_download_time_ms: totalTime,
		avg_job_duration_ms: total > 0 ? Math.round(totalTime / total) : 0
	};
}
