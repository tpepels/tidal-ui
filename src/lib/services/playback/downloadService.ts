/**
 * Download Service
 *
 * Handles track download orchestration, progress tracking, and error handling.
 * Extracted from AudioPlayer component to separate download business logic
 * from UI presentation.
 */

import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
import { buildTrackFilename } from '$lib/downloads';
import { formatArtists } from '$lib/utils/formatters';
import type { Track, PlayableTrack, AudioQuality } from '$lib/types';
import { isSonglinkTrack } from '$lib/types';

/**
 * Progress event emitted during download
 */
export type DownloadProgressEvent =
	| { stage: 'downloading'; receivedBytes: number; totalBytes?: number }
	| { stage: 'embedding'; progress: number };

/**
 * Callbacks for download lifecycle events
 */
export interface DownloadCallbacks {
	onProgress?: (event: DownloadProgressEvent) => void;
	onComplete?: (filename: string) => void;
	onError?: (error: DownloadError) => void;
	onCancel?: () => void;
}

export interface DownloadOptions {
	quality?: AudioQuality;
	convertAacToMp3?: boolean;
	downloadCoversSeperately?: boolean;
	signal?: AbortSignal;
	callbacks?: DownloadCallbacks;
}

/**
 * Structured error types for download operations
 */
export type DownloadError =
	| { code: 'SONGLINK_NOT_SUPPORTED'; retry: false; message: string }
	| { code: 'DOWNLOAD_CANCELLED'; retry: false; message: string }
	| { code: 'NETWORK_ERROR'; retry: true; message: string; originalError?: unknown }
	| { code: 'STORAGE_ERROR'; retry: true; message: string; originalError?: unknown }
	| { code: 'CONVERSION_ERROR'; retry: false; message: string; originalError?: unknown }
	| { code: 'UNKNOWN_ERROR'; retry: false; message: string; originalError?: unknown };

export type DownloadResult =
	| { success: true; filename: string }
	| { success: false; error: DownloadError };

/**
 * Classifies an error into a structured DownloadError type
 */
function classifyDownloadError(error: unknown): DownloadError {
	// Handle abort errors (user cancellation)
	if (error instanceof DOMException && error.name === 'AbortError') {
		return { code: 'DOWNLOAD_CANCELLED', retry: false, message: 'Download was cancelled' };
	}

	if (error instanceof Error) {
		const message = error.message.toLowerCase();

		// Network-related errors
		if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
			return { code: 'NETWORK_ERROR', retry: true, message: error.message, originalError: error };
		}

		// Storage/filesystem errors
		if (message.includes('storage') || message.includes('disk') || message.includes('quota')) {
			return { code: 'STORAGE_ERROR', retry: true, message: error.message, originalError: error };
		}

		// Conversion errors (AAC to MP3, etc.)
		if (message.includes('conversion') || message.includes('ffmpeg') || message.includes('codec')) {
			return {
				code: 'CONVERSION_ERROR',
				retry: false,
				message: error.message,
				originalError: error
			};
		}

		return { code: 'UNKNOWN_ERROR', retry: false, message: error.message, originalError: error };
	}

	return {
		code: 'UNKNOWN_ERROR',
		retry: false,
		message: typeof error === 'string' ? error : 'Unknown download error',
		originalError: error
	};
}

/**
 * Initiates a track download with progress tracking and error handling
 * Returns a structured result with type-safe error handling
 *
 * This service is now pure - it doesn't call stores directly.
 * Instead, it invokes callbacks to notify the caller of state changes.
 */
export async function downloadTrack(
	track: PlayableTrack,
	options?: DownloadOptions
): Promise<DownloadResult> {
	// Only support regular Track downloads, not Songlink tracks
	if (isSonglinkTrack(track)) {
		const error: DownloadError = {
			code: 'SONGLINK_NOT_SUPPORTED',
			retry: false,
			message: 'Cannot download Songlink tracks directly. Please convert to TIDAL first.'
		};
		options?.callbacks?.onError?.(error);
		return { success: false, error };
	}

	const quality: AudioQuality = options?.quality ?? 'LOSSLESS';
	const convertAacToMp3 = options?.convertAacToMp3 ?? false;
	const downloadCoversSeperately = options?.downloadCoversSeperately ?? false;

	// Build filename
	const filename = buildTrackFilename(
		track.album,
		track,
		quality,
		formatArtists(track.artists),
		convertAacToMp3
	);

	try {
		// Execute download with progress callbacks
		await losslessAPI.downloadTrack(track.id, quality, filename, {
			convertAacToMp3,
			downloadCoverSeperately: downloadCoversSeperately,
			signal: options?.signal,
			onProgress: (progress: TrackDownloadProgress) => {
				if (progress.stage === 'downloading') {
					options?.callbacks?.onProgress?.({
						stage: 'downloading',
						receivedBytes: progress.receivedBytes,
						totalBytes: progress.totalBytes
					});
				} else if (progress.stage === 'embedding') {
					options?.callbacks?.onProgress?.({
						stage: 'embedding',
						progress: progress.progress
					});
				}
			}
		});

		console.log('[DownloadService] Download completed:', filename);
		options?.callbacks?.onComplete?.(filename);
		return { success: true, filename };
	} catch (error) {
		const classifiedError = classifyDownloadError(error);

		// Handle cancellation specially (not an error state)
		if (classifiedError.code === 'DOWNLOAD_CANCELLED') {
			console.log('[DownloadService] Download cancelled:', filename);
			options?.callbacks?.onCancel?.();
		} else {
			console.error('[DownloadService] Download failed:', error);
			options?.callbacks?.onError?.(classifiedError);
		}

		return { success: false, error: classifiedError };
	}
}

/**
 * Helper to build a filename for a track download
 * Useful for components that need to know the filename before initiating download
 */
export function buildDownloadFilename(
	track: Track,
	quality?: AudioQuality,
	convertAacToMp3?: boolean
): string {
	const effectiveQuality = quality ?? 'LOSSLESS';
	const effectiveConvert = convertAacToMp3 ?? false;

	return buildTrackFilename(
		track.album,
		track,
		effectiveQuality,
		formatArtists(track.artists),
		effectiveConvert
	);
}
