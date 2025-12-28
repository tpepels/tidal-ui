import { losslessAPI } from './api';
import type { Album, Track, AudioQuality } from './types';
import type { DownloadMode, DownloadStorage } from './stores/downloadPreferences';

import { downloadLogStore } from './stores/downloadLog';
import { downloadUiStore } from './stores/downloadUi';
import { retryFetch } from './errors';
import { toasts } from './stores/toasts';
import { formatArtists } from './utils/formatters';
import JSZip from 'jszip';

const BASE_DELAY_MS = 1000;

/**
 * Calculate a simple checksum for a blob (first 1MB or entire blob if smaller)
 */
async function calculateBlobChecksum(blob: Blob): Promise<string> {
	const chunkSize = Math.min(blob.size, 1024 * 1024); // Use first 1MB or entire blob if smaller
	const buffer = await blob.slice(0, chunkSize).arrayBuffer();
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function detectImageFormat(data: Uint8Array): { extension: string; mimeType: string } | null {
	if (!data || data.length < 4) {
		return null;
	}

	// Check for JPEG magic bytes (FF D8 FF)
	if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
		return { extension: 'jpg', mimeType: 'image/jpeg' };
	}

	// Check for PNG magic bytes (89 50 4E 47)
	if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
		return { extension: 'png', mimeType: 'image/png' };
	}

	// Check for WebP magic bytes (52 49 46 46 ... 57 45 42 50)
	if (
		data.length >= 12 &&
		data[0] === 0x52 &&
		data[1] === 0x49 &&
		data[2] === 0x46 &&
		data[3] === 0x46 &&
		data[8] === 0x57 &&
		data[9] === 0x45 &&
		data[10] === 0x42 &&
		data[11] === 0x50
	) {
		return { extension: 'webp', mimeType: 'image/webp' };
	}

	return null;
}

