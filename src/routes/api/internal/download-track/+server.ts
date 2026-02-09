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
		
		// Log the response structure for debugging
		console.log('[Internal Download] Track response type:', typeof trackResponseData);
		console.log('[Internal Download] Track response is array:', Array.isArray(trackResponseData));
		console.log('[Internal Download] Track response keys:', trackResponseData && typeof trackResponseData === 'object' ? Object.keys(trackResponseData).slice(0, 10) : 'N/A');
		if (Array.isArray(trackResponseData)) {
			console.log('[Internal Download] Array length:', trackResponseData.length);
			console.log('[Internal Download] First entry keys:', trackResponseData[0] && typeof trackResponseData[0] === 'object' ? Object.keys(trackResponseData[0]).slice(0, 10) : 'N/A');
		}
		
		// Parse track data from response (handle various response formats)
		let trackData: Record<string, unknown> | undefined;
		let streamUrl: string | undefined;
		
		// The response might be an array or object
		const dataArray = Array.isArray(trackResponseData) ? trackResponseData : [trackResponseData];
		
		for (const entry of dataArray) {
			if (entry && typeof entry === 'object') {
				const obj = entry as Record<string, unknown>;
				
				// Check if this looks like track metadata
				if ('title' in obj && ('id' in obj || 'url' in obj)) {
					// This entry has title and either id or url - likely track metadata
					if (!trackData && 'title' in obj && 'artist' in obj) {
						trackData = obj;
						console.log('[Internal Download] Found trackData with title and artist');
					}
					
					// Check if this entry has a URL or manifest
					if (!streamUrl && ('url' in obj || 'manifest' in obj)) {
						const rawUrl = obj.url || obj.manifest;
						if (rawUrl && typeof rawUrl === 'string') {
							streamUrl = rawUrl;
							console.log('[Internal Download] Found streamUrl:', streamUrl.substring(0, 50) + '...');
						}
					}
				}
			}
		}
		
		if (!trackData) {
			console.error('[Internal Download] Could not find trackData. Response structure:', JSON.stringify(trackResponseData, null, 2).substring(0, 500));
			return json(
				{ success: false, error: 'Could not parse track metadata from response' },
				{ status: 500 }
			);
		}
		
		// If no stream URL found in array, try trackData itself
		if (!streamUrl) {
			const rawUrl = trackData.url || trackData.manifest;
			if (rawUrl && typeof rawUrl === 'string') {
				streamUrl = rawUrl;
				console.log('[Internal Download] Found streamUrl in trackData');
			}
		}
		
		// If streamUrl doesn't look like a URL, try base64 decoding (manifest format)
		if (streamUrl && !streamUrl.startsWith('http')) {
			try {
				const decoded = Buffer.from(streamUrl, 'base64').toString('utf-8');
				console.log('[Internal Download] Decoded manifest, first 100 chars:', decoded.substring(0, 100));
				
				// If decoded starts with http, use it directly
				if (decoded.startsWith('http')) {
					streamUrl = decoded;
				} else {
					// Try parsing as JSON
					try {
						const parsed = JSON.parse(decoded);
						if (parsed.url) {
							streamUrl = parsed.url;
						} else if (parsed.urls && Array.isArray(parsed.urls) && parsed.urls[0]) {
							streamUrl = parsed.urls[0];
						}
					} catch {
						// Not JSON, check if contains URL
						const urlMatch = decoded.match(/(https?:\/\/[^\s]+)/);
						if (urlMatch) {
							streamUrl = urlMatch[1];
						}
					}
				}
			} catch (decodeError) {
				console.warn('[Internal Download] Failed to decode manifest:', decodeError);
			}
		}
		
		if (!streamUrl || typeof streamUrl !== 'string') {
			console.error('[Internal Download] No stream URL available. trackData keys:', Object.keys(trackData));
			return json(
				{ success: false, error: 'No stream URL available in track data' },
				{ status: 404 }
			);
		}
		
		console.log('[Internal Download] Final streamUrl:', streamUrl.substring(0, 80) + '...');
		
		// Validate stream URL format
		try {
			new URL(streamUrl);
		} catch (urlError) {
			console.error('[Internal Download] Invalid stream URL format:', streamUrl);
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
