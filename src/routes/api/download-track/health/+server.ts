import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
	pendingUploads,
	chunkUploads,
	activeUploads,
	cleanupExpiredUploads,
	forceCleanupAllUploads,
	MAX_CONCURRENT_UPLOADS
} from '../_shared';
import Redis from 'ioredis';

export const GET: RequestHandler = async () => {
	try {
		const activeIds = Array.from(activeUploads);
		const pendingIds = Array.from(pendingUploads.keys());
		const chunkIds = Array.from(chunkUploads.keys());

		// Check Redis status
		let redisConnected = false;
		const redisDisabled = ['true', '1'].includes((process.env.REDIS_DISABLED || '').toLowerCase());
		if (!redisDisabled) {
			try {
				const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
					lazyConnect: true,
					connectTimeout: 1000,
					maxRetriesPerRequest: 0,
					enableOfflineQueue: false
				});
				redis.on('error', () => {
					// Avoid unhandled error events during health checks.
				});
				await redis.connect();
				await redis.ping();
				redisConnected = true;
				redis.disconnect();
			} catch {
				redisConnected = false;
			}
		}

		return json({
			status: 'ok',
			activeUploads: activeIds.length,
			pendingUploads: pendingIds.length,
			chunkUploads: chunkIds.length,
			maxConcurrent: MAX_CONCURRENT_UPLOADS,
			redisConnected,
			activeIds,
			pendingIds,
			chunkIds
		});
	} catch (error) {
		console.error('Health check error:', error);
		return json({ status: 'error', message: 'Failed to get upload status' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		if (body.action === 'cleanup') {
			await cleanupExpiredUploads();
			return json({ status: 'ok', message: 'Expired cleanup completed' });
		}
		if (body.action === 'force_cleanup') {
			const result = await forceCleanupAllUploads();
			return json({
				status: 'ok',
				message: `Force cleanup completed: ${result.cleaned} uploads cleaned`
			});
		}
		return json({ error: 'Invalid action' }, { status: 400 });
	} catch (error) {
		console.error('Health cleanup error:', error);
		return json({ status: 'error', message: 'Cleanup failed' }, { status: 500 });
	}
};