export function sanitizeForFilename(value: string | null | undefined): string {
	if (!value) return 'Unknown';
	return value
		.replace(/[\\/:*?"<>|]/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
}

export function getExtensionForQuality(quality: AudioQuality, convertAacToMp3 = false): string {
	switch (quality) {
		case 'LOW':
		case 'HIGH':
			return convertAacToMp3 ? 'mp3' : 'm4a';
		default:
			return 'flac';
	}
}

export function buildTrackFilename(
	album: Album,
	track: Track,
	quality: AudioQuality,
	artistName?: string,
	convertAacToMp3 = false
): string {
	const extension = getExtensionForQuality(quality, convertAacToMp3);
	const volumeNumber = Number(track.volumeNumber);
	const trackNumber = Number(track.trackNumber);

	// Check if this is a multi-volume album by checking:
	// 1. numberOfVolumes > 1, or
	// 2. volumeNumber is set and finite (indicating multi-volume structure)
	const isMultiVolume =
		(album.numberOfVolumes && album.numberOfVolumes > 1) || Number.isFinite(volumeNumber);

	let trackPart: string;
	if (isMultiVolume) {
		const volumePadded =
			Number.isFinite(volumeNumber) && volumeNumber > 0 ? `${volumeNumber}`.padStart(2, '0') : '01';
		const trackPadded =
			Number.isFinite(trackNumber) && trackNumber > 0 ? `${trackNumber}`.padStart(2, '0') : '00';
		trackPart = `${volumePadded}-${trackPadded}`;
	} else {
		const trackPadded =
			Number.isFinite(trackNumber) && trackNumber > 0 ? `${trackNumber}`.padStart(2, '0') : '00';
		trackPart = trackPadded;
	}

	let title = track.title;
	if (track.version) {
		title = `${title} (${track.version})`;
	}

	const parts = [
		sanitizeForFilename(artistName ?? formatArtists(track.artists)),
		sanitizeForFilename(album.title ?? 'Unknown Album'),
		`${trackPart} ${sanitizeForFilename(title)}`
	];
	return `${parts.join(' - ')}.${extension}`;
}

export interface AlbumDownloadCallbacks {
	onTotalResolved?(total: number): void;
	onTrackDownloaded?(completed: number, total: number, track: Track): void;
	onTrackFailed?(track: Track, error: Error, attempt: number): void;
}

function escapeCsvValue(value: string): string {
	const normalized = value.replace(/\r?\n|\r/g, ' ');
	if (/[",]/.test(normalized)) {
		return `"${normalized.replace(/"/g, '""')}"`;
	}
	return normalized;
}

export async function buildTrackLinksCsv(tracks: Track[], quality: AudioQuality): Promise<string> {
	const header = ['Index', 'Title', 'Artist', 'Album', 'Duration', 'FLAC URL'];
	const rows: string[][] = [];

	for (const [index, track] of tracks.entries()) {
		const streamUrl = await losslessAPI.getTrackStreamUrl(track.id, quality);
		rows.push([
			`${index + 1}`,
			track.title ?? '',
			formatArtists(track.artists),
			track.album?.title ?? '',
			losslessAPI.formatDuration(track.duration ?? 0),
			streamUrl
		]);
	}

	return [header, ...rows]
		.map((row) => row.map((value) => escapeCsvValue(String(value ?? ''))).join(','))
		.join('\n');
}

interface DownloadTrackResult {
	success: boolean;
	blob?: Blob;
	error?: Error;
}

async function downloadTrackWithRetry(
	trackId: number,
	quality: AudioQuality,
	filename: string,
	track: Track,
	callbacks?: AlbumDownloadCallbacks,
	options?: {
		convertAacToMp3?: boolean;
		downloadCoverSeperately?: boolean;
		storage?: DownloadStorage;
		onProgress?: (
			progress:
				| { stage: 'downloading'; receivedBytes: number; totalBytes?: number }
				| { stage: 'embedding'; progress: number }
		) => void;
	}
): Promise<DownloadTrackResult> {
	const maxAttempts = 3;
	const baseDelay = BASE_DELAY_MS; // 1 second
	const trackTitle = track.title ?? 'Unknown Track';
	const storage = options?.storage ?? 'client';

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			if (attempt > 1) {
				// Retry attempt
			}

			const { blob } = await losslessAPI.fetchTrackBlob(trackId, quality, filename, {
				ffmpegAutoTriggered: false,
				convertAacToMp3: storage === 'client' ? options?.convertAacToMp3 : false,
				onProgress: options?.onProgress
			});

			return { success: true, blob };
		} catch (error) {
			const errorObj = error instanceof Error ? error : new Error(String(error));
			console.warn(
				`[Track Download] ✗ Attempt ${attempt}/${maxAttempts} failed for "${trackTitle}": ${errorObj.message}`
			);

			callbacks?.onTrackFailed?.(track, errorObj, attempt);

			if (attempt < maxAttempts) {
				// Exponential backoff: 1s, 2s, 4s
				const delay = baseDelay * Math.pow(2, attempt - 1);
				await new Promise((resolve) => setTimeout(resolve, delay));
			} else {
				console.error(
					`[Track Download] ✗✗✗ All ${maxAttempts} attempts failed for "${trackTitle}" - giving up`
				);
				return { success: false, error: errorObj };
			}
		}
	}

	return { success: false, error: new Error('Download failed after all retry attempts') };
}

function triggerFileDownload(blob: Blob, filename: string): void {
	let url: string | null = null;
	try {
		url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	} finally {
		// Always revoke the URL to prevent memory leaks
		if (url) {
			URL.revokeObjectURL(url);
		}
	}
}

export async function downloadTrackServerSide(
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

		const totalBytes = blob.size;
		const useChunks = blob.size > 1024 * 1024; // Use chunks for files > 1MB for better progress granularity
		const chunkSize = options?.chunkSize ?? 2 * 1024 * 1024; // 2MB chunks (reduced CPU load)
		const conflictResolution = options?.conflictResolution ?? 'overwrite_if_different';

		const sizeMsg = `[Server Download] Phase 1: Sending metadata for "${trackTitle}" (${(blob.size / 1024 / 1024).toFixed(2)} MB)${useChunks ? ' (chunked)' : ''}`;
		downloadLogStore.log(sizeMsg);

		// Generate checksum for integrity check
		const checksum = await calculateBlobChecksum(blob);

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

		const response = await retryFetch('/api/download-track', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				trackId,
				quality,
				albumTitle,
				artistName,
				trackTitle,
				blobSize: useChunks ? undefined : totalBytes,
				useChunks,
				chunkSize,
				checksum,
				conflictResolution
			}),
			timeout: 10000,
			maxRetries: 2
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			const errMsg = errorData.error || `HTTP ${response.status}`;
			console.error(`[Server Download] Phase 1 failed: ${errMsg}`);
			throw new Error(errMsg);
		}

		const responseData = await response.json();
		const { uploadId, chunked, totalChunks } = responseData;

		if (chunked && useChunks) {
			// Chunked upload
			return await uploadInChunks(blob, uploadId, totalChunks, chunkSize, options?.onProgress);
		} else {
			// Single upload
			const base64 = await blobToBase64(blob);
			// Prepare track metadata for server-side embedding
			const downloadCoverSeperately = options?.downloadCoverSeperately ?? false;
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

			const uploadResponse = await fetch('/api/download-track', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
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
				})
			});

			if (!uploadResponse.ok) {
				const errorData = await uploadResponse.json().catch(() => ({}));
				const errMsg = errorData.error || `Upload failed: ${uploadResponse.status}`;
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
}

