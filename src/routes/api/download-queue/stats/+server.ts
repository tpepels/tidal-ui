/**
 * Queue and worker statistics, rate limiting status, and analytics
 * GET: Get comprehensive queue stats and metrics
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getQueueStats, getMetrics } from '$lib/server/downloadQueueManager';
import { getWorkerStatus } from '$lib/server/downloadQueueWorker';
import * as rateLimiter from '$lib/server/rateLimiter';

/**
 * GET /api/download-queue/stats
 * Get comprehensive queue statistics, worker status, and rate limiting info
 */
export const GET: RequestHandler = async () => {
	try {
		const [queueStats, metrics, workerStatus] = await Promise.all([
			getQueueStats(),
			getMetrics(),
			Promise.resolve(getWorkerStatus())
		]);

		const rateLimitStatus = rateLimiter.getAllStatus();

		return json({
			success: true,
			queue: queueStats,
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
