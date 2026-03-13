import { getConnectedRedis } from './redis';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { QueueSource, QueuedJob } from './downloadQueueTypes';

const memoryQueue = new Map<string, QueuedJob>();
const processingJobs = new Set<string>();

const QUEUE_KEY = 'tidal:downloadQueue';
const QUEUE_STATE_FILE = path.join(process.cwd(), 'data', 'download-queue-state.v1.json');
const LOCAL_MODE_ENABLED = process.env.LOCAL_MODE !== 'false';
const LOCAL_MODE_HIDE_MULTI_PROCESS_WARNING = LOCAL_MODE_ENABLED;
const LOCAL_COMPLETED_RETENTION_MS = Math.max(
	60_000,
	Number(process.env.LOCAL_COMPLETED_RETENTION_MS || 30 * 60 * 1000)
);
const LOCAL_CANCELLED_RETENTION_MS = Math.max(
	60_000,
	Number(process.env.LOCAL_CANCELLED_RETENTION_MS || 6 * 60 * 60 * 1000)
);
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
		const entries = Array.from(memoryQueue.values()).sort((left, right) => left.createdAt - right.createdAt);
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
			if (job.status === 'processing') {
				memoryQueue.set(job.id, {
					...job,
					status: 'queued',
					progress: 0,
					error: undefined,
					lastError: job.lastError ?? job.error ?? 'Recovered after restart while processing',
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

async function persistMemoryQueue(): Promise<void> {
	await saveMemoryQueueToDisk();
}

function getRedisWarning(): string {
	if (LOCAL_MODE_HIDE_MULTI_PROCESS_WARNING) {
		return '';
	}
	return 'Redis unavailable or disabled; using in-memory queue. If the worker runs in a separate process, the UI may not reflect active jobs.';
}

export function getLocalRetentionConfig(): {
	localModeEnabled: boolean;
	completedMs: number;
	failedMs: number;
	cancelledMs: number;
	pausedMs: number;
} {
	return {
		localModeEnabled: LOCAL_MODE_ENABLED,
		completedMs: LOCAL_COMPLETED_RETENTION_MS,
		failedMs: LOCAL_FAILED_RETENTION_MS,
		cancelledMs: LOCAL_CANCELLED_RETENTION_MS,
		pausedMs: LOCAL_PAUSED_RETENTION_MS
	};
}

export async function recoverQueueStorage(): Promise<{
	source: QueueSource;
	recovered: number;
}> {
	const client = await getConnectedRedis();
	if (client) {
		try {
			const jobs = await client.hgetall(QUEUE_KEY);
			let recovered = 0;
			for (const [jobId, value] of Object.entries(jobs)) {
				const job = JSON.parse(value) as QueuedJob;
				if (job.status === 'processing') {
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
					recovered += 1;
				}
			}
			return { source: 'redis', recovered };
		} catch (error) {
			console.warn('[Queue] Initialization error:', error);
		}
	}

	await loadMemoryQueueFromDisk();
	return { source: 'memory', recovered: 0 };
}

export async function getQueueSnapshotFromRepository(): Promise<{
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
		} catch (error) {
			console.warn('[Queue] Redis getAll failed:', error);
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

export async function readQueueJob(jobId: string): Promise<QueuedJob | null> {
	const client = await getConnectedRedis();
	if (client) {
		try {
			const data = await client.hget(QUEUE_KEY, jobId);
			if (data) {
				return JSON.parse(data) as QueuedJob;
			}
		} catch (error) {
			console.warn('[Queue] Redis get failed:', error);
		}
	}

	await loadMemoryQueueFromDisk();
	return memoryQueue.get(jobId) || null;
}

export async function writeQueueJob(job: QueuedJob): Promise<QueueSource> {
	const client = await getConnectedRedis();
	if (client) {
		try {
			await client.hset(QUEUE_KEY, job.id, JSON.stringify(job));
			return 'redis';
		} catch (error) {
			console.warn('[Queue] Redis write failed, using memory:', error);
		}
	}

	await loadMemoryQueueFromDisk();
	memoryQueue.set(job.id, job);
	await persistMemoryQueue();
	return 'memory';
}

export async function patchQueueJob(
	jobId: string,
	updates: Partial<QueuedJob>
): Promise<{ job: QueuedJob; source: QueueSource } | null> {
	const client = await getConnectedRedis();
	const stampedUpdates = { ...updates, lastUpdatedAt: Date.now() };

	if (client) {
		try {
			const existing = await client.hget(QUEUE_KEY, jobId);
			if (existing) {
				const job = JSON.parse(existing) as QueuedJob;
				const updated = { ...job, ...stampedUpdates };
				await client.hset(QUEUE_KEY, jobId, JSON.stringify(updated));
				return { job: updated, source: 'redis' };
			}
		} catch (error) {
			console.warn('[Queue] Redis update failed:', error);
		}
	}

	await loadMemoryQueueFromDisk();
	const job = memoryQueue.get(jobId);
	if (!job) {
		return null;
	}
	Object.assign(job, stampedUpdates);
	await persistMemoryQueue();
	return { job, source: 'memory' };
}

export async function removeQueueJob(jobId: string): Promise<{ deleted: boolean; source?: QueueSource }> {
	const client = await getConnectedRedis();
	if (client) {
		try {
			const result = await client.hdel(QUEUE_KEY, jobId);
			if (result > 0) {
				return { deleted: true, source: 'redis' };
			}
		} catch (error) {
			console.warn('[Queue] Redis delete failed:', error);
		}
	}

	await loadMemoryQueueFromDisk();
	if (!memoryQueue.has(jobId)) {
		return { deleted: false };
	}
	memoryQueue.delete(jobId);
	await persistMemoryQueue();
	return { deleted: true, source: 'memory' };
}

export async function removeQueueJobs(jobIds: string[]): Promise<number> {
	if (jobIds.length === 0) {
		return 0;
	}

	const client = await getConnectedRedis();
	if (client) {
		let deleted = 0;
		for (const jobId of jobIds) {
			try {
				const result = await client.hdel(QUEUE_KEY, jobId);
				if (result > 0) {
					deleted += 1;
				}
			} catch (error) {
				console.warn('[Queue] Redis cleanup failed:', error);
			}
		}
		return deleted;
	}

	await loadMemoryQueueFromDisk();
	let deleted = 0;
	for (const jobId of jobIds) {
		if (memoryQueue.delete(jobId)) {
			deleted += 1;
		}
	}
	if (deleted > 0) {
		await persistMemoryQueue();
	}
	return deleted;
}

export function getProcessingJobsSnapshot(): Set<string> {
	return new Set(processingJobs);
}

export function markQueueJobProcessing(jobId: string): void {
	processingJobs.add(jobId);
}

export function clearQueueJobProcessing(jobId: string): void {
	processingJobs.delete(jobId);
}
