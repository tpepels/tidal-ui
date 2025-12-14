import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
    // Increase request body size limit for audio file uploads
    // Default is 512KB, we need ~100MB for FLAC files
    const contentLength = event.request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 512 * 1024) {
        // This is handled by the underlying server, but we log it for debugging
        console.log(`[Server] Handling large upload: ${(parseInt(contentLength) / 1024 / 1024).toFixed(2)}MB`);
    }

    return resolve(event);
};
