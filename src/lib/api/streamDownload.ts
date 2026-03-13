import { z } from 'zod';
import { safeValidateApiResponse } from '../utils/schemas';
import { detectAudioFormat } from '../utils/audioFormat';
import { buildMpdSegmentUrls, parseMpdSegmentTemplate } from './streamManifest';
import { downloadCoverSeparately } from './coverDownload';
import type { AudioQuality, TrackLookup } from '../types';
import type { DashManifestResult, DownloadTrackOptions } from '../apiClient';

const StreamDataResultSchema = z.object({
	url: z.string(),
	replayGain: z.number().nullable(),
	sampleRate: z.number().nullable(),
	bitDepth: z.number().nullable()
});

export async function resolveHiResStreamFromDash(params: {
	trackId: number;
	getDashManifest: (trackId: number, quality: AudioQuality) => Promise<DashManifestResult>;
	parseFlacUrlFromMpd: (manifestText: string) => string | null;
}): Promise<string> {
	const { trackId, getDashManifest, parseFlacUrlFromMpd } = params;
	const manifest = await getDashManifest(trackId, 'HI_RES_LOSSLESS');
	if (manifest.kind === 'flac') {
		const url = manifest.urls.find((candidate) => typeof candidate === 'string' && candidate.length > 0);
		if (url) {
			return url;
		}
		throw new Error('DASH manifest did not include any FLAC URLs.');
	}
	const directUrl = parseFlacUrlFromMpd(manifest.manifest);
	if (directUrl) {
		return directUrl;
	}
	throw new Error('Hi-res DASH manifest does not expose a direct FLAC URL.');
}

export async function getStreamDataForTrack(params: {
	trackId: number;
	quality: AudioQuality;
	isHiResQuality: (quality: AudioQuality | string) => boolean;
	getTrack: (trackId: number, quality: AudioQuality) => Promise<TrackLookup>;
	resolveHiResStreamFromDash: (trackId: number) => Promise<string>;
	extractStreamUrlFromManifest: (manifest: string) => string | null;
	delay: (ms: number) => Promise<void>;
	isDev: boolean;
}): Promise<{
	url: string;
	replayGain: number | null;
	sampleRate: number | null;
	bitDepth: number | null;
}> {
	const {
		trackId,
		isHiResQuality,
		getTrack,
		resolveHiResStreamFromDash,
		extractStreamUrlFromManifest,
		delay,
		isDev
	} = params;
	let quality = params.quality;
	let replayGain: number | null = null;
	let sampleRate: number | null = null;
	let bitDepth: number | null = null;

	if (isHiResQuality(quality)) {
		try {
			try {
				const lookup = await getTrack(trackId, quality);
				replayGain = lookup.info.trackReplayGain ?? null;
				sampleRate = lookup.info.sampleRate ?? null;
				bitDepth = lookup.info.bitDepth ?? null;
			} catch {
				// Ignore metadata fetch failure for HiRes.
			}

			const url = await resolveHiResStreamFromDash(trackId);
			const result = { url, replayGain, sampleRate, bitDepth };
			const validationResult = safeValidateApiResponse(result, StreamDataResultSchema, {
				endpoint: 'stream.hires',
				allowUnvalidated: true
			});
			return validationResult.success ? validationResult.data : result;
		} catch (error) {
			console.warn('Failed to resolve hi-res stream via DASH manifest', error);
			quality = 'LOSSLESS';
		}
	}

	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const lookup = await getTrack(trackId, quality);
			replayGain = lookup.info.trackReplayGain ?? null;
			sampleRate = lookup.info.sampleRate ?? null;
			bitDepth = lookup.info.bitDepth ?? null;

			if (lookup.originalTrackUrl) {
				const result = { url: lookup.originalTrackUrl, replayGain, sampleRate, bitDepth };
				const validationResult = safeValidateApiResponse(result, StreamDataResultSchema, {
					endpoint: 'stream.standard.original',
					allowUnvalidated: true
				});
				return validationResult.success ? validationResult.data : result;
			}

			if (isDev) {
				const manifestPayload = lookup.info.manifest;
				console.debug('[getStreamData] manifest payload summary', {
					trackId,
					quality,
					manifestType: typeof manifestPayload,
					manifestLength: typeof manifestPayload === 'string' ? manifestPayload.length : null,
					manifestStartsWith:
						typeof manifestPayload === 'string' ? manifestPayload.trim().slice(0, 40) : null,
					manifestMimeType: lookup.info.manifestMimeType ?? null
				});
			}

			const manifestUrl = extractStreamUrlFromManifest(lookup.info.manifest);
			if (manifestUrl) {
				const result = { url: manifestUrl, replayGain, sampleRate, bitDepth };
				const validationResult = safeValidateApiResponse(result, StreamDataResultSchema, {
					endpoint: 'stream.standard.manifest',
					allowUnvalidated: true
				});
				return validationResult.success ? validationResult.data : result;
			}

			lastError = new Error('Unable to resolve stream URL for track');
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
		}

		if (attempt < 3) {
			await delay(200 * attempt);
		}
	}

	throw lastError ?? new Error('Unable to resolve stream URL for track');
}

