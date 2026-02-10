/**
 * Queue and worker statistics, rate limiting status, and analytics
 * GET: Get comprehensive queue stats and metrics
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getQueueSnapshot, getMetrics } from '$lib/server/downloadQueueManager';
import { getWorkerStatus } from '$lib/server/downloadQueueWorker';
import * as rateLimiter from '$lib/server/rateLimiter';

/**
 * GET /api/download-queue/stats
 * Get comprehensive queue statistics, worker status, and rate limiting info
 */
export const GET: RequestHandler = async () => {
	try {
		const [snapshot, metrics, workerStatus] = await Promise.all([
			getQueueSnapshot(),
			getMetrics(),
			Promise.resolve(getWorkerStatus())
		]);

		const rateLimitStatus = rateLimiter.getAllStatus();
		const jobs = snapshot.jobs;
		const queueStats = {
			queued: jobs.filter(j => j.status === 'queued').length,
			processing: jobs.filter(j => j.status === 'processing').length,
			completed: jobs.filter(j => j.status === 'completed').length,
			failed: jobs.filter(j => j.status === 'failed').length,
			total: jobs.length
		};

		return json({
			success: true,
			queue: queueStats,
			queueSource: snapshot.source,
			metrics,
			worker: workerStatus,
			rateLimiting: rateLimitStatus,
			timestamp: new Date().toISOString()
		});
	} catch (error) {
		console.error('[Queue API] Stats error:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
};