// Convert blob to base64
async function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

// Upload blob in chunks with progress tracking
async function uploadInChunks(
	blob: Blob,
	uploadId: string,
	totalChunks: number,
	chunkSize: number,
	onProgress?: (progress: { uploaded: number; total: number; speed?: number; eta?: number }) => void
): Promise<{
	success: boolean;
	filepath?: string;
	message?: string;
	error?: string;
	action?: string;
}> {
	const startTime = Date.now();
	let uploadedBytes = 0;

	for (let i = 0; i < totalChunks; i++) {
		const start = i * chunkSize;
		const end = Math.min(start + chunkSize, blob.size);
		const chunk = blob.slice(start, end);

		const response = await retryFetch(`/api/download-track/${uploadId}/chunk`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
				'x-chunk-index': i.toString(),
				'x-total-chunks': totalChunks.toString()
			},
			body: chunk,
			timeout: 30000, // Longer for uploads
			maxRetries: 3
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			const errMsg = errorData.error
				? JSON.stringify(errorData.error)
				: `Chunk ${i + 1} upload failed: ${response.status}`;
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
	}

	// Final response should be available from the last chunk upload
	const finalResponse = await retryFetch(`/api/download-track/${uploadId}/chunk`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/octet-stream',
			'x-chunk-index': totalChunks.toString(),
			'x-total-chunks': totalChunks.toString()
		},
		body: new ArrayBuffer(0), // Empty chunk to finalize
		timeout: 10000,
		maxRetries: 2
	});

	if (!finalResponse.ok) {
		throw new Error('Failed to complete chunked upload');
	}

	const data = await finalResponse.json();
	return {
		success: true,
		filepath: data.filepath,
		message: data.message,
		action: data.action || 'overwrite'
	};
}

// Helper: Process array of async tasks in parallel with concurrency limit
async function parallelMap<T, R>(
	items: T[],
	asyncFn: (item: T, index: number) => Promise<R>,
	maxConcurrent: number = 3
): Promise<R[]> {
	const results: R[] = [];
	const executing: Promise<void>[] = [];

	for (let index = 0; index < items.length; index++) {
		const item = items[index];
		const promise = Promise.resolve()
			.then(() => asyncFn(item, index))
			.then((result) => {
				results[index] = result;
			});

		executing.push(promise);

		if (executing.length >= maxConcurrent) {
			await Promise.race(executing);
			executing.splice(
				executing.findIndex((p) => p === promise),
				1
			);
		}
	}

	await Promise.all(executing);
	return results;
}

