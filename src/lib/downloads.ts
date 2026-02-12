import { losslessAPI } from './api';
import type { Album, Track, AudioQuality } from './types';
import type { DownloadMode, DownloadStorage } from './stores/downloadPreferences';

import { downloadTrackServerSide as downloadTrackServerSideImpl } from './server-upload/uploadService';
import { formatArtists } from './utils/formatters';

const BASE_DELAY_MS = 1000;

export const downloadTrackServerSide = downloadTrackServerSideImpl;

export function detectImageFormat(data: Uint8Array): { extension: string; mimeType: string } | null {
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

export { detectAudioFormat, detectAudioFormatFromBlob } from './utils/audioFormat';

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

export interface AlbumDownloadResult {
	storage: DownloadStorage;
	totalTracks: number;
	completedTracks: number;
	failedTracks: number;
	jobId?: string;
}

export type ServerDownloadProgress =
	| { stage: 'downloading'; receivedBytes: number; totalBytes?: number }
	| { stage: 'embedding'; progress: number }
	| { stage: 'uploading'; uploadedBytes: number; totalBytes: number; speed?: number; eta?: number };

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

export interface DownloadTrackResult {
	success: boolean;
	blob?: Blob;
	mimeType?: string;
	error?: Error;
}

export async function downloadTrackWithRetry(
	trackId: number,
	quality: AudioQuality,
	filename: string,
	track: Track,
	callbacks?: AlbumDownloadCallbacks,
	options?: {
		convertAacToMp3?: boolean;
		downloadCoverSeperately?: boolean;
		storage?: DownloadStorage;
		signal?: AbortSignal;
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
	const isE2E =
		import.meta.env.VITE_E2E === 'true' &&
		typeof window !== 'undefined' &&
		Boolean((window as Window & { __tidalE2E?: boolean }).__tidalE2E);

	if (isE2E && storage === 'server') {
		const blob = new Blob(['E2E'], {
			type: quality === 'LOSSLESS' || quality === 'HI_RES_LOSSLESS' ? 'audio/flac' : 'audio/mp4'
		});
		options?.onProgress?.({
			stage: 'downloading',
			receivedBytes: blob.size,
			totalBytes: blob.size
		});
		return { success: true, blob };
	}

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			if (attempt > 1) {
				// Retry attempt
			}

			const { blob, mimeType } = await losslessAPI.fetchTrackBlob(trackId, quality, filename, {
				ffmpegAutoTriggered: false,
				convertAacToMp3: storage === 'client' ? options?.convertAacToMp3 : false,
				skipMetadataEmbedding: storage === 'server',
				signal: options?.signal,
				onProgress: options?.onProgress
			});

			return { success: true, blob, mimeType };
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				throw error;
			}
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

export function triggerFileDownload(blob: Blob, filename: string): void {
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

export async function downloadTrackToServer(
	track: Track,
	quality: AudioQuality,
	options?: {
		convertAacToMp3?: boolean;
		downloadCoverSeperately?: boolean;
		conflictResolution?: 'overwrite' | 'skip' | 'rename' | 'overwrite_if_different';
		signal?: AbortSignal;
		onProgress?: (progress: ServerDownloadProgress) => void;
	}
): Promise<{
	success: boolean;
	filename: string;
	filepath?: string;
	message?: string;
	action?: string;
	error?: string;
}> {
	const convertAacToMp3 = false;
	const filename = buildTrackFilename(
		track.album,
		track,
		quality,
		formatArtists(track.artists),
		convertAacToMp3
	);

	const fetchResult = await downloadTrackWithRetry(
		track.id,
		quality,
		filename,
		track,
		undefined,
		{
			convertAacToMp3,
			downloadCoverSeperately: false,
			storage: 'server',
			signal: options?.signal,
			onProgress: (progress) => {
				if (progress.stage === 'downloading') {
					options?.onProgress?.({
						stage: 'downloading',
						receivedBytes: progress.receivedBytes,
						totalBytes: progress.totalBytes
					});
				} else if (progress.stage === 'embedding') {
					options?.onProgress?.({ stage: 'embedding', progress: progress.progress });
				}
			}
		}
	);

	if (!fetchResult.success || !fetchResult.blob) {
		const errorMessage =
			fetchResult.error instanceof Error
				? fetchResult.error.message
				: typeof fetchResult.error === 'string'
					? fetchResult.error
					: 'Failed to fetch track for server download';
		return { success: false, filename, error: errorMessage };
	}

	const coverUrl =
		options?.downloadCoverSeperately && track.album?.cover
			? losslessAPI.getCoverUrl(track.album.cover, '1280')
			: undefined;

	const resolvedTrackTitle = track.title
		? track.version
			? `${track.title} (${track.version})`
			: track.title
		: undefined;

	const uploadResult = await downloadTrackServerSide(
		track.id,
		quality,
		track.album?.title ?? 'Unknown Album',
		formatArtists(track.artists),
		resolvedTrackTitle,
		fetchResult.blob,
		track,
		{
			conflictResolution: options?.conflictResolution,
			downloadCoverSeperately: options?.downloadCoverSeperately ?? false,
			coverUrl,
			detectedMimeType: fetchResult.mimeType,
			signal: options?.signal,
			onProgress: (progress) => {
				options?.onProgress?.({
					stage: 'uploading',
					uploadedBytes: progress.uploaded,
					totalBytes: progress.total,
					speed: progress.speed,
					eta: progress.eta
				});
			}
		}
	);

	if (!uploadResult.success) {
		return {
			success: false,
			filename,
			error: uploadResult.error ?? 'Server upload failed'
		};
	}

	return {
		success: true,
		filename,
		filepath: uploadResult.filepath,
		message: uploadResult.message,
		action: uploadResult.action
	};
}

// Helper: Process array of async tasks in parallel with concurrency limit
export async function parallelMap<T, R>(
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
): Promise<AlbumDownloadResult> {
	const storage = options?.storage ?? 'server';

	// For server downloads, submit to the Redis-backed queue API
	if (storage === 'server') {
		// Fetch album info
		const { album: fetchedAlbum, tracks } = await losslessAPI.getAlbum(album.id);
		const canonicalAlbum = fetchedAlbum ?? album;

		if (!tracks || tracks.length === 0) {
			throw new Error('No tracks found for album');
		}

		const artistName = preferredArtistName ?? canonicalAlbum.artist?.name ?? 'Unknown Artist';
		const albumTitle = canonicalAlbum.title ?? 'Unknown Album';
		const trackCount = tracks.length;

		// Submit album job to server queue
		const response = await fetch('/api/download-queue', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				job: {
					type: 'album',
					albumId: album.id,
					quality,
					artistName,
					albumTitle,
					trackCount
				}
			})
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Failed to queue album: ${error}`);
		}

		const payload = (await response.json()) as { success?: boolean; jobId?: string };
		if (!payload.success || !payload.jobId) {
			throw new Error('Failed to queue album: missing job id');
		}
		callbacks?.onTotalResolved?.(tracks.length);

		// Note: Individual track progress callbacks won't work with queue system
		// User should monitor via DownloadManager UI instead
		return {
			storage: 'server',
			totalTracks: tracks.length,
			completedTracks: 0,
			failedTracks: 0,
			jobId: payload.jobId
		};
	}

	const { album: fetchedAlbum, tracks } = await losslessAPI.getAlbum(album.id);
	const canonicalAlbum = fetchedAlbum ?? album;
	if (!tracks || tracks.length === 0) {
		throw new Error('No tracks found for album');
	}

	const totalTracks = tracks.length;
	callbacks?.onTotalResolved?.(totalTracks);

	const artistName = preferredArtistName ?? canonicalAlbum.artist?.name ?? 'Unknown Artist';
	const convertAacToMp3 = options?.convertAacToMp3 ?? false;
	const downloadCoverSeperately = options?.downloadCoverSeperately ?? false;

	let completedTracks = 0;
	let failedTracks = 0;

	for (const track of tracks) {
		const filename = buildTrackFilename(
			canonicalAlbum,
			track,
			quality,
			artistName,
			convertAacToMp3
		);

		const result = await downloadTrackWithRetry(track.id, quality, filename, track, callbacks, {
			convertAacToMp3,
			downloadCoverSeperately,
			storage: 'client'
		});

		if (result.success && result.blob) {
			triggerFileDownload(result.blob, filename);
			completedTracks += 1;
			callbacks?.onTrackDownloaded?.(completedTracks, totalTracks, track);
			continue;
		}

		failedTracks += 1;
	}

	return {
		storage: 'client',
		totalTracks,
		completedTracks,
		failedTracks
	};
}
