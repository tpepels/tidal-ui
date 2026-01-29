import type { AudioQuality, Track } from '$lib/types';
import { downloadLogStore } from '$lib/stores/downloadLog';
import { retryFetch } from '$lib/errors';
import { toasts } from '$lib/stores/toasts';
import { getSessionHeaders } from '$lib/core/session';

/**
 * Calculate a simple checksum for a blob (first 1MB or entire blob if smaller)
 */
const calculateBlobChecksum = async (blob: Blob): Promise<string> => {
	const chunkSize = Math.min(blob.size, 1024 * 1024); // Use first 1MB or entire blob if smaller
	const buffer = await blob.slice(0, chunkSize).arrayBuffer();
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const formatDownloadError = (payload: unknown, fallback: string): string => {
	if (!payload) return fallback;
	if (typeof payload === 'string') return payload;
	if (!isRecord(payload)) return fallback;

	const errorValue = payload.error;
	if (typeof errorValue === 'string') return errorValue;
	if (isRecord(errorValue)) {
		const message = typeof errorValue.message === 'string' ? errorValue.message : undefined;
		const suggestion = typeof errorValue.suggestion === 'string' ? errorValue.suggestion : undefined;
		if (message && suggestion) return `${message} ${suggestion}`;
		if (message) return message;
	}

	const directMessage =
		typeof payload.userMessage === 'string'
			? payload.userMessage
			: typeof payload.message === 'string'
				? payload.message
				: undefined;
	return directMessage ?? fallback;
};

// Convert blob to base64
const blobToBase64 = async (blob: Blob): Promise<string> => {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
};

// Upload blob in chunks with progress tracking
const uploadInChunks = async (
	blob: Blob,
	uploadId: string,
	totalChunks: number,
	chunkSize: number,
	onProgress?: (progress: { uploaded: number; total: number; speed?: number; eta?: number }) => void,
	signal?: AbortSignal
): Promise<{
	success: boolean;
	filepath?: string;
	message?: string;
	error?: string;
	action?: string;
}> => {
	if (!Number.isFinite(totalChunks) || totalChunks <= 0) {
		throw new Error('Invalid totalChunks for upload');
	}
	if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
		throw new Error('Invalid chunkSize for upload');
	}
	const startTime = Date.now();
	let uploadedBytes = 0;

	let finalData: {
		success?: boolean;
		filepath?: string;
		message?: string;
		action?: string;
	} | null = null;

	for (let i = 0; i < totalChunks; i++) {
		if (signal?.aborted) {
			throw new DOMException('Aborted', 'AbortError');
		}
		const start = i * chunkSize;
		const end = Math.min(start + chunkSize, blob.size);
		const chunk = blob.slice(start, end);

		const response = await retryFetch(`/api/download-track/${uploadId}/chunk`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
				'x-chunk-index': i.toString(),
				'x-total-chunks': totalChunks.toString(),
				...getSessionHeaders()
			},
			body: chunk,
			timeout: 30000, // Longer for uploads
			signal,
			maxRetries: 3
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => null);
			const errMsg = formatDownloadError(
				errorData,
				`Chunk ${i + 1} upload failed: ${response.status}`
			);
			console.error(`[Chunk Upload] Failed: ${errMsg}`);
			throw new Error(errMsg);
		}

		uploadedBytes += chunk.size;

		// Calculate progress metrics
		const elapsed = (Date.now() - startTime) / 1000; // seconds
		const speed = uploadedBytes / elapsed; // bytes per second
		const remaining = blob.size - uploadedBytes;
		const eta = speed > 0 ? remaining / speed : undefined;

		onProgress?.({
			uploaded: uploadedBytes,
			total: blob.size,
			speed,
			eta
		});

		downloadLogStore.log(
			`Uploaded chunk ${i + 1}/${totalChunks} (${((uploadedBytes / blob.size) * 100).toFixed(1)}%)`
		);

		if (i === totalChunks - 1) {
			finalData = await response.json().catch(() => null);
		}
	}

	if (!finalData || finalData.success !== true) {
		throw new Error('Failed to complete chunked upload');
	}
	return {
		success: true,
		filepath: finalData.filepath,
		message: finalData.message,
		action: finalData.action || 'overwrite'
	};
};

