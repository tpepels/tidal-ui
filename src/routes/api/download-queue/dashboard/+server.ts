import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getQueueSnapshot, getMetrics } from '$lib/server/downloadQueueManager';
import { getWorkerStatus } from '$lib/server/downloadQueueWorker';
import * as rateLimiter from '$lib/server/rateLimiter';

export const GET: RequestHandler = async () => {
	try {
		const [snapshot, metrics, workerStatus] = await Promise.all([
			getQueueSnapshot(),
			getMetrics(),
			Promise.resolve(getWorkerStatus())
		]);

		const jobs = snapshot.jobs;
		const queue = {
			queued: jobs.filter((job) => job.status === 'queued').length,
			processing: jobs.filter((job) => job.status === 'processing').length,
			paused: jobs.filter((job) => job.status === 'paused').length,
			completed: jobs.filter((job) => job.status === 'completed').length,
			failed: jobs.filter((job) => job.status === 'failed').length,
			total: jobs.length
		};

		return json({
			success: true,
			jobs,
			queue,
			metrics,
			worker: workerStatus,
			queueSource: snapshot.source,
			warning: snapshot.warning,
			localMode: process.env.LOCAL_MODE !== 'false',
			rateLimiting: rateLimiter.getAllStatus(),
			generatedAt: new Date().toISOString()
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{
				success: false,
				error: message
			},
			{ status: 500 }
		);
	}
};
