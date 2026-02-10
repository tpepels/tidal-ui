import type { Handle } from '@sveltejs/kit';
import { startWorker } from '$lib/server/downloadQueueWorker';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

// Start background download worker (enabled by default, disable with ENABLE_DEV_WORKER=false)
const enableWorker = env.ENABLE_DEV_WORKER !== 'false';

if (enableWorker) {
	startWorker()
		.then(() => console.log('[Server] Background download worker started'))
		.catch(err => console.error('[Server] Failed to start worker:', err));
} else {
	console.log('[Server] Background download worker disabled in dev mode');
}

export const handle: Handle = async ({ event, resolve }) => {
	// Increase request body size limit for audio file uploads
	// Default is 512KB, we need ~100MB for FLAC files
	const contentLength = event.request.headers.get('content-length');
	if (contentLength && parseInt(contentLength) > 512 * 1024) {
		// This is handled by the underlying server, but we log it for debugging
	}

	return resolve(event);
};
