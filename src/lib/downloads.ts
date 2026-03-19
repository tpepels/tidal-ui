import { losslessAPI } from './api';
import type { Album, Track, AudioQuality } from './types';
import type { DownloadMode, DownloadStorage } from './stores/downloadPreferences';

import { downloadTrackServerSide as downloadTrackServerSideImpl } from './server-upload/uploadService';
import { formatArtists } from './utils/formatters';

const BASE_DELAY_MS = 1000;

export const downloadTrackServerSide = downloadTrackServerSideImpl;

export function detectImageFormat(
	data: Uint8Array
): { extension: string; mimeType: string } | null {
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

function warnIfAlbumTrackListIncomplete(album: Album, tracks: Track[]): void {
	const rawExpectedCount = Number(album.numberOfTracks);
	if (!Number.isFinite(rawExpectedCount) || rawExpectedCount <= 0) {
		return;
	}
	const expectedCount = Math.trunc(rawExpectedCount);
	const observedTrackNumbers = new Set<number>();
	for (const track of tracks) {
		const trackNumber = Number(track.trackNumber);
		if (Number.isFinite(trackNumber) && trackNumber > 0) {
			observedTrackNumbers.add(Math.trunc(trackNumber));
		}
	}

	const missingTrackNumbers: number[] = [];
	for (let expected = 1; expected <= expectedCount; expected += 1) {
		if (!observedTrackNumbers.has(expected)) {
			missingTrackNumbers.push(expected);
		}
	}

	if (tracks.length >= expectedCount && missingTrackNumbers.length === 0) {
		return;
	}

	const missingPart =
		missingTrackNumbers.length > 0
			? ` Missing track number(s): ${missingTrackNumbers.join(', ')}.`
			: '';
	console.warn(
		`[Album Download] Metadata incomplete for album ${album.id}: received ${tracks.length}/${expectedCount} track item(s).${missingPart}`
	);
}

type MusicBrainzReleaseSearchOption = {
	id: string;
	title?: string;
	trackCount?: number;
	date?: string;
};

function normalizeMusicBrainzReleaseId(value: string | undefined | null): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeMusicBrainzText(value: string | undefined): string {
	if (!value) return '';
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function musicBrainzTitlesLikelyMatch(albumTitle: string, releaseTitle: string): boolean {
	const normalizedAlbumTitle = normalizeMusicBrainzText(albumTitle);
	const normalizedReleaseTitle = normalizeMusicBrainzText(releaseTitle);
	if (!normalizedAlbumTitle || !normalizedReleaseTitle) {
		return false;
	}
	if (
		normalizedAlbumTitle === normalizedReleaseTitle ||
		normalizedAlbumTitle.includes(normalizedReleaseTitle) ||
		normalizedReleaseTitle.includes(normalizedAlbumTitle)
	) {
		return true;
	}

	const albumTokens = normalizedAlbumTitle.split(' ').filter((token) => token.length > 1);
	const releaseTokens = new Set(
		normalizedReleaseTitle.split(' ').filter((token) => token.length > 1)
	);
	if (albumTokens.length === 0 || releaseTokens.size === 0) {
		return false;
	}
	const matchedTokens = albumTokens.filter((token) => releaseTokens.has(token)).length;
	const minimumMatchCount = Math.max(1, Math.ceil(albumTokens.length * 0.75));
	return matchedTokens >= minimumMatchCount;
}

function resolveMusicBrainzReleaseTrackCount(release: MusicBrainzReleaseSearchOption): number | null {
	const trackCount = Number(release.trackCount);
	if (!Number.isFinite(trackCount) || trackCount <= 0) {
		return null;
	}
	return Math.trunc(trackCount);
}

function compareMusicBrainzReleaseDateDesc(
	left: MusicBrainzReleaseSearchOption,
	right: MusicBrainzReleaseSearchOption
): number {
	const leftDate = left.date?.trim() ?? '';
	const rightDate = right.date?.trim() ?? '';
	if (!leftDate && !rightDate) return 0;
	if (!leftDate) return 1;
	if (!rightDate) return -1;
	return rightDate.localeCompare(leftDate);
}

async function resolveAutomaticMusicBrainzReleaseId(
	album: Album,
	trackCount: number,
	options: {
		experimentalMusicBrainzTagging: boolean;
		explicitMusicBrainzReleaseId?: string;
	}
): Promise<string | undefined> {
	if (!options.experimentalMusicBrainzTagging || options.explicitMusicBrainzReleaseId) {
		return options.explicitMusicBrainzReleaseId;
	}
	if (typeof fetch !== 'function') {
		return undefined;
	}

	const albumTitle = album.title?.trim() ?? '';
	const artistName = album.artist?.name?.trim() ?? '';
	if (!albumTitle || !artistName || !Number.isFinite(trackCount) || trackCount <= 0) {
		return undefined;
	}

	try {
		const response = await fetch('/api/metadata/musicbrainz-release-search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				albumTitle,
				artistName,
				releaseDate: album.releaseDate,
				upc: album.upc,
				limit: 18
			})
		});
		const payload = (await response.json().catch(() => null)) as
			| { success?: boolean; releases?: MusicBrainzReleaseSearchOption[] }
			| null;
		if (!response.ok || !payload?.success || !Array.isArray(payload.releases)) {
			return undefined;
		}

		const normalizedTrackCount = Math.trunc(trackCount);
		const compatibleReleases = payload.releases
			.filter(
				(release) =>
					typeof release?.id === 'string' &&
					release.id.length > 0 &&
					typeof release.title === 'string' &&
					musicBrainzTitlesLikelyMatch(albumTitle, release.title)
			)
			.filter((release) => {
				const releaseTrackCount = resolveMusicBrainzReleaseTrackCount(release);
				return releaseTrackCount !== null && releaseTrackCount >= normalizedTrackCount;
			})
			.sort((left, right) => {
				const leftTrackCount = resolveMusicBrainzReleaseTrackCount(left) ?? Number.MAX_SAFE_INTEGER;
				const rightTrackCount = resolveMusicBrainzReleaseTrackCount(right) ?? Number.MAX_SAFE_INTEGER;
				const leftDistance = Math.abs(leftTrackCount - normalizedTrackCount);
				const rightDistance = Math.abs(rightTrackCount - normalizedTrackCount);
				if (leftDistance !== rightDistance) {
					return leftDistance - rightDistance;
				}
				return compareMusicBrainzReleaseDateDesc(left, right);
			});

		return compatibleReleases[0]?.id;
	} catch {
		return undefined;
	}
}

