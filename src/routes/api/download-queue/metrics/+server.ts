import { json, type RequestHandler } from '@sveltejs/kit';
import {
	getMetrics,
	getQueueSnapshot,
	getQueueStats
} from '$lib/server/downloadQueueManager';

export const GET: RequestHandler = async () => {
	try {
		const [snapshot, stats, metrics] = await Promise.all([
			getQueueSnapshot(),
			getQueueStats(),
			getMetrics()
		]);

		return json({
			success: true,
			generatedAt: new Date().toISOString(),
			source: snapshot.source,
			warning: snapshot.warning,
			queue: stats,
			metrics
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return json(
			{
				success: false,
				error: message
			},
			{ status: 500 }
		);
	}
};

