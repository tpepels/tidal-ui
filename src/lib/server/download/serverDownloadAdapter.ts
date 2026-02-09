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
	getDownloadDir, 
	sanitizePath, 
	ensureDir,
	resolveFileConflict,
	buildServerFilename,
	getServerExtension,
	downloadCoverToDir
} from '../../../routes/api/download-track/_shared';

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
		apiClient // losslessAPI with fetchWithCORS - handles everything
	} = params;

	try {
		// Use losslessAPI's built-in fetch which calls fetchWithCORS
		// This gives us target rotation, failover, and proper response parsing
		// We create a fetchFn that uses the API client's internal fetch
		const fetchFn: typeof globalThis.fetch = async (url, options) => {
			// Check if apiClient has a fetch method we can use
			if ('fetch' in apiClient && typeof apiClient.fetch === 'function') {
				return (apiClient as any).fetch(url, options);
			}
			// Fallback to global fetch
			return globalThis.fetch(url, options);
		};
		
		// Download audio using core logic
		const result = await downloadTrackCore({
			trackId,
			quality,
			apiClient, // Has proper getTrack() with response parsing
			fetchFn, // Uses apiClient's fetch -> fetchWithCORS -> target rotation
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
