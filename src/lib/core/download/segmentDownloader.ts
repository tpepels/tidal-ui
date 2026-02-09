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
	const urls = [initializationUrl, ...segmentUrls];
	const chunks: Uint8Array[] = [];
	let receivedBytes = 0;

	for (const url of urls) {
		const response = await fetchFn(url, { signal: options?.signal });
		if (!response.ok) {
			throw new Error(`Failed to fetch DASH segment (status ${response.status}): ${url}`);
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
