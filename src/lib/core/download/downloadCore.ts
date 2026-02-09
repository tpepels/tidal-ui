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
const MAX_MANIFEST_RETRIES = 3; // Try manifest from different targets

export async function downloadTrackCore(params: {
	trackId: number;
	quality: AudioQuality;
	apiClient: ApiClient;
	fetchFn: FetchFunction;
	options?: DownloadOptions;
	skipTarget?: string;
}): Promise<DownloadResult> {
	const { trackId, quality, apiClient, fetchFn, options, skipTarget } = params;

	// Get track metadata from API
	const trackLookup = await apiClient.getTrack(trackId, quality, { skipTarget });

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

	// Fallback to manifest parsing (with retries for segment failures)
	if (!result) {
		let manifestRetries = 0;
		let lastSegmentError: Error | null = null;

		while (manifestRetries < MAX_MANIFEST_RETRIES && !result) {
			try {
				const manifest = trackLookup.info.manifest;
				const parsed = parseManifest(manifest);

				if (parsed.type === 'segmented-dash' && parsed.initializationUrl && parsed.segmentUrls) {
					// Multi-segment DASH download
					console.log('[DownloadCore] Downloading segmented DASH:', {
						segments: parsed.segmentUrls.length + 1,
						codec: parsed.codec,
						attempt: manifestRetries + 1
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
			} catch (error) {
				lastSegmentError = error instanceof Error ? error : new Error(String(error));
				manifestRetries++;
				
				if (manifestRetries < MAX_MANIFEST_RETRIES) {
					console.log('[DownloadCore] Segment download failed, retrying with fresh manifest...', {
						error: lastSegmentError.message,
						attempt: manifestRetries + 1
					});
					// Refetch manifest to potentially get URLs from different target
					try {
						const freshLookup = await apiClient.getTrack(trackId, quality, { skipTarget: 'previous' });
						trackLookup.info.manifest = freshLookup.info.manifest;
					} catch (refetchErr) {
						console.warn('[DownloadCore] Failed to refetch manifest:', refetchErr);
						// Continue anyway with same manifest
					}
				}
			}
		}

		if (!result && lastSegmentError) {
			throw lastSegmentError;
		}
	}

	// Validate size
	if (result && result.receivedBytes < MIN_VALID_AUDIO_SIZE) {
		throw new Error(
			`Downloaded file suspiciously small (${result.receivedBytes} bytes). ` +
			`This likely indicates a DASH initialization segment instead of the full audio file.`
		);
	}

	return result || { buffer: new ArrayBuffer(0), receivedBytes: 0 };
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
