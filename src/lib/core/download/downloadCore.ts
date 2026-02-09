/**
 * Core download logic - shared between browser and server
 * This is the single source of truth for track downloading
 */

import type {
	ApiClient,
	DownloadOptions,
	DownloadResult,
	FetchFunction
} from './types';
import type { AudioQuality } from '$lib/types';
import { parseManifest } from './manifestParser';
import { downloadSegmentedDash } from './segmentDownloader';

const MIN_VALID_AUDIO_SIZE = 1000; // 1KB minimum

export async function downloadTrackCore(params: {
	trackId: number;
	quality: AudioQuality;
	apiClient: ApiClient;
	fetchFn: FetchFunction;
	options?: DownloadOptions;
}): Promise<DownloadResult> {
	const { trackId, quality, apiClient, fetchFn, options } = params;

	// Get track metadata from API
	const trackLookup = await apiClient.getTrack(trackId, quality);

	let result: DownloadResult | null = null;

	// Try originalTrackUrl first (pre-signed URL)
	if (trackLookup.originalTrackUrl) {
		try {
			const response = await fetchFn(trackLookup.originalTrackUrl, { signal: options?.signal });
			if (response.ok) {
				result = await downloadFromResponse(response, options);
			} else {
				console.warn('[DownloadCore] OriginalTrackUrl failed, falling back to manifest', {
					status: response.status
				});
			}
		} catch (error) {
			console.warn('[DownloadCore] OriginalTrackUrl fetch error, falling back:', error);
		}
	}

	// Fallback to manifest parsing
	if (!result) {
		const manifest = trackLookup.info.manifest;
		const parsed = parseManifest(manifest);

		if (parsed.type === 'segmented-dash' && parsed.initializationUrl && parsed.segmentUrls) {
			// Multi-segment DASH download
			console.log('[DownloadCore] Downloading segmented DASH:', {
				segments: parsed.segmentUrls.length + 1,
				codec: parsed.codec
			});
			result = await downloadSegmentedDash(
				parsed.initializationUrl,
				parsed.segmentUrls,
				fetchFn,
				options
			);
		} else if (parsed.type === 'single-url' && parsed.streamUrl) {
			// Single URL download
			console.log('[DownloadCore] Downloading from single URL');
			const response = await fetchFn(parsed.streamUrl, { signal: options?.signal });
			if (!response.ok) {
				throw new Error(`Failed to fetch audio stream (status ${response.status})`);
			}
			result = await downloadFromResponse(response, options);
		} else {
			throw new Error(
				`Could not extract download URL from manifest (type: ${parsed.type})`
			);
		}
	}

	// Validate size
	if (result.receivedBytes < MIN_VALID_AUDIO_SIZE) {
		throw new Error(
			`Downloaded file suspiciously small (${result.receivedBytes} bytes). ` +
			`This likely indicates a DASH initialization segment instead of the full audio file.`
		);
	}

	return result;
}

async function downloadFromResponse(
	response: Response,
	options?: DownloadOptions
): Promise<DownloadResult> {
	const totalHeader = Number(response.headers.get('Content-Length') ?? '0');
	const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined;
	const contentType = response.headers.get('Content-Type');

	// Stream download with progress
	if (response.body && typeof response.body.getReader === 'function') {
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let receivedBytes = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				receivedBytes += value.byteLength;
				chunks.push(value);
				options?.onProgress?.({
					stage: 'downloading',
					receivedBytes,
					totalBytes
				});
			}
		}

		// Merge chunks
		const totalSize = chunks.reduce((total, current) => total + current.byteLength, 0);
		const merged = new Uint8Array(totalSize);
		let offset = 0;
		for (const chunk of chunks) {
			merged.set(chunk, offset);
			offset += chunk.byteLength;
		}

		return {
			buffer: merged.buffer,
			mimeType: contentType ?? undefined,
			receivedBytes,
			totalBytes
		};
	}

	// Fallback: download as single chunk
	const buffer = await response.arrayBuffer();
	const receivedBytes = buffer.byteLength;

	options?.onProgress?.({
		stage: 'downloading',
		receivedBytes,
		totalBytes: receivedBytes
	});

	return {
		buffer,
		mimeType: contentType ?? undefined,
		receivedBytes,
		totalBytes: receivedBytes
	};
}
