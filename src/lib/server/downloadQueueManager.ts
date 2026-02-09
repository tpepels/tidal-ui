/**
 * Server-side download queue manager
 * Manages background download jobs that run independently of browser sessions
 */

import Redis from 'ioredis';
import type { AudioQuality } from '$lib/types';

// Redis client for queue persistence
let redis: Redis | null = null;
let redisConnected = false;

function getRedisClient(): Redis | null {
	const redisDisabled = ['true', '1'].includes((process.env.REDIS_DISABLED || '').toLowerCase());
	if (redisDisabled) {
		return null;
	}

	if (redisConnected && redis) return redis;

	try {
		const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
		redis = new Redis(redisUrl);
		redis.on('error', (err) => {
			console.warn('[Queue] Redis connection error:', err);
			redisConnected = false;
		});
		redis.on('connect', () => {
			console.log('[Queue] Redis connected');
			redisConnected = true;
		});
	} catch (err) {
		console.warn('[Queue] Failed to initialize Redis:', err);
		redis = null;
	}
	return redis;
}

export type JobType = 'track' | 'album';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface TrackJob {
	type: 'track';
	trackId: number;
	quality: AudioQuality;
	albumTitle?: string;
	artistName?: string;
	trackTitle?: string;
}

export interface AlbumJob {
	type: 'album';
	albumId: number;
	quality: AudioQuality;
	artistName?: string;
}

export type DownloadJob = TrackJob | AlbumJob;

export interface QueuedJob {
	id: string;
	job: DownloadJob;
	status: JobStatus;
	progress: number; // 0-1
	error?: string;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	trackCount?: number; // For albums
	completedTracks?: number; // For albums
}

// In-memory queue (falls back when Redis unavailable)
const memoryQueue = new Map<string, QueuedJob>();
const processingJobs = new Set<string>();

const QUEUE_KEY = 'tidal:downloadQueue';

/**
 * Add a job to the queue
 */
export async function enqueueJob(job: DownloadJob): Promise<string> {
	const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
	
	const queuedJob: QueuedJob = {
		id: jobId,
		job,
		status: 'queued',
		progress: 0,
		createdAt: Date.now()
	};

	const client = getRedisClient();
	if (client && redisConnected) {
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
 * Get next job from queue
 */
export async function dequeueJob(): Promise<QueuedJob | null> {
	const client = getRedisClient();
	
	if (client && redisConnected) {
		try {
			const jobs = await client.hgetall(QUEUE_KEY);
			const queuedJobs = Object.entries(jobs)
				.map(([, value]) => JSON.parse(value) as QueuedJob)
				.filter(j => j.status === 'queued' && !processingJobs.has(j.id))
				.sort((a, b) => a.createdAt - b.createdAt);
			
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
	for (const job of memoryQueue.values()) {
		if (job.status === 'queued' && !processingJobs.has(job.id)) {
			processingJobs.add(job.id);
			return job;
		}
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
	const client = getRedisClient();
	
	if (client && redisConnected) {
		try {
			const existing = await client.hget(QUEUE_KEY, jobId);
			if (existing) {
				const job = JSON.parse(existing) as QueuedJob;
				const updated = { ...job, ...updates };
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
		Object.assign(job, updates);
		if (job.status === 'completed' || job.status === 'failed') {
			processingJobs.delete(jobId);
		}
	}
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string): Promise<QueuedJob | null> {
	const client = getRedisClient();
	
	if (client && redisConnected) {
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
	const client = getRedisClient();
	
	if (client && redisConnected) {
		try {
			const jobs = await client.hgetall(QUEUE_KEY);
			return Object.values(jobs).map(v => JSON.parse(v) as QueuedJob);
		} catch (err) {
			console.warn('[Queue] Redis getAll failed:', err);
		}
	}

	// Fallback to memory
	return Array.from(memoryQueue.values());
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
	const jobs = await getAllJobs();
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

	const client = getRedisClient();
	
	for (const job of jobs) {
		const isOld = job.completedAt && (now - job.completedAt) > olderThanMs;
		const shouldClean = isOld && (job.status === 'completed' || job.status === 'failed');
		
		if (shouldClean) {
			if (client && redisConnected) {
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
		console.log(`[Queue] Cleaned up ${cleaned} old jobs`);
	}
	return cleaned;
}
