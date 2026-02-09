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
		const { trackId, quality, albumTitle, artistName, trackTitle, trackNumber, coverUrl, conflictResolution } = body as {
			trackId: number;
			quality: AudioQuality;
			albumTitle?: string;
			artistName?: string;
			trackTitle?: string;
			trackNumber?: number;
			coverUrl?: string;
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
		
		// Parse track streaming data from response
		// Response format: { version: "2.2", data: { trackId, manifest, ... } }
		let streamingData: Record<string, unknown> | undefined;
		let manifestBase64: string | undefined;
		
		// Handle v2 API format
		if (trackResponseData && typeof trackResponseData === 'object' && 'data' in trackResponseData) {
			const container = trackResponseData as { data?: unknown };
			if (container.data && typeof container.data === 'object') {
				streamingData = container.data as Record<string, unknown>;
				console.log('[Internal Download] Found v2 API data:', Object.keys(streamingData));
				
				// Extract manifest
				if ('manifest' in streamingData && typeof streamingData.manifest === 'string') {
					manifestBase64 = streamingData.manifest;
				}
			}
		}
		
		if (!streamingData) {
			console.error('[Internal Download] Could not parse streaming data. Response:', JSON.stringify(trackResponseData, null, 2).substring(0, 500));
			return json(
				{ success: false, error: 'Could not parse track streaming data from response' },
				{ status: 500 }
			);
		}
		
		if (!manifestBase64) {
			console.error('[Internal Download] No manifest in response. Keys:', Object.keys(streamingData));
			return json(
				{ success: false, error: 'No streaming manifest in response' },
				{ status: 404 }
			);
		}
		
		// Decode manifest (base64)
		let manifestContent: string;
		try {
			manifestContent = Buffer.from(manifestBase64, 'base64').toString('utf-8');
			console.log('[Internal Download] Decoded manifest type:', manifestContent.substring(0, 50));
		} catch (decodeError) {
			console.error('[Internal Download] Failed to decode manifest:', decodeError);
			return json(
				{ success: false, error: 'Failed to decode streaming manifest' },
				{ status: 500 }
			);
		}
		
		// Extract stream URL from manifest
		let streamUrl: string | undefined;
		
		// If manifest is plain URL
		if (manifestContent.startsWith('http')) {
			streamUrl = manifestContent.trim();
		} else if (manifestContent.startsWith('{')) {
			// JSON format
			try {
				const parsed = JSON.parse(manifestContent);
				streamUrl = parsed.url || parsed.urls?.[0];
			} catch (jsonError) {
				console.warn('[Internal Download] Manifest is not valid JSON:', jsonError);
			}
		} else if (manifestContent.startsWith('<?xml')) {
			// DASH XML format - extract BaseURL or media URL
			// Try BaseURL tag first (most common)
			const baseUrlMatch = manifestContent.match(/<BaseURL>([^<]+)<\/BaseURL>/);
			if (baseUrlMatch) {
				streamUrl = baseUrlMatch[1].trim();
				console.log('[Internal Download] Extracted BaseURL from DASH manifest');
			} else {
				// Try media attribute
				const mediaMatch = manifestContent.match(/media="([^"]+\.(flac|mp4|m4a)[^"]*)"/i);
				if (mediaMatch) {
					streamUrl = mediaMatch[1];
					console.log('[Internal Download] Extracted media attribute from DASH');
				} else {
					// Fallback: find URLs that look like media URLs (not xmlns)
					// Skip xmlns URLs and look for actual media URLs
					const allUrls = manifestContent.match(/(https?:\/\/[^\s<>"]+)/g);
					if (allUrls) {
						// Filter out xmlns/schema URLs and keep actual media URLs
						streamUrl = allUrls.find(url => 
							!url.includes('w3.org') && 
							!url.includes('schemas') &&
							!url.includes('xmlns')
						);
						if (streamUrl) {
							console.log('[Internal Download] Extracted media URL via filtered search');
						}
					}
					
					if (!streamUrl) {
						console.error('[Internal Download] No media URL found. Sample of manifest:', manifestContent.substring(0, 500));
					}
				}
			}
		}
		
		if (!streamUrl) {
			console.error('[Internal Download] Could not extract URL from manifest. First 200 chars:', manifestContent.substring(0, 200));
			return json(
				{ success: false, error: 'Could not extract stream URL from manifest' },
				{ status: 404 }
			);
		}
		
		// Validate and log the stream URL
		try {
			const urlObj = new URL(streamUrl);
			const pathEnd = urlObj.pathname.length > 60 ? '...' : '';
			console.log(`[Internal Download] Stream: ${urlObj.hostname}${urlObj.pathname.substring(0, 60)}${pathEnd}`);
		} catch (urlError) {
			console.error('[Internal Download] Invalid URL format:', streamUrl.substring(0, 100));
			return json(
				{ success: false, error: `Invalid stream URL format: ${streamUrl.substring(0, 100)}` },
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

		// Build file path using metadata from request body
		// (API response only contains streaming manifest, not track metadata)
		const finalArtistName = artistName || 'Unknown Artist';
		const finalAlbumTitle = albumTitle || 'Unknown Album';
		const finalTrackTitle = trackTitle || 'Unknown Track';

		const detectedFormat = detectAudioFormatFromBuffer(buffer);
		const ext = getServerExtension(quality, detectedFormat);
		
		const filename = buildServerFilename(
			finalArtistName,
			finalTrackTitle,
			trackId,
			ext,
			streamingData,
			trackNumber
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

		// TODO: Embed metadata using trackTitle, artistName, albumTitle from request body
		// Current embedMetadataToFile expects full track object with album/artist nested objects
		// which we don't have in streamingData. Skip for now.
		// Future: build metadata object from request params or fetch track metadata separately

		// Download cover art (non-blocking)
		if (coverUrl) {
			try {
				console.log('[Internal Download] Downloading cover art...');
				await downloadCoverToDir(targetDir, coverUrl, path.basename(finalPath));
				console.log('[Internal Download] Cover art downloaded');
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