export async function resolveTrackStreamUrl(params: {
	trackId: number;
	quality: AudioQuality;
	isHiResQuality: (quality: AudioQuality | string) => boolean;
	getTrack: (trackId: number, quality: AudioQuality) => Promise<TrackLookup>;
	extractStreamUrlFromManifest: (manifest: string) => string | null;
}): Promise<string> {
	const { trackId, isHiResQuality, getTrack, extractStreamUrlFromManifest } = params;
	let quality = params.quality;
	if (isHiResQuality(quality)) {
		quality = 'LOSSLESS';
	}

	const lookup = await getTrack(trackId, quality);
	if (lookup.originalTrackUrl) {
		return lookup.originalTrackUrl;
	}
	const fallback = extractStreamUrlFromManifest(lookup.info.manifest);
	if (!fallback) {
		throw new Error('Could not resolve stream URL for track');
	}
	return fallback;
}

export async function downloadFlacFromMpdManifest(params: {
	manifestText: string;
	options?: DownloadTrackOptions;
	fetch: (url: string, options?: RequestInit) => Promise<Response>;
}): Promise<{ blob: Blob; mimeType: string } | null> {
	const { manifestText, options, fetch } = params;
	const template = parseMpdSegmentTemplate(manifestText);
	const segments = buildMpdSegmentUrls(template);
	if (!segments) return null;

	const urls = [segments.initializationUrl, ...segments.segmentUrls];
	const chunks: Uint8Array[] = [];
	let receivedBytes = 0;

	for (const url of urls) {
		const response = await fetch(url, { signal: options?.signal });
		if (!response.ok) {
			throw new Error(`Failed to fetch DASH segment (status ${response.status})`);
		}
		const buffer = await response.arrayBuffer();
		const chunk = new Uint8Array(buffer);
		receivedBytes += chunk.byteLength;
		chunks.push(chunk);
		options?.onProgress?.({ stage: 'downloading', receivedBytes, totalBytes: undefined });
	}

	const totalBytes = chunks.reduce((total, current) => total + current.byteLength, 0);
	const merged = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}

	const detectedFormat = detectAudioFormat(merged);
	const mimeType = detectedFormat?.mimeType ?? 'audio/flac';
	return { blob: new Blob([merged], { type: mimeType }), mimeType };
}

export async function downloadTrackToClient(params: {
	trackId: number;
	quality: AudioQuality;
	filename: string;
	options?: DownloadTrackOptions;
	fetchTrackBlob: (
		trackId: number,
		quality: AudioQuality,
		filename: string,
		options?: DownloadTrackOptions
	) => Promise<{ blob: Blob; mimeType?: string }>;
	getPreferredTrackMetadata: (trackId: number, quality: AudioQuality) => Promise<TrackLookup>;
	getCoverUrl: (
		coverId: string,
		size: '1280' | '640' | '320' | '160' | '80',
		options?: { proxy?: boolean }
	) => string;
	rateLimitErrorMessage: string;
}): Promise<void> {
	const {
		trackId,
		quality,
		filename,
		options,
		fetchTrackBlob,
		getPreferredTrackMetadata,
		getCoverUrl,
		rateLimitErrorMessage
	} = params;

	try {
		const { blob } = await fetchTrackBlob(trackId, quality, filename, options);
		const url = URL.createObjectURL(blob);

		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);

		if (options?.downloadCoverSeperately) {
			try {
				const metadata = await getPreferredTrackMetadata(trackId, quality);
				const coverId = metadata.track.album?.cover;
				if (coverId) {
					console.log('[Cover Download] Fetching cover for separate download...');
					await downloadCoverSeparately({
						coverId,
						getCoverUrl: (id, size) => getCoverUrl(id, size)
					});
				}
			} catch (coverError) {
				console.warn('Failed to download cover separately:', coverError);
			}
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw error;
		}
		console.error('Download failed:', error);
		if (error instanceof Error && error.message === rateLimitErrorMessage) {
			throw error;
		}
		throw new Error(
			'Download failed. The stream URL may require a proxy. Please try streaming instead.'
		);
	}
}
