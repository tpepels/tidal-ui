/**
 * Segment downloader - handles multi-segment DASH downloads
 */

import { detectAudioFormat } from '$lib/utils/audioFormat';
import type { DownloadOptions, DownloadResult, FetchFunction } from './types';

export async function downloadSegmentedDash(
	initializationUrl: string,
	segmentUrls: string[],
	fetchFn: FetchFunction,
	options?: DownloadOptions
): Promise<DownloadResult> {
	const DEFAULT_SEGMENT_TIMEOUT_MS = 20000;
	const segmentTimeoutMs = options?.segmentTimeoutMs ?? DEFAULT_SEGMENT_TIMEOUT_MS;
	const urls = [initializationUrl, ...segmentUrls];
	const chunks: Uint8Array[] = [];
	let receivedBytes = 0;

	for (const url of urls) {
		let didTimeout = false;
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			didTimeout = true;
			controller.abort();
		}, segmentTimeoutMs);
		const onAbort = () => {
			didTimeout = false;
			controller.abort();
		};
		if (options?.signal) {
			if (options.signal.aborted) {
				clearTimeout(timeout);
				throw new Error('Download aborted');
			}
			options.signal.addEventListener('abort', onAbort, { once: true });
		}

		let response: Response;
		try {
			response = await fetchFn(url, {
				signal: controller.signal,
				headers: options?.headers
			});
		} catch (error) {
			if (didTimeout) {
				throw new Error(`Segment fetch timeout after ${segmentTimeoutMs}ms`);
			}
			if (options?.signal?.aborted) {
				throw new Error('Download aborted');
			}
			throw error instanceof Error ? error : new Error(String(error));
		} finally {
			clearTimeout(timeout);
			if (options?.signal) {
				options.signal.removeEventListener('abort', onAbort);
			}
		}
		if (!response.ok) {
			throw new Error(`Failed to fetch CDN segment (status ${response.status}): ${url}`);
		}
		const buffer = await response.arrayBuffer();
		const chunk = new Uint8Array(buffer);
		receivedBytes += chunk.byteLength;
		chunks.push(chunk);
		
		options?.onProgress?.({ 
			stage: 'downloading', 
			receivedBytes, 
			totalBytes: undefined 
		});
	}

	// Merge all chunks
	const totalBytes = chunks.reduce((total, current) => total + current.byteLength, 0);
	const merged = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}

	// Detect actual format from magic bytes
	const detectedFormat = detectAudioFormat(merged);
	const mimeType = detectedFormat?.mimeType ?? 'audio/flac';

	return {
		buffer: merged.buffer,
		mimeType,
		receivedBytes,
		totalBytes
	};
}
