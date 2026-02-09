/**
 * Server download adapter - wraps core download logic with server-specific filesystem operations
 * This is called DIRECTLY by the worker - no HTTP involved
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { AudioQuality, TrackLookup, Track, TrackInfo } from '$lib/types';
import type { ApiClient } from '../../core/download/types';
import { downloadTrackCore } from '../../core/download/downloadCore';
import { detectAudioFormat } from '../../utils/audioFormat';
import { 
	API_CONFIG,
	getPrimaryTarget,
	ensureWeightedTargets,
	selectFromWeightedTargets
} from '$lib/config';
import { 
	getDownloadDir, 
	sanitizePath, 
	ensureDir,
	resolveFileConflict,
	buildServerFilename,
	getServerExtension,
	downloadCoverToDir
} from '../../../routes/api/download-track/_shared';

/**
 * Parse API response into TrackLookup format
 * The API returns an array with separate entries for track metadata and stream info
 */
function parseTrackLookup(data: unknown): TrackLookup {
	const entries = Array.isArray(data) ? data : [data];
	let track: Track | undefined;
	let info: TrackInfo | undefined;
	let originalTrackUrl: string | undefined;

	for (const entry of entries) {
		if (!entry || typeof entry !== 'object') continue;
		
		// Check for track metadata (has album, artist, duration)
		if (!track && 'album' in entry && 'artist' in entry && 'duration' in entry) {
			track = entry as Track;
			continue;
		}
		
		// Check for stream info (has manifest)
		if (!info && 'manifest' in entry) {
			info = entry as TrackInfo;
			continue;
		}
		
		// Check for pre-signed URL
		if (!originalTrackUrl && 'OriginalTrackUrl' in entry) {
			const candidate = (entry as { OriginalTrackUrl?: unknown }).OriginalTrackUrl;
			if (typeof candidate === 'string') {
				originalTrackUrl = candidate;
			}
		}
	}

	if (!track || !info) {
		throw new Error('Malformed track response: missing track or info');
	}

	return { track, info, originalTrackUrl };
}


/**
 * Server-side API client that uses target rotation with fallback
 * Constructs direct upstream URLs instead of using proxy wrapper
 */
function createServerApiClient(fetchFn: typeof globalThis.fetch): ApiClient {
	return {
		async getTrack(trackId: number, quality: AudioQuality): Promise<TrackLookup> {
			// Get targets in priority order (using same logic as fetchWithCORS)
			const weightedTargets = ensureWeightedTargets('v2');
			
			// Start with primary target, then fall back to others
			const attemptOrder = [getPrimaryTarget('v2'), ...weightedTargets];
			
			// Remove duplicates while preserving order
			const uniqueTargets = attemptOrder.filter(
				(target, index, array) => 
					array.findIndex(entry => entry.name === target.name) === index
			);
			
			let lastError: unknown = null;
			
			// Try each target in order
			for (const target of uniqueTargets) {
				try {
					// Build direct upstream URL - no proxy wrapper
					const url = `${target.baseUrl}/track/?id=${trackId}&quality=${quality}`;
					
					console.log(`[ServerApiClient] Fetching from ${target.name}: ${url}`);
					
					const response = await fetchFn(url, {
						headers: {
							'Accept': 'application/json'
						}
					});
					
					if (!response.ok) {
						console.warn(`[ServerApiClient] ${target.name} returned ${response.status}`);
						lastError = new Error(`HTTP ${response.status} from ${target.name}`);
						continue; // Try next target
					}
					
					// Parse JSON response
					const rawData = await response.json();
					
					// Parse using the same logic as browser client
					// API returns array with separate track and info objects
					const data = parseTrackLookup(rawData);
					
					console.log(`[ServerApiClient] Successfully fetched track from ${target.name}`);
					return data;
					
				} catch (error) {
					console.warn(`[ServerApiClient] Error with ${target.name}:`, error);
					lastError = error;
					// Continue to next target
				}
			}
			
			// All targets failed
			throw lastError || new Error('All API targets failed for track lookup');
		}
	};
}

export interface ServerDownloadParams {
	trackId: number;
	quality: AudioQuality;
	albumTitle?: string;
	artistName?: string;
	trackTitle?: string;
	trackNumber?: number;
	coverUrl?: string;
	conflictResolution?: 'overwrite' | 'skip' | 'overwrite_if_different';
	apiClient?: ApiClient;
	fetch: typeof globalThis.fetch;
}

