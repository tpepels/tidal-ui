/**
 * Server download adapter - wraps core download logic with server-specific filesystem operations
 * This is called DIRECTLY by the worker - no HTTP involved
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { AudioQuality } from '$lib/types';
import type { ApiClient } from '../../core/download/types';
import { downloadTrackCore } from '../../core/download/downloadCore';
import { detectAudioFormat } from '../../utils/audioFormat';
import { 
	API_CONFIG,
	getPrimaryTarget,
	ensureWeightedTargets
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
 * Server-side fetch that constructs direct upstream URLs with target rotation
 * (losslessAPI.fetch uses fetchWithCORS which creates proxy URLs - unusable server-side)
 */
async function createServerFetch(): Promise<typeof globalThis.fetch> {
	const targetFailureTimestamps = new Map<string, number>();
	const TARGET_FAILURE_TTL_MS = 60_000;

	function isTargetHealthy(targetName: string): boolean {
		const failureAt = targetFailureTimestamps.get(targetName);
		if (!failureAt) return true;
		return Date.now() - failureAt > TARGET_FAILURE_TTL_MS;
	}

	function markTargetUnhealthy(targetName: string): void {
		targetFailureTimestamps.set(targetName, Date.now());
	}

	return async (url: string, options?: RequestInit) => {
		let finalUrl = url;

		// If it's a proxy-wrapped URL, extract the actual upstream URL
		if (finalUrl.includes('/api/proxy?url=')) {
			try {
				const urlObj = new URL(finalUrl, 'http://localhost');
				const encoded = urlObj.searchParams.get('url');
				if (encoded) {
					finalUrl = decodeURIComponent(encoded);
					console.log(`[ServerFetch] Decoded proxy URL: ${finalUrl.substring(0, 80)}...`);
					// Use the decoded URL directly
					return globalThis.fetch(finalUrl, options);
				}
			} catch (e) {
				console.warn(`[ServerFetch] Failed to decode proxy URL`);
			}
		}

		// If it's a relative path, construct absolute URL from targets
		if (finalUrl.startsWith('/') && !finalUrl.includes('/api/proxy')) {
			const primaryTarget = getPrimaryTarget('v2');
			finalUrl = `${primaryTarget.baseUrl}${finalUrl}`;
		}

		// Try each target in order
		const weightedTargets = ensureWeightedTargets('v2');
		const attemptOrder = [getPrimaryTarget('v2'), ...weightedTargets];
		const uniqueTargets = attemptOrder.filter(
			(target, index, array) => 
				array.findIndex(entry => entry.name === target.name) === index
		);

		const healthyTargets = uniqueTargets.filter(target => isTargetHealthy(target.name));
		const targetList = healthyTargets.length > 0 ? healthyTargets : uniqueTargets;

		let lastError: Error | null = null;

		for (const target of targetList) {
			try {
				// If URL is already absolute and for this target, use it
				if (finalUrl.startsWith('http')) {
					const response = await globalThis.fetch(finalUrl, options);
					if (response.ok) {
						return response;
					}
					markTargetUnhealthy(target.name);
					lastError = new Error(`HTTP ${response.status} from target`);
					continue;
				}

				// Otherwise, construct URL using targets
				const upstreamUrl = `${target.baseUrl}${finalUrl.startsWith('/') ? finalUrl : `/${finalUrl}`}`;
				console.log(`[ServerFetch] Trying ${target.name}: ${upstreamUrl.substring(0, 80)}...`);
				
				const response = await globalThis.fetch(upstreamUrl, options);
				if (response.ok) {
					return response;
				}
				markTargetUnhealthy(target.name);
				lastError = new Error(`HTTP ${response.status} from ${target.name}`);
			} catch (error) {
				markTargetUnhealthy(target.name);
				lastError = error instanceof Error ? error : new Error(String(error));
				console.warn(`[ServerFetch] Error with ${target.name}:`, lastError.message);
			}
		}

		throw lastError || new Error('All targets failed');
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
	apiClient: ApiClient; // Pass losslessAPI - it has fetchWithCORS with target rotation
	// Note: No fetch parameter - apiClient handles all fetching with proper rotation
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
		apiClient // losslessAPI - we'll use it for getTrack() parsing only
	} = params;

	try {
		// Create server-side fetch with target rotation
		// This replaces losslessAPI.fetch which constructs proxy URLs
		const fetchFn = await createServerFetch();
		
		// Download audio using core logic
		const result = await downloadTrackCore({
			trackId,
			quality,
			apiClient, // Uses apiClient.getTrack() for response parsing (properly tested)
			fetchFn,   // Uses our server fetch that constructs direct upstream URLs with target rotation
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