export const downloadTrackServerSide = async (
	trackId: number,
	quality: AudioQuality,
	albumTitle: string,
	artistName: string,
	trackTitle?: string,
	blob?: Blob,
	track?: Track, // Track object for metadata embedding
	options?: {
		useChunks?: boolean;
		chunkSize?: number;
		conflictResolution?: 'overwrite' | 'skip' | 'rename' | 'overwrite_if_different';
		checkExisting?: boolean;
		downloadCoverSeperately?: boolean;
		coverUrl?: string;
		signal?: AbortSignal;
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
}> => {
	try {
		if (!blob) {
			console.error('[Server Download] No blob provided');
			return {
				success: false,
				error: 'No blob provided'
			};
		}

		const totalBytes = blob.size;
		const useChunks = options?.useChunks ?? blob.size > 1024 * 1024; // Use chunks for files > 1MB for better progress granularity
		const chunkSize = options?.chunkSize ?? 2 * 1024 * 1024; // 2MB chunks (reduced CPU load)
		const conflictResolution = options?.conflictResolution ?? 'overwrite_if_different';

		const sizeMsg = `[Server Download] Phase 1: Sending metadata for "${trackTitle}" (${(blob.size / 1024 / 1024).toFixed(2)} MB)${useChunks ? ' (chunked)' : ''}`;
		downloadLogStore.log(sizeMsg);

		// Generate checksum for integrity check
		const checksum = await calculateBlobChecksum(blob);

		const trackMetadata = track
			? {
					track: {
						id: track.id,
						title: track.title,
						duration: track.duration,
						replayGain: track.replayGain,
						peak: track.peak,
						trackNumber: track.trackNumber,
						volumeNumber: track.volumeNumber,
						version: track.version,
						isrc: track.isrc,
						copyright: track.copyright,
						artists: track.artists,
						album: {
							id: track.album.id,
							title: track.album.title,
							cover: track.album.cover,
							releaseDate: track.album.releaseDate,
							numberOfTracks: track.album.numberOfTracks,
							numberOfVolumes: track.album.numberOfVolumes,
							copyright: track.album.copyright,
							artist: track.album.artist,
							artists: track.album.artists
						}
					},
					info: undefined // We don't have lookup info in server context
				}
			: undefined;

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
					signal: options?.signal,
					maxRetries: 1
				});

				if (checkResponse.ok) {
					const checkData = await checkResponse.json();
					if (checkData.exists) {
						downloadLogStore.warning(
							`File already exists on server: ${checkData.filepath}`
						);
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

		const response = await retryFetch('/api/download-track', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
			body: JSON.stringify({
				trackId,
				quality,
				albumTitle,
				artistName,
				trackTitle,
				blobSize: totalBytes,
				useChunks,
				chunkSize,
				checksum,
				conflictResolution,
				downloadCoverSeperately: options?.downloadCoverSeperately ?? false,
				coverUrl: options?.coverUrl,
				trackMetadata
			}),
			timeout: 10000,
			signal: options?.signal,
			maxRetries: 2
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => null);
			const errMsg = formatDownloadError(errorData, `HTTP ${response.status}`);
			console.error(`[Server Download] Phase 1 failed: ${errMsg}`);
			throw new Error(errMsg);
		}

		const responseData = await response.json();
		const { uploadId, chunked, totalChunks } = responseData;

		if (chunked && useChunks) {
			if (!Number.isFinite(totalChunks) || totalChunks <= 0) {
				throw new Error('Invalid chunked upload response');
			}
			// Chunked upload
			const uploadResult = await uploadInChunks(
				blob,
				uploadId,
				totalChunks,
				chunkSize,
				options?.onProgress,
				options?.signal
			);
			if (uploadResult.success) {
				const toastMessage = uploadResult.message ?? 'Server download completed';
				toasts.success(`Download completed: ${toastMessage}`);
			}
			return uploadResult;
		} else {
			// Single upload
			const base64 = await blobToBase64(blob);
			// Prepare track metadata for server-side embedding
			const downloadCoverSeperately = options?.downloadCoverSeperately ?? false;

			const uploadResponse = await fetch('/api/download-track', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
				body: JSON.stringify({
					uploadId,
					trackId,
					quality,
					albumTitle,
					artistName,
					trackTitle,
					blob: base64,
					conflictResolution: options?.conflictResolution || 'overwrite_if_different',
					downloadCoverSeperately,
					coverUrl: options?.coverUrl,
					trackMetadata
				}),
				signal: options?.signal
			});

			if (!uploadResponse.ok) {
				const errorData = await uploadResponse.json().catch(() => null);
				const errMsg = formatDownloadError(errorData, `Upload failed: ${uploadResponse.status}`);
				console.error(`[Server Download] Direct upload failed: ${errMsg}`);
				throw new Error(errMsg);
			}

			const data = await uploadResponse.json();
			toasts.success(`Download completed: ${data.message}`);
			return {
				success: true,
				filepath: data.filepath,
				message: data.message,
				action: data.action
			};
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw error;
		}
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[Server Download] Error: ${errorMsg}`);
		toasts.error(`Download failed: ${errorMsg}`, {
			action: {
				label: 'Retry',
				handler: () =>
					downloadTrackServerSide(
						trackId,
						quality,
						albumTitle,
						artistName,
						trackTitle,
						blob,
						undefined, // No track metadata available for retry
						options
					)
			}
		});
		return {
			success: false,
			error: errorMsg
		};
	}
};