export async function downloadAlbum(
	album: Album,
	quality: AudioQuality,
	callbacks?: AlbumDownloadCallbacks,
	preferredArtistName?: string,
	options?: {
		mode?: DownloadMode;
		convertAacToMp3?: boolean;
		downloadCoverSeperately?: boolean;
		storage?: DownloadStorage;
	}
): Promise<void> {
	const { album: fetchedAlbum, tracks } = await losslessAPI.getAlbum(album.id);
	const canonicalAlbum = fetchedAlbum ?? album;
	const total = tracks.length;
	callbacks?.onTotalResolved?.(total);
	const mode = options?.mode ?? 'individual';
	const shouldZip = mode === 'zip' && total > 1;
	const useCsv = mode === 'csv';
	const convertAacToMp3 = options?.convertAacToMp3 ?? false;
	const storage = options?.storage ?? 'client';
	const downloadCoverSeperately = options?.downloadCoverSeperately ?? false;
	const artistName = sanitizeForFilename(
		preferredArtistName ?? canonicalAlbum.artist?.name ?? 'Unknown Artist'
	);
	const albumTitle = sanitizeForFilename(canonicalAlbum.title ?? 'Unknown Album');

	// Track which album covers have already been downloaded to avoid duplicates
	const downloadedCovers = new Set<string>();

	// Memory monitoring for adaptive concurrency
	const getMemoryUsage = (): number => {
		if (typeof performance !== 'undefined' && 'memory' in performance) {
			const perfMemory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
			return perfMemory?.usedJSHeapSize ?? 0;
		}
		return 0;
	};

	const isHighMemoryUsage = (): boolean => {
		const usage = getMemoryUsage();
		const limit = 500 * 1024 * 1024; // 500MB threshold
		return usage > limit;
	};

	downloadLogStore.log(`Starting: "${albumTitle}" by ${artistName}`);
	downloadLogStore.log(`Tracks: ${total} | Quality: ${quality} | Mode: ${mode}`);

	if (useCsv) {
		let completed = 0;
		for (const track of tracks) {
			completed += 1;
			callbacks?.onTrackDownloaded?.(completed, total, track);
		}
		const csvContent = await buildTrackLinksCsv(tracks, quality);
		const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		triggerFileDownload(csvBlob, `${artistName} - ${albumTitle}.csv`);
		return;
	}

	if (shouldZip) {
		const zip = new JSZip();
		let completed = 0;
		const failedTracks: Array<{ track: Track; error: Error }> = [];

		// Download cover separately for ZIP if requested
		if (downloadCoverSeperately && canonicalAlbum.cover) {
			try {
				// Try multiple sizes as fallback
				const coverSizes: Array<'1280' | '640' | '320'> = ['1280', '640', '320'];
				let coverDownloadSuccess = false;

				for (const size of coverSizes) {
					if (coverDownloadSuccess) break;

					const coverUrl = losslessAPI.getCoverUrl(canonicalAlbum.cover, size);

					// Try two fetch strategies: with headers, then without
					const fetchStrategies = [
						{
							name: 'with-headers',
							options: {
								method: 'GET' as const,
								headers: {
									Accept: 'image/jpeg,image/jpg,image/png,image/*',
									'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
								},
								signal: AbortSignal.timeout(10000)
							}
						},
						{
							name: 'simple',
							options: {
								method: 'GET' as const,
								signal: AbortSignal.timeout(10000)
							}
						}
					];

					for (const strategy of fetchStrategies) {
						if (coverDownloadSuccess) break;

						try {
							const coverResponse = await fetch(coverUrl, strategy.options);

							if (!coverResponse.ok) {
								console.warn(
									`[ZIP Cover Download] Failed with status ${coverResponse.status} for size ${size}`
								);
								continue;
							}

							const contentType = coverResponse.headers.get('Content-Type');
							const contentLength = coverResponse.headers.get('Content-Length');

							if (contentLength && parseInt(contentLength, 10) === 0) {
								console.warn(`[ZIP Cover Download] Content-Length is 0 for size ${size}`);
								continue;
							}

							if (contentType && !contentType.startsWith('image/')) {
								console.warn(`[ZIP Cover Download] Invalid content type: ${contentType}`);
								continue;
							}

							// Use arrayBuffer directly for more reliable data retrieval
							const arrayBuffer = await coverResponse.arrayBuffer();

							if (!arrayBuffer || arrayBuffer.byteLength === 0) {
								console.warn(`[ZIP Cover Download] Empty array buffer for size ${size}`);
								continue;
							}

							const uint8Array = new Uint8Array(arrayBuffer);

							// Detect image format
							const imageFormat = detectImageFormat(uint8Array);
							if (!imageFormat) {
								console.warn(`[ZIP Cover Download] Unknown image format for size ${size}`);
								continue;
							}

							// Add cover to ZIP with appropriate filename
							const coverFilename = `cover.${imageFormat.extension}`;
							zip.file(coverFilename, uint8Array, {
								binary: true,
								compression: 'DEFLATE',
								compressionOptions: { level: 6 }
							});

							coverDownloadSuccess = true;
							break;
						} catch (sizeError) {
							console.warn(
								`[ZIP Cover Download] Failed at size ${size} with strategy ${strategy.name}:`,
								sizeError
							);
						}
					} // End strategy loop
				} // End size loop

				if (!coverDownloadSuccess) {
					console.warn('[ZIP Cover Download] All attempts failed');
				}
			} catch (coverError) {
				console.warn('Failed to download cover for ZIP:', coverError);
			}
		}

		for (const track of tracks) {
			const filename = buildTrackFilename(
				canonicalAlbum,
				track,
				quality,
				preferredArtistName,
				convertAacToMp3
			);

			const result = await downloadTrackWithRetry(track.id, quality, filename, track, callbacks, {
				convertAacToMp3,
				storage: 'client'
			});

			if (result.success && result.blob) {
				zip.file(filename, result.blob);
			} else {
				console.error(`[ZIP Download] Track failed: ${track.title}`, result.error);
				failedTracks.push({ track, error: result.error ?? new Error('Unknown error') });
			}

			completed += 1;
			callbacks?.onTrackDownloaded?.(completed, total, track);
		}

		// Add error report file if there were failures
		if (failedTracks.length > 0) {
			let errorReport = 'DOWNLOAD ERRORS\n';
			errorReport += '===============\n\n';
			errorReport += 'The following tracks failed to download after 3 attempts:\n\n';

			failedTracks.forEach((item, index) => {
				const { track, error } = item;
				const trackTitle = track.title ?? 'Unknown Track';
				const artistName = formatArtists(track.artists);
				errorReport += `${index + 1}. ${trackTitle} - ${artistName}\n`;
				errorReport += `   Error: ${error.message}\n\n`;
			});

			zip.file('_DOWNLOAD_ERRORS.txt', errorReport);
		}

		const zipBlob = await zip.generateAsync({
			type: 'blob',
			compression: 'DEFLATE',
			compressionOptions: { level: 6 }
		});

		if (failedTracks.length > 0) {
			// Handle failed tracks if needed
		}

		triggerFileDownload(zipBlob, `${artistName} - ${albumTitle}.zip`);
		return;
	}

	// Individual download mode - process in parallel (adaptive concurrency based on memory)

	// Adaptive concurrency: reduce when memory usage is high
	const maxConcurrent = isHighMemoryUsage() ? 1 : 2;
	console.log(
		`[Album Download] Using max ${maxConcurrent} concurrent downloads (memory: ${Math.round(getMemoryUsage() / 1024 / 1024)}MB)`
	);

	// Create async download task for each track
	const downloadTasks = tracks.map(async (track) => {
		const filename = buildTrackFilename(
			canonicalAlbum,
			track,
			quality,
			preferredArtistName,
			convertAacToMp3
		);

		// Start tracking this track download
		const { taskId } = downloadUiStore.beginTrackDownload(track, filename, {
			subtitle: album.title
		});

		// Initialize progress to show download has started
		downloadUiStore.updateTrackStage(taskId, 0.1);

		try {
			if (storage === 'server') {
				// Server-side download
				try {
					const result = await downloadTrackWithRetry(
						track.id,
						quality,
						filename,
						track,
						undefined, // no callbacks for parallel
						{
							convertAacToMp3,
							downloadCoverSeperately,
							storage: 'server',
							onProgress: (progress) => {
								if (progress.stage === 'downloading') {
									downloadUiStore.updateTrackProgress(
										taskId,
										progress.receivedBytes,
										progress.totalBytes
									);
								} else if (progress.stage === 'embedding') {
									downloadUiStore.updateTrackStage(taskId, progress.progress);
								}
							}
						}
					);

					if (result.success && result.blob) {
						const serverResult = await downloadTrackServerSide(
							track.id,
							quality,
							albumTitle,
							artistName,
							track.title,
							result.blob,
							track, // Pass track object for metadata
							{
								conflictResolution: 'overwrite_if_different',
								downloadCoverSeperately,
								coverUrl:
									downloadCoverSeperately && canonicalAlbum.cover
										? losslessAPI.getCoverUrl(canonicalAlbum.cover, '1280')
										: undefined
							}
						);
						if (serverResult.success) {
							downloadUiStore.completeTrackDownload(taskId);
							return { success: true, track };
						} else {
							downloadLogStore.error(`Server download failed: ${serverResult.error}`);
							downloadUiStore.errorTrackDownload(taskId, serverResult.error);
							return { success: false, track, error: serverResult.error };
						}
					} else {
						downloadLogStore.error(`Failed to fetch track: ${result.error}`);
						downloadUiStore.errorTrackDownload(taskId, result.error);
						return { success: false, track, error: result.error };
					}
				} catch (error) {
					downloadLogStore.error(`Server download error: ${error}`);
					downloadUiStore.errorTrackDownload(taskId, error);
					return { success: false, track, error };
				}
			} else {
				// Client-side download
				const result = await downloadTrackWithRetry(
					track.id,
					quality,
					filename,
					track,
					undefined, // no callbacks for parallel
					{
						convertAacToMp3,
						downloadCoverSeperately,
						storage: 'client',
						onProgress: (progress) => {
							if (progress.stage === 'downloading') {
								downloadUiStore.updateTrackProgress(
									taskId,
									progress.receivedBytes,
									progress.totalBytes
								);
							} else if (progress.stage === 'embedding') {
								downloadUiStore.updateTrackStage(taskId, progress.progress);
							}
						}
					}
				);

				if (result.success && result.blob) {
					// Update progress to show download is starting
					downloadUiStore.updateTrackStage(taskId, 0.5);

					// Trigger individual download
					let url: string | null = null;
					try {
						url = URL.createObjectURL(result.blob);
						const a = document.createElement('a');
						a.href = url;
						a.download = filename;
						document.body.appendChild(a);
						a.click();
						document.body.removeChild(a);
					} finally {
						// Always revoke the URL to prevent memory leaks
						if (url) {
							URL.revokeObjectURL(url);
						}
					}

					// Explicit memory cleanup
					setTimeout(() => {
						// Force garbage collection hint for memory-constrained browsers
						if (typeof window !== 'undefined' && 'gc' in window) {
							const winWithGC = window as { gc?: () => void };
							winWithGC.gc?.();
						}
					}, 100);

					// Download cover separately if enabled, not server storage, and not already downloaded
					if (
						downloadCoverSeperately &&
						storage === 'client' &&
						track.album?.cover &&
						!downloadedCovers.has(track.album.cover)
					) {
						console.log(
							`[Cover Download] Starting download for cover ${track.album.cover}, downloadedCovers:`,
							Array.from(downloadedCovers)
						);
						try {
							const coverId = track.album.cover;
							const coverSizes: Array<'1280' | '640' | '320'> = ['1280', '640', '320'];
							let coverDownloadSuccess = false;

							for (const size of coverSizes) {
								if (coverDownloadSuccess) break;

								const coverUrl = losslessAPI.getCoverUrl(coverId, size);
								const fetchStrategies = [
									{
										name: 'with-headers',
										options: {
											method: 'GET' as const,
											headers: {
												Accept: 'image/jpeg,image/jpg,image/png,image/*',
												'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
											},
											signal: AbortSignal.timeout(10000)
										}
									},
									{
										name: 'simple',
										options: {
											method: 'GET' as const,
											signal: AbortSignal.timeout(10000)
										}
									}
								];

								for (const strategy of fetchStrategies) {
									if (coverDownloadSuccess) break;

									try {
										const coverResponse = await fetch(coverUrl, strategy.options);

										if (!coverResponse.ok) continue;

										const contentType = coverResponse.headers.get('Content-Type');
										const contentLength = coverResponse.headers.get('Content-Length');

										if (contentLength && parseInt(contentLength, 10) === 0) continue;
										if (contentType && !contentType.startsWith('image/')) continue;

										const arrayBuffer = await coverResponse.arrayBuffer();
										if (!arrayBuffer || arrayBuffer.byteLength === 0) continue;

										const uint8Array = new Uint8Array(arrayBuffer);
										const imageFormat = detectImageFormat(uint8Array);
										if (!imageFormat) continue;

										const coverBlob = new Blob([uint8Array], { type: imageFormat.mimeType });
										let coverObjectUrl: string | null = null;
										try {
											coverObjectUrl = URL.createObjectURL(coverBlob);
											const coverLink = document.createElement('a');
											coverLink.href = coverObjectUrl;
											coverLink.download = `cover.${imageFormat.extension}`;
											document.body.appendChild(coverLink);
											coverLink.click();
											document.body.removeChild(coverLink);
										} finally {
											// Always revoke the URL to prevent memory leaks
											if (coverObjectUrl) {
												URL.revokeObjectURL(coverObjectUrl);
											}
										}

										downloadedCovers.add(coverId);
										console.log(
											`[Cover Download] Successfully downloaded cover ${coverId}, added to set`
										);

										coverDownloadSuccess = true;
										break;
									} catch {
										// Continue to next strategy
									}
								}
							}
						} catch (coverError) {
							console.warn('Failed to download cover separately:', coverError);
						}
					}
				} else {
					downloadLogStore.error(`Download failed: ${result.error}`);
					downloadUiStore.errorTrackDownload(taskId, result.error);
					return { success: false, track, error: result.error };
				}

				// Mark as 100% complete
				downloadUiStore.updateTrackStage(taskId, 1.0);
				downloadUiStore.completeTrackDownload(taskId);
				return { success: true, track };
			}
		} catch (error) {
			downloadLogStore.error(`Processing error: ${error}`);
			downloadUiStore.errorTrackDownload(taskId, error);
			return { success: false, track, error };
		} finally {
			// Progress tracking is now handled after all tasks complete to avoid race conditions
		}
	});

	// Wait for all downloads to complete (adaptive concurrency based on memory)
	const results = await parallelMap(downloadTasks, (task) => task, maxConcurrent);

	// Count successes/failures (avoiding race conditions)
	const completedCount = results.filter((r) => r.success).length;
	const failedCount = results.filter((r) => !r.success).length;

	// Progress logging and callbacks (now safe since all tasks are complete)
	const progressMsg = `Progress: ${completedCount}/${total} tracks`;
	downloadLogStore.log(progressMsg);
	if (completedCount === total) {
		downloadLogStore.success('All downloads completed!');
	}
	results.forEach((result, index) => {
		callbacks?.onTrackDownloaded?.(index + 1, total, result.track);
	});

	// Summary logging
	if (failedCount > 0) {
		downloadLogStore.warning(`${failedCount} downloads failed out of ${total} total tracks`);
	}
}
