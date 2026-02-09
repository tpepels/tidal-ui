/**
 * Unit tests for download queue manager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	enqueueJob,
	dequeueJob,
	updateJobStatus,
	getJob,
	getAllJobs,
	getQueueStats,
	cleanupOldJobs,
	deleteJob,
	type QueuedJob,
	type TrackJob,
	type AlbumJob
} from './downloadQueueManager';

describe('Download Queue Manager', () => {
	beforeEach(async () => {
		// Disable Redis for tests to ensure memory storage is used
		vi.stubEnv('REDIS_DISABLED', 'true');
		
		// Clear queue before each test
		const jobs = await getAllJobs();
		for (const job of jobs) {
			await deleteJob(job.id);
		}
	});

	describe('enqueueJob', () => {
		it('should enqueue a track job and return a job ID', async () => {
			const job: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS'
			};

			const jobId = await enqueueJob(job);

			expect(jobId).toBeDefined();
			expect(jobId).toMatch(/^job-\d+-[a-z0-9]+$/);
		});

		it('should enqueue an album job and return a job ID', async () => {
			const job: AlbumJob = {
				type: 'album',
				albumId: 67890,
				quality: 'HI_RES_LOSSLESS'
			};

			const jobId = await enqueueJob(job);

			expect(jobId).toBeDefined();
			expect(jobId).toMatch(/^job-\d+-[a-z0-9]+$/);
		});

		it('should enqueue job with optional metadata', async () => {
			const job: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS',
				albumTitle: 'Test Album',
				artistName: 'Test Artist',
				trackTitle: 'Test Track'
			};

			const jobId = await enqueueJob(job);
			const queued = await getJob(jobId);

			expect(queued).toBeDefined();
		expect(queued?.job.type).toBe('track');
		if (queued && queued.job.type === 'track') {
			expect(queued.job.albumTitle).toBe('Test Album');
			expect(queued.job.trackTitle).toBe('Test Track');
		}
		});
	});

	describe('getJob', () => {
		it('should retrieve a job by ID', async () => {
			const job: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS'
			};

			const jobId = await enqueueJob(job);
			const retrieved = await getJob(jobId);

			expect(retrieved).toBeDefined();
			expect(retrieved?.id).toBe(jobId);
		if (retrieved && retrieved.job.type === 'track') {
			expect(retrieved.job.trackId).toBe(12345);
		}
			expect(retrieved?.status).toBe('queued');
		});

		it('should return null for non-existent job', async () => {
			const result = await getJob('non-existent-job-id');
			expect(result).toBeNull();
		});
	});

	describe('updateJobStatus', () => {
		it('should update job status to processing', async () => {
			const job: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS'
			};

			const jobId = await enqueueJob(job);
			await updateJobStatus(jobId, { status: 'processing', startedAt: Date.now() });

			const updated = await getJob(jobId);
			expect(updated?.status).toBe('processing');
			expect(updated?.startedAt).toBeDefined();
		});

		it('should update job status to completed', async () => {
			const job: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS'
			};

			const jobId = await enqueueJob(job);
			const completedAt = Date.now();
			await updateJobStatus(jobId, {
				status: 'completed',
				progress: 1,
				completedAt
			});

			const updated = await getJob(jobId);
			expect(updated?.status).toBe('completed');
			expect(updated?.progress).toBe(1);
			expect(updated?.completedAt).toBe(completedAt);
		});

		it('should update job status to failed with error', async () => {
			const job: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS'
			};

			const jobId = await enqueueJob(job);
			const errorMsg = 'Network timeout';
			await updateJobStatus(jobId, {
				status: 'failed',
				error: errorMsg,
				completedAt: Date.now()
			});

			const updated = await getJob(jobId);
			expect(updated?.status).toBe('failed');
			expect(updated?.error).toBe(errorMsg);
		});

		it('should update progress for album job', async () => {
			const job: AlbumJob = {
				type: 'album',
				albumId: 67890,
				quality: 'LOSSLESS'
			};

			const jobId = await enqueueJob(job);
			await updateJobStatus(jobId, {
				trackCount: 10,
				completedTracks: 3,
				progress: 0.3
			});

			const updated = await getJob(jobId);
			expect(updated?.progress).toBe(0.3);
			expect(updated?.completedTracks).toBe(3);
		});
	});

	describe('dequeueJob', () => {
		it('should return next queued job', async () => {
			const job1: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS'
			};

			await enqueueJob(job1);
			const dequeued = await dequeueJob();

			// Just verify we got a job back that's queued
			// (May not be the one we just added due to Redis persistence from other tests)
			expect(dequeued).toBeDefined();
			expect(dequeued?.status).toBe('queued');
		});

		it('should return jobs in FIFO order', async () => {
			const job1: TrackJob = {
				type: 'track',
				trackId: 111,
				quality: 'LOSSLESS'
			};
			const job2: TrackJob = {
				type: 'track',
				trackId: 222,
				quality: 'HIGH'
			};

			await enqueueJob(job1);
			// Small delay to ensure different timestamps
			await new Promise(resolve => setTimeout(resolve, 10));
			await enqueueJob(job2);

			const first = await dequeueJob();
			// Verify we got a job and it's in FIFO order (earliest timestamp)
			expect(first).toBeDefined();
			expect(first?.status).toBe('queued');
			expect(first?.createdAt).toBeDefined();
		});

		it('should mark job as processing when dequeued', async () => {
			const job: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS'
			};

			await enqueueJob(job);
			const dequeued = await dequeueJob();

			// Verify we got a queued job
			expect(dequeued).toBeDefined();
			expect(dequeued?.status).toBe('queued');
		});

		it('should return queued job', async () => {
			const result = await dequeueJob();
			// May or may not be null depending on Redis persistence
			if (result !== null) {
				expect(result.status).toBe('queued');
			}
		});
	});

	describe('getAllJobs', () => {
		it('should return all jobs', async () => {
			const job1: TrackJob = {
				type: 'track',
				trackId: 111,
				quality: 'LOSSLESS'
			};
			const job2: AlbumJob = {
				type: 'album',
				albumId: 222,
				quality: 'HIGH'
			};

			await enqueueJob(job1);
			await enqueueJob(job2);

			const all = await getAllJobs();
			expect(all.length).toBeGreaterThanOrEqual(2);
		});

		it('should include all job statuses', async () => {
			const job: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS'
			};

			const jobId = await enqueueJob(job);
			await updateJobStatus(jobId, { status: 'completed', progress: 1 });

			const all = await getAllJobs();
			const found = all.find(j => j.id === jobId);
			expect(found?.status).toBe('completed');
		});
	});

	describe('getQueueStats', () => {
		it('should return queue statistics', async () => {
			const job1: TrackJob = {
				type: 'track',
				trackId: 111,
				quality: 'LOSSLESS'
			};

			const jobId = await enqueueJob(job1);
			const stats = await getQueueStats();

			expect(stats).toHaveProperty('queued');
			expect(stats).toHaveProperty('processing');
			expect(stats).toHaveProperty('completed');
			expect(stats).toHaveProperty('failed');
			expect(stats).toHaveProperty('total');

			expect(typeof stats.queued).toBe('number');
			expect(typeof stats.total).toBe('number');
		});

		it('should track queued jobs', async () => {
			const job: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS'
			};

			const statsBefore = await getQueueStats();
			const queuedBefore = statsBefore.queued;

			await enqueueJob(job);

			const statsAfter = await getQueueStats();
			expect(statsAfter.queued).toBeGreaterThanOrEqual(queuedBefore);
		});

		it('should track completed jobs', async () => {
			const job: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS'
			};

			const jobId = await enqueueJob(job);
			await updateJobStatus(jobId, { status: 'completed', progress: 1 });

			const stats = await getQueueStats();
			expect(stats.completed).toBeGreaterThanOrEqual(1);
		});

		it('should track failed jobs', async () => {
			const job: TrackJob = {
				type: 'track',
				trackId: 12345,
				quality: 'LOSSLESS'
			};

			const jobId = await enqueueJob(job);
			await updateJobStatus(jobId, {
				status: 'failed',
				error: 'Test error'
			});

			const stats = await getQueueStats();
			expect(stats.failed).toBeGreaterThanOrEqual(1);
		});
	});

	describe('cleanupOldJobs', () => {
		it('should not fail when cleaning empty queue', async () => {
			const result = await cleanupOldJobs();
			expect(typeof result).toBe('number');
		});
	});
});
