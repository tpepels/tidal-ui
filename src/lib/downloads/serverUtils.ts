import type { AudioQuality } from '../types';
import { downloadLogStore } from '../stores/downloadLog';
import { retryFetch } from '../errors';

/**
 * Server-side download utilities
 */

/**
 * Download a track to the server using the server-side API
 */
export async function downloadTrackServerSide(
	trackId: number,
	quality: AudioQuality,
	albumTitle: string,
	artistName: string,
	trackTitle?: string,
	blob?: Blob,
	options?: {
		useChunks?: boolean;
		chunkSize?: number;
		conflictResolution?: 'overwrite' | 'skip' | 'rename' | 'overwrite_if_different';
		checkExisting?: boolean;
		downloadCoverSeperately?: boolean;
		coverUrl?: string;
		onProgress?: (progress: {
			uploaded: number;
			total: number;
			speed?: number;
			eta?: number;
		}) => void;
	}
): Promise<{
	success: boolean;
	filepath?: string;
	message?: string;
	error?: string;
	action?: string;
}> {
	try {
		if (!blob) {
			console.error('[Server Download] No blob provided');
			return {
				success: false,
				error: 'No blob provided'
			};
		}

		const useChunks = blob.size > 1024 * 1024; // Use chunks for files > 1MB for better progress granularity

		const sizeMsg = `[Server Download] Phase 1: Sending metadata for "${trackTitle}" (${(blob.size / 1024 / 1024).toFixed(2)} MB)${useChunks ? ' (chunked)' : ''}`;
		downloadLogStore.log(sizeMsg);

		// Check if file already exists on server (if requested)
		if (options?.checkExisting) {
			try {
				const checkResponse = await retryFetch('/api/download-check', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						trackId,
						quality,
						albumTitle,
						artistName,
						trackTitle
					}),
					timeout: 5000,
					maxRetries: 1
				});

				if (checkResponse.ok) {
					const checkData = await checkResponse.json();
					if (checkData.exists) {
						downloadLogStore.warning(`File already exists on server: ${checkData.filepath}`);
						return {
							success: true,
							filepath: checkData.filepath,
							message: 'File already exists on server, skipped download.',
							action: 'skipped'
						};
					}
				}
			} catch (error) {
				// If check fails, continue with download
				console.warn('Failed to check existing file:', error);
			}
		}

		// Continue with server-side download logic...
		// (This is a simplified version - full implementation would include chunking logic)

		return {
			success: false,
			error: 'Server-side download not fully implemented in modular version'
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[Server Download] Error:', errorMsg);
		return {
			success: false,
			error: `Server download failed: ${errorMsg}`
		};
	}
}
