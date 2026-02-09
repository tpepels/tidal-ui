/**
 * Queue and worker statistics
 * GET: Get queue stats and worker status
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getQueueStats } from '$lib/server/downloadQueueManager';
import { getWorkerStatus } from '$lib/server/downloadQueueWorker';

/**
 * GET /api/download-queue/stats
 * Get queue statistics and worker status
 */
export const GET: RequestHandler = async () => {
	try {
		const [queueStats, workerStatus] = await Promise.all([
			getQueueStats(),
			Promise.resolve(getWorkerStatus())
		]);

		return json({
			success: true,
			queue: queueStats,
			worker: workerStatus
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
