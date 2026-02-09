/**
 * Core download types - shared between browser and server
 */

import type { AudioQuality, TrackLookup } from '$lib/types';

export interface DownloadProgress {
	stage: 'downloading' | 'embedding';
	receivedBytes: number;
	totalBytes?: number;
}

export interface DownloadOptions {
	signal?: AbortSignal;
	onProgress?: (progress: DownloadProgress) => void;
	skipMetadataEmbedding?: boolean;
	convertAacToMp3?: boolean;
}

export interface ManifestParseResult {
	type: 'single-url' | 'segmented-dash' | 'multi-segment' | 'unknown';
	streamUrl?: string;
	initializationUrl?: string;
	segmentUrls?: string[];
	baseUrl?: string;
	codec?: string;
}

export interface SegmentTemplate {
	initializationUrl: string;
	mediaUrlTemplate: string;
	startNumber: number;
	segmentTimeline: Array<{ duration: number; repeat: number }>;
}

export interface DownloadResult {
	buffer: ArrayBuffer;
	mimeType?: string;
	receivedBytes: number;
	totalBytes?: number;
}

export interface ApiClient {
	getTrack(trackId: number, quality: AudioQuality, options?: { skipTarget?: string }): Promise<TrackLookup>;
}

export interface FetchFunction {
	(url: string, options?: RequestInit): Promise<Response>;
}
