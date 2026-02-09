/**
 * Internal API endpoint for server-side track downloads
 * This endpoint fetches tracks from TIDAL and saves them directly on the server
 * Only accessible from background worker (localhost)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AudioQuality } from '$lib/types';
import { API_CONFIG } from '$lib/config';
import {
	getDownloadDir,
	sanitizePath,
	ensureDir,
	resolveFileConflict,
	buildServerFilename,
	detectAudioFormatFromBuffer,
	getServerExtension,
	downloadCoverToDir
} from '../../download-track/_shared';
import { embedMetadataToFile } from '$lib/server/metadataEmbedder';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * POST /api/internal/download-track
 * Fetches a track from TIDAL and saves it to the server's download directory
 * Handles metadata embedding and cover art downloads
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { trackId, quality, albumTitle, artistName, trackTitle, conflictResolution } = body as {
			trackId: number;
			quality: AudioQuality;
			albumTitle?: string;
			artistName?: string;
			trackTitle?: string;
			conflictResolution?: 'overwrite' | 'skip' | 'overwrite_if_different';
		};

		// Validate required fields
		if (!trackId || !quality) {
			return json(
				{ success: false, error: 'trackId and quality are required' },
				{ status: 400 }
			);
		}

		// Fetch track metadata from upstream Tidal proxy API
		const apiBaseUrl = API_CONFIG.baseUrl || API_CONFIG.targets[0]?.baseUrl;
		if (!apiBaseUrl) {
			return json(
				{ success: false, error: 'No upstream API configured' },
				{ status: 500 }
			);
		}
		
		// Get track metadata
		let trackResponse: Response;
		try {
			trackResponse = await fetch(`${apiBaseUrl}/track/?id=${trackId}&quality=${quality}`);
		} catch (fetchError) {
			return json(
				{ success: false, error: `Failed to connect to API: ${fetchError instanceof Error ? fetchError.message : 'Connection error'}` },
				{ status: 500 }
			);
		}
		
		if (!trackResponse || !trackResponse.ok) {
			return json(
				{ success: false, error: `Failed to fetch track metadata: HTTP ${trackResponse?.status || 'unknown'}` },
				{ status: 500 }
			);
		}
		
		let trackResponseData: unknown;
		try {
			trackResponseData = await trackResponse.json();
		} catch (parseError) {
			return json(
				{ success: false, error: 'Failed to parse track response as JSON' },
				{ status: 500 }
			);
		}
		
		if (!trackResponseData) {
			return json(
				{ success: false, error: 'Empty response from API' },
				{ status: 500 }
			);
		}
		
		// Parse track data from response (handle various response formats)
		let trackData: Record<string, unknown> | undefined;
		let streamUrl: string | undefined;
		
		// The response might be an array or object
		const dataArray = Array.isArray(trackResponseData) ? trackResponseData : [trackResponseData];
		for (const entry of dataArray) {
			if (entry && typeof entry === 'object') {
				// Check if this looks like track metadata
				if ('title' in entry && ('id' in entry || 'url' in entry)) {
					if (!trackData && ('title' in entry && 'artist' in entry)) {
						trackData = entry as Record<string, unknown>;
					}
					// Check if this looks like a manifest or URL entry
					if (!streamUrl && ('url' in entry || 'manifest' in entry)) {
						streamUrl = (entry.url || entry.manifest) as string;
					}
				}
			}
		}
		
		if (!trackData) {
			return json(
				{ success: false, error: 'Could not parse track metadata from response' },
				{ status: 500 }
			);
		}
		
		if (!streamUrl) {
			// Try to extract from track data if available
			streamUrl = (trackData.url || trackData.manifest) as string;
		}
		
		if (!streamUrl || typeof streamUrl !== 'string') {
			return json(
				{ success: false, error: 'No stream URL available in track data' },
				{ status: 404 }
			);
		}
		
		// Validate stream URL format
		try {
			new URL(streamUrl);
		} catch (urlError) {
			return json(
				{ success: false, error: `Invalid stream URL format: ${streamUrl}` },
				{ status: 500 }
			);
		}

		// Download the audio stream
		let audioResponse: Response;
		try {
			audioResponse = await fetch(streamUrl);
		} catch (streamError) {
			return json(
				{ success: false, error: `Failed to fetch audio stream: ${streamError instanceof Error ? streamError.message : 'Network error'}` },
				{ status: 500 }
			);
		}
		if (!audioResponse.ok) {
			return json(
				{ success: false, error: `Failed to download audio: HTTP ${audioResponse.status}` },
				{ status: 500 }
			);
		}

		let arrayBuffer: ArrayBuffer;
		try {
			arrayBuffer = await audioResponse.arrayBuffer();
		} catch (bufferError) {
			return json(
				{ success: false, error: `Failed to read audio data: ${bufferError instanceof Error ? bufferError.message : 'Read error'}` },
				{ status: 500 }
			);
		}
		
		const buffer = Buffer.from(arrayBuffer);

		if (buffer.length === 0) {
			return json(
				{ success: false, error: 'Downloaded audio file is empty' },
				{ status: 500 }
			);
		}
		
		if (buffer.length < 1024) {
			return json(
				{ success: false, error: `Downloaded file suspiciously small (${buffer.length} bytes)` },
				{ status: 500 }
			);
		}

		// Build file path - safely extract nested properties
		const extractString = (obj: unknown, key: string, fallback: string): string => {
			if (obj && typeof obj === 'object' && key in obj) {
				const value = (obj as Record<string, unknown>)[key];
				return typeof value === 'string' ? value : fallback;
			}
			return fallback;
		};
		
		const finalArtistName = artistName || extractString(trackData.artist, 'name', 'Unknown Artist');
		const finalAlbumTitle = albumTitle || extractString(trackData.album, 'title', 'Unknown Album');
		const finalTrackTitle = trackTitle || extractString(trackData, 'title', 'Unknown Track');

		const detectedFormat = detectAudioFormatFromBuffer(buffer);
		const ext = getServerExtension(quality, detectedFormat);
		
		const filename = buildServerFilename(
			finalArtistName,
			finalTrackTitle,
			trackId,
			ext,
			trackData
		);

		const baseDir = getDownloadDir();
		const artistDir = sanitizePath(finalArtistName);
		const albumDir = sanitizePath(finalAlbumTitle);
		const targetDir = path.join(baseDir, artistDir, albumDir);
		await ensureDir(targetDir);

		const initialPath = path.join(targetDir, filename);

		// Handle file conflicts
		const { action, finalPath } = await resolveFileConflict(
			initialPath,
			conflictResolution || 'overwrite_if_different',
			buffer.length
		);

		if (action === 'skip') {
			return json({
				success: true,
				filename,
				filepath: finalPath,
				skipped: true,
				message: 'File already exists'
			});
		}

		// Write file to disk
		await fs.writeFile(finalPath, buffer);

		// Embed metadata (non-blocking, don't fail if this errors)
		try {
			await embedMetadataToFile(finalPath, trackData);
		} catch (embedErr) {
			console.warn('[Internal Download] Metadata embedding failed:', embedErr);
		}

		// Download cover art (non-blocking)
		if (trackData.album?.cover) {
			try {
				// Build cover URL from cover ID (https://resources.tidal.com/...)
				const coverId = trackData.album.cover as string;
				const coverUrl = `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/${'1280'}x${'1280'}.jpg`;
				await downloadCoverToDir(targetDir, coverUrl, path.basename(finalPath));
			} catch (coverErr) {
				console.warn('[Internal Download] Cover download failed:', coverErr);
			}
		}

		return json({
			success: true,
			filename,
			filepath: finalPath,
			size: buffer.length
		});
	} catch (error) {
		console.error('[Internal Download] Error:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
};