export interface ServerDownloadResult {
	success: boolean;
	filepath?: string;
	filename?: string;
	action?: 'overwrite' | 'skip' | 'rename';
	error?: string;
	coverDownloaded?: boolean;
}

export async function downloadTrackServerSide(
	params: ServerDownloadParams
): Promise<ServerDownloadResult> {
	const {
		trackId,
		quality,
		albumTitle,
		artistName,
		trackTitle,
		coverUrl,
		conflictResolution = 'overwrite',
		apiClient: providedApiClient,
		fetch: fetchFn
	} = params;

	try {
		// Use provided API client or create server-side one with target rotation
		const serverApiClient = providedApiClient || createServerApiClient(fetchFn);
		
		// Create wrapped fetch for core downloader
		// Handles both relative paths and proxy-wrapped URLs
		const wrappedFetch: typeof globalThis.fetch = async (url, options) => {
			let finalUrl = typeof url === 'string' ? url : url.toString();
			
			// If it's a proxy wrapper URL (e.g., /api/proxy?url=ENCODED_URL)
			// extract and use the actual upstream URL directly
			if (finalUrl.includes('/api/proxy?url=')) {
				const urlObj = new URL(finalUrl, 'http://localhost'); // Need base for URL parsing
				const encoded = urlObj.searchParams.get('url');
				if (encoded) {
					finalUrl = decodeURIComponent(encoded);
					console.log(`[ServerDownload] Decoded proxy URL to: ${finalUrl}`);
				}
			}
			// If it's a relative path, construct absolute URL from primary target
			else if (finalUrl.startsWith('/')) {
				const primaryTarget = getPrimaryTarget('v2');
				finalUrl = `${primaryTarget.baseUrl}${finalUrl}`;
			}
			
			return fetchFn(finalUrl, options);
		};

		// Download audio using core logic with server API client
		const result = await downloadTrackCore({
			trackId,
			quality,
			apiClient: serverApiClient,
			fetchFn: wrappedFetch,
			options: {
				skipMetadataEmbedding: true // Server-side doesn't embed metadata yet
			}
		});

		console.log(`[ServerDownload] Downloaded ${result.receivedBytes} bytes for track ${trackId}`);

		// Convert to Buffer
		const buffer = Buffer.from(result.buffer);

		// Detect format and determine extension
		const detectedFormat = detectAudioFormat(new Uint8Array(buffer));
		const ext = getServerExtension(quality, detectedFormat);

		// Build filename
		const filename = buildServerFilename(artistName, trackTitle, trackId, ext, undefined);

		// Determine directory structure
		const baseDir = getDownloadDir();		const artistDir = sanitizePath(artistName || 'Unknown Artist');
		const albumDir = sanitizePath(albumTitle || 'Unknown Album');
		const targetDir = path.join(baseDir, artistDir, albumDir);
		await ensureDir(targetDir);

		const initialFilepath = path.join(targetDir, filename);

		// Handle file conflicts
		const { finalPath, action } = await resolveFileConflict(
			initialFilepath,
			conflictResolution,
			buffer.length,
			undefined // No checksum validation for now
		);

		if (action === 'skip') {
			const finalFilename = path.basename(finalPath);
			return {
				success: true,
				filepath: finalPath,
				filename: finalFilename,
				action,
				coverDownloaded: false
			};
		}

		// Write file to disk
		await fs.writeFile(finalPath, buffer);
		console.log(`[ServerDownload] Saved to: ${finalPath}`);

		// Download cover art if requested
		let coverDownloaded = false;
		if (coverUrl) {
			try {
				coverDownloaded = await downloadCoverToDir(coverUrl, targetDir);
				if (coverDownloaded) {
					console.log(`[ServerDownload] Cover art downloaded`);
				}
			} catch (coverErr) {
				console.warn(`[ServerDownload] Cover download failed:`, coverErr);
			}
		}

		const finalFilename = path.basename(finalPath);
		return {
			success: true,
			filepath: finalPath,
			filename: finalFilename,
			action,
			coverDownloaded
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[ServerDownload] Failed to download track ${trackId}:`, errorMsg);
		return {
			success: false,
			error: errorMsg
		};
	}
}
