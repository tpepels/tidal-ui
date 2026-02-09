/**
 * Internal API endpoint for server-side track downloads
 * This endpoint fetches tracks from TIDAL and saves them directly on the server
 * Only accessible from background worker (localhost)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AudioQuality } from '$lib/types';
import { API_CONFIG } from '$lib/config';

// Timestamp helper
const getTimestamp = () => {
	const now = new Date();
	return now.toLocaleTimeString('en-US', { hour12: false });
};
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
			console.log(`[${getTimestamp()}] [Internal Download] Full track response structure:`, JSON.stringify(trackResponseData, null, 2).substring(0, 1500));
		} catch {
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
		// Response format: { version: "2.2", data: { trackId, manifest, originalTrackUrl?, ... } }
		let streamingData: Record<string, unknown> | undefined;
		
		// Handle v2 API format
		if (trackResponseData && typeof trackResponseData === 'object' && 'data' in trackResponseData) {
			const container = trackResponseData as { data?: unknown };
			if (container.data && typeof container.data === 'object') {
				streamingData = container.data as Record<string, unknown>;
				console.log(`[${getTimestamp()}] [Internal Download] Found v2 API data:`, Object.keys(streamingData));
			}
		}
		
		if (!streamingData) {
			console.error(`[${getTimestamp()}] [Internal Download] Could not parse streaming data. Response:`, JSON.stringify(trackResponseData, null, 2).substring(0, 500));
			return json(
				{ success: false, error: 'Could not parse track streaming data from response' },
				{ status: 500 }
			);
		}
		
		// CRITICAL: Check for proxied URL first (like browser code does)
		// The proxy API should provide an already-authenticated URL
		let streamUrl: string | undefined;
		
		// Check common URL field names
		if (typeof streamingData.originalTrackUrl === 'string') {
			streamUrl = streamingData.originalTrackUrl;
			console.log(`[${getTimestamp()}] [Internal Download] Using originalTrackUrl from API`);
		} else if (typeof streamingData.url === 'string') {
			streamUrl = streamingData.url;
			console.log(`[${getTimestamp()}] [Internal Download] Using url from API`);
		} else if (typeof streamingData.streamUrl === 'string') {
			streamUrl = streamingData.streamUrl;
			console.log(`[${getTimestamp()}] [Internal Download] Using streamUrl from API`);
		}
		
		// FALLBACK: Only parse manifest if no direct URL provided
		if (!streamUrl && 'manifest' in streamingData && typeof streamingData.manifest === 'string') {
			console.log(`[${getTimestamp()}] [Internal Download] No direct URL, falling back to manifest parsing`);
			const manifestBase64 = streamingData.manifest;
			
			// Decode manifest (base64)
			let manifestContent: string;
			try {
				manifestContent = Buffer.from(manifestBase64, 'base64').toString('utf-8');
				console.log(`[${getTimestamp()}] [Internal Download] Decoded manifest type:`, manifestContent.substring(0, 50));
			} catch (decodeError) {
				console.error(`[${getTimestamp()}] [Internal Download] Failed to decode manifest:`, decodeError);
				return json(
					{ success: false, error: 'Failed to decode streaming manifest' },
					{ status: 500 }
				);
			}
			
			// Extract stream URL from manifest
			// If manifest is plain URL
			if (manifestContent.startsWith('http')) {
				streamUrl = manifestContent.trim();
			} else if (manifestContent.startsWith('{')) {
				// JSON format
				try {
					const parsed = JSON.parse(manifestContent);
					streamUrl = parsed.url || parsed.urls?.[0];
				} catch (jsonError) {
					console.warn(`[${getTimestamp()}] [Internal Download] Manifest is not valid JSON:`, jsonError);
				}
			} else if (manifestContent.startsWith('<?xml')) {
				// DASH XML format - extract BaseURL or media URL
				// Try BaseURL tag first (most common)
				const baseUrlMatch = manifestContent.match(/<BaseURL>([^<]+)<\/BaseURL>/);
				if (baseUrlMatch) {
					streamUrl = baseUrlMatch[1].trim();
					// Unescape XML entities (&amp; -> &, &quot; -> ", etc.)
					streamUrl = streamUrl.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
					console.log(`[${getTimestamp()}] [Internal Download] Extracted BaseURL from DASH manifest`);
				} else {
					// Extract all URLs from the XML
					const allUrls = manifestContent.match(/(https?:\/\/[^\s<>"']+)/g);
					if (allUrls) {
						// Filter out xmlns/schema URLs and keep actual media URLs
						streamUrl = allUrls.find(url => 
							!url.includes('w3.org') && 
							!url.includes('schemas') &&
							!url.includes('xmlns')
						);
						// Unescape XML entities
						if (streamUrl) {
							streamUrl = streamUrl.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
						}
						if (streamUrl) {
								console.log(`[${getTimestamp()}] [Internal Download] Extracted media URL from DASH`);
						}
					}
					
					if (!streamUrl) {
								console.error(`[${getTimestamp()}] [Internal Download] No media URL found in DASH manifest`);
								console.error(`[${getTimestamp()}] [Internal Download] Manifest sample:`, manifestContent.substring(0, 800));
					}
				}
			}
		}
		
		if (!streamUrl) {
			console.error(`[${getTimestamp()}] [Internal Download] Could not extract URL from manifest. First 200 chars:`, manifestContent.substring(0, 200));
			return json(
				{ success: false, error: 'Could not extract stream URL from manifest' },
				{ status: 404 }
			);
		}
		
		// Validate and log the stream URL
		try {
			const urlObj = new URL(streamUrl);
			const pathEnd = urlObj.pathname.length > 60 ? '...' : '';
			console.log(`[${getTimestamp()}] [Internal Download] Stream:`, `${urlObj.hostname}${urlObj.pathname.substring(0, 60)}${pathEnd}`);
		} catch {
			console.error(`[${getTimestamp()}] [Internal Download] Invalid URL format:`, streamUrl.substring(0, 100));
			return json(
				{ success: false, error: `Invalid stream URL format: ${streamUrl.substring(0, 100)}` },
				{ status: 500 }
			);
		}

		// Download the audio stream through the proxy
		// The server runs HTTPS, so NODE_TLS_REJECT_UNAUTHORIZED=0 allows self-signed cert
		// Signed URLs from Tidal expire quickly, so we may need to retry with a fresh URL
		let audioResponse: Response | null = null;
		let lastError = 'Unknown error';
		
		for (let attempt = 1; attempt <= 2; attempt++) {
			console.log(`[${getTimestamp()}] [Internal Download] Fetch attempt ${attempt}/2`);
			
			if (attempt === 2) {
				// Re-fetch track data to get a fresh signed URL
					console.log(`[${getTimestamp()}] [Internal Download] Signed URL likely expired, fetching fresh track data...`);
				try {
					const freshTrackResponse = await fetch(`${apiBaseUrl}/track/?id=${trackId}&quality=${quality}`);
					if (!freshTrackResponse.ok) {
						return json(
							{ success: false, error: 'Failed to refresh track metadata' },
							{ status: 500 }
						);
					}
					const freshData = await freshTrackResponse.json();
					const freshStreamingData = (freshData as Record<string, Record<string, unknown>>)?.data;
					
					if (freshStreamingData && 'manifest' in freshStreamingData) {
						const manifestBase64 = freshStreamingData.manifest as string;
						const manifestContent = Buffer.from(manifestBase64, 'base64').toString('utf-8');
						const baseUrlMatch = manifestContent.match(/<BaseURL>([^<]+)<\/BaseURL>/);
						if (baseUrlMatch) {
							streamUrl = baseUrlMatch[1].trim();
						} else {
							const allUrls = manifestContent.match(/(https?:\/\/[^\s<>"']+)/g);
							if (allUrls) {
								streamUrl = allUrls.find(url => 
									!url.includes('w3.org') && !url.includes('schemas') && !url.includes('xmlns')
								) || streamUrl;
							}
						}
					}
				} catch (refreshError) {
					console.error(`[${getTimestamp()}] [Internal Download] Failed to refresh track data:`, refreshError);
				}
			}
			
			try {
				const port = process.env.PORT || 5000;
				const proxiedUrl = `https://localhost:${port}/api/proxy?url=${encodeURIComponent(streamUrl)}`;
				
				console.log(`[${getTimestamp()}] [Internal Download] ========== PROXY FETCH START (Attempt ` + attempt + `) ==========`);
				console.log(`[${getTimestamp()}] [Internal Download] Proxied URL:`, proxiedUrl.substring(0, 200));
				console.log(`[${getTimestamp()}] [Internal Download] Calling fetch...`);
				
				const fetchStart = Date.now();
				audioResponse = await fetch(proxiedUrl);
				const fetchDuration = Date.now() - fetchStart;
				
				console.log(`[${getTimestamp()}] [Internal Download] Fetch completed in`, fetchDuration, 'ms');
				console.log(`[${getTimestamp()}] [Internal Download] Response status:`, audioResponse.status, audioResponse.statusText);
				console.log(`[${getTimestamp()}] [Internal Download] ========== PROXY FETCH END ==========`);
				
				// Success or non-retryable error
				if (audioResponse.ok || (audioResponse.status !== 403 && attempt === 1)) {
					break;
				}
				
				// 403 on first attempt: prepare to retry
				if (audioResponse.status === 403 && attempt === 1) {
					console.log(`[${getTimestamp()}] [Internal Download] Got 403, will retry with fresh URL on next attempt`);
					lastError = `HTTP ${audioResponse.status}: Signed URL expired`;
					continue;
				}
				
				// If we got here on second attempt, give up
				break;
			} catch (streamError) {
				console.error(`[${getTimestamp()}] [Internal Download] ========== PROXY FETCH ERROR ==========`);
				console.error(`[${getTimestamp()}] [Internal Download] Error message:`, streamError instanceof Error ? streamError.message : 'Unknown');
				console.error(`[${getTimestamp()}] [Internal Download] Error stack:`, streamError instanceof Error ? streamError.stack : 'No stack');
				console.error(`[${getTimestamp()}] [Internal Download] ========================================`);
				lastError = streamError instanceof Error ? streamError.message : 'Network error';
				
				if (attempt === 2) {
					return json(
						{ success: false, error: `Failed to fetch audio stream: ${lastError}` },
						{ status: 500 }
					);
				}
			}
		}
		
		if (!audioResponse) {
			return json(
				{ success: false, error: `Failed to fetch audio stream: ${lastError}` },
				{ status: 500 }
			);
		}
		if (!audioResponse.ok) {
			console.error(`[${getTimestamp()}] [Internal Download] Proxy returned non-OK status:`, audioResponse.status, audioResponse.statusText);
			console.error(`[${getTimestamp()}] [Internal Download] Response headers:`, Object.fromEntries(audioResponse.headers.entries()));
			
			// Try to read error body
			try {
				const errorText = await audioResponse.text();
					console.error(`[${getTimestamp()}] [Internal Download] Response body:`, errorText.substring(0, 500));
			} catch (e) {
					console.error(`[${getTimestamp()}] [Internal Download] Could not read response body`);
			}
			
			return json(
				{ success: false, error: `Failed to download audio: HTTP ${audioResponse.status}` },
				{ status: 500 }
			);
		}

		let arrayBuffer: ArrayBuffer;
		try {
			console.log(`[${getTimestamp()}] [Internal Download] Reading response body...`);
			const readStart = Date.now();
			arrayBuffer = await audioResponse.arrayBuffer();
			const readDuration = Date.now() - readStart;
			console.log(`[${getTimestamp()}] [Internal Download] Body read in`, readDuration, 'ms, size:', arrayBuffer.byteLength, 'bytes');
		} catch (bufferError) {
			console.error(`[${getTimestamp()}] [Internal Download] Failed to read response body:`, bufferError);
			return json(
				{ success: false, error: `Failed to read audio data: ${bufferError instanceof Error ? bufferError.message : 'Read error'}` },
				{ status: 500 }
			);
		}
		
		const buffer = Buffer.from(arrayBuffer);
		console.log(`[${getTimestamp()}] [Internal Download] Created buffer, size:`, buffer.length, 'bytes');

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
				console.log(`[${getTimestamp()}] [Internal Download] Downloading cover art...`);
				await downloadCoverToDir(targetDir, coverUrl, path.basename(finalPath));
				console.log(`[${getTimestamp()}] [Internal Download] Cover art downloaded`);
			} catch (coverErr) {
				console.warn(`[${getTimestamp()}] [Internal Download] Cover download failed:`, coverErr);
			}
		}

		return json({
			success: true,
			filename,
			filepath: finalPath,
			size: buffer.length
		});
	} catch (error) {
		console.error(`[${getTimestamp()}] [Internal Download] Error:`, error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
};