async function resolveDeferredMusicBrainzReleaseId(
	releaseIdPromise: Promise<string | undefined> | undefined
): Promise<string | undefined> {
	if (!releaseIdPromise) {
		return undefined;
	}
	try {
		return normalizeMusicBrainzReleaseId(await releaseIdPromise);
	} catch {
		return undefined;
	}
}

function patchQueuedAlbumMusicBrainzReleaseId(
	jobId: string,
	releaseIdPromise: Promise<string | undefined> | undefined
): void {
	if (!jobId || !releaseIdPromise || typeof fetch !== 'function') {
		return;
	}

	void (async () => {
		const releaseId = await resolveDeferredMusicBrainzReleaseId(releaseIdPromise);
		if (!releaseId) {
			return;
		}

		try {
			const response = await fetch(`/api/download-queue/${jobId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'set_musicbrainz_release',
					musicBrainzReleaseId: releaseId
				})
			});
			if (!response.ok) {
				throw new Error(`Queue patch failed (${response.status})`);
			}
		} catch (error) {
			console.warn(
				`[MusicBrainz] Unable to attach deferred release ${releaseId} to queued album job ${jobId}.`,
				error
			);
		}
	})();
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
		experimentalMusicBrainzTagging?: boolean;
		strictMusicBrainzMatching?: boolean;
		musicBrainzReleaseId?: string;
		musicBrainzReleaseIdPromise?: Promise<string | undefined>;
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
				enableExperimentalMusicBrainz: options?.experimentalMusicBrainzTagging ?? true,
				strictMusicBrainzMatching: options?.strictMusicBrainzMatching ?? false,
				musicBrainzReleaseId: options?.musicBrainzReleaseId,
				musicBrainzReleaseIdPromise: options?.musicBrainzReleaseIdPromise,
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
		experimentalMusicBrainzTagging?: boolean;
		strictMusicBrainzMatching?: boolean;
		musicBrainzReleaseId?: string;
		musicBrainzReleaseIdPromise?: Promise<string | undefined>;
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

	const fetchResult = await downloadTrackWithRetry(track.id, quality, filename, track, undefined, {
		convertAacToMp3,
		downloadCoverSeperately: false,
		experimentalMusicBrainzTagging: options?.experimentalMusicBrainzTagging ?? true,
		strictMusicBrainzMatching: options?.strictMusicBrainzMatching ?? false,
		musicBrainzReleaseId: options?.musicBrainzReleaseId,
		musicBrainzReleaseIdPromise: options?.musicBrainzReleaseIdPromise,
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
	});

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
				experimentalMusicBrainzTagging: options?.experimentalMusicBrainzTagging ?? true,
				strictMusicBrainzMatching: options?.strictMusicBrainzMatching ?? false,
				musicBrainzReleaseId: options?.musicBrainzReleaseId,
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
		experimentalMusicBrainzTagging?: boolean;
		strictMusicBrainzMatching?: boolean;
		musicBrainzReleaseId?: string;
		musicBrainzReleaseIdPromise?: Promise<string | undefined>;
		storage?: DownloadStorage;
		forceOverwrite?: boolean;
	}
): Promise<AlbumDownloadResult> {
	const storage = options?.storage ?? 'server';
	const experimentalMusicBrainzTagging = options?.experimentalMusicBrainzTagging ?? true;
	const strictMusicBrainzMatching = options?.strictMusicBrainzMatching ?? false;
	const explicitMusicBrainzReleaseId = normalizeMusicBrainzReleaseId(options?.musicBrainzReleaseId);

	// For server downloads, submit to the Redis-backed queue API
	if (storage === 'server') {
		// Fetch album info
		const { album: fetchedAlbum, tracks } = await losslessAPI.getAlbum(album.id);
		const canonicalAlbum = fetchedAlbum ?? album;
		warnIfAlbumTrackListIncomplete(canonicalAlbum, tracks);

		if (!tracks || tracks.length === 0) {
			throw new Error('No tracks found for album');
		}

		const artistName = preferredArtistName ?? canonicalAlbum.artist?.name ?? 'Unknown Artist';
		const albumTitle = canonicalAlbum.title ?? 'Unknown Album';
		const trackCount = tracks.length;
		const deferredMusicBrainzReleaseIdPromise =
			explicitMusicBrainzReleaseId ||
			!experimentalMusicBrainzTagging
				? undefined
				: options?.musicBrainzReleaseIdPromise ??
					resolveAutomaticMusicBrainzReleaseId(canonicalAlbum, trackCount, {
						experimentalMusicBrainzTagging,
						explicitMusicBrainzReleaseId
					});

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
					trackCount,
					experimentalMusicBrainzTagging,
					strictMusicBrainzMatching,
					musicBrainzReleaseId: explicitMusicBrainzReleaseId,
					forceOverwrite: options?.forceOverwrite === true
				},
				forceOverwrite: options?.forceOverwrite === true
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
		if (!explicitMusicBrainzReleaseId) {
			patchQueuedAlbumMusicBrainzReleaseId(payload.jobId, deferredMusicBrainzReleaseIdPromise);
		}

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
	warnIfAlbumTrackListIncomplete(canonicalAlbum, tracks);
	if (!tracks || tracks.length === 0) {
		throw new Error('No tracks found for album');
	}

	const totalTracks = tracks.length;
	callbacks?.onTotalResolved?.(totalTracks);

	const artistName = preferredArtistName ?? canonicalAlbum.artist?.name ?? 'Unknown Artist';
	const convertAacToMp3 = options?.convertAacToMp3 ?? false;
	const downloadCoverSeperately = options?.downloadCoverSeperately ?? false;
	const deferredMusicBrainzReleaseIdPromise =
		explicitMusicBrainzReleaseId || !experimentalMusicBrainzTagging
			? undefined
			: options?.musicBrainzReleaseIdPromise ??
				resolveAutomaticMusicBrainzReleaseId(canonicalAlbum, totalTracks, {
					experimentalMusicBrainzTagging,
					explicitMusicBrainzReleaseId
				});

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
			experimentalMusicBrainzTagging,
			strictMusicBrainzMatching,
			musicBrainzReleaseId: explicitMusicBrainzReleaseId,
			musicBrainzReleaseIdPromise: deferredMusicBrainzReleaseIdPromise,
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
