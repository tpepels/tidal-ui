import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pendingUploads, chunkUploads, activeUploads, cleanupExpiredUploads } from '../_shared';

export const GET: RequestHandler = async () => {
	try {
		const activeIds = Array.from(activeUploads);
		const pendingIds = Array.from(pendingUploads.keys());
		const chunkIds = Array.from(chunkUploads.keys());

		return json({
			status: 'ok',
			activeUploads: activeIds.length,
			pendingUploads: pendingIds.length,
			chunkUploads: chunkIds.length,
			maxConcurrent: 40, // or from env
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
			cleanupExpiredUploads();
			return json({ status: 'ok', message: 'Cleanup completed' });
		}
		return json({ error: 'Invalid action' }, { status: 400 });
	} catch (error) {
		console.error('Health cleanup error:', error);
		return json({ status: 'error', message: 'Cleanup failed' }, { status: 500 });
	}
};
