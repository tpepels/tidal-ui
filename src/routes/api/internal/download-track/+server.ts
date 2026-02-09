/**
 * Internal API endpoint for server-side track downloads
 * This endpoint fetches tracks from TIDAL and saves them directly on the server
 * Only accessible from background worker (localhost)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AudioQuality } from '$lib/types';
import { losslessAPI } from '$lib/api';
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

		// Fetch track metadata using the losslessAPI proxy
		// This goes through /api/tidal which has all the TIDAL auth
		const baseUrl = `http://localhost:${process.env.PORT || 5173}`;
		
		// Get track metadata
		const trackResponse = await fetch(`${baseUrl}/api/tidal?endpoint=/tracks/${trackId}`);
		if (!trackResponse.ok) {
			return json(
				{ success: false, error: 'Failed to fetch track metadata' },
				{ status: 500 }
			);
		}
		const trackData = await trackResponse.json();
		
		// Get stream URL via the proxy
		const streamResponse = await fetch(
			`${baseUrl}/api/tidal?endpoint=/tracks/${trackId}/streamUrl&quality=${quality}`
		);
		if (!streamResponse.ok) {
			return json(
				{ success: false, error: 'Failed to get stream URL' },
				{ status: 500 }
			);
		}
		const streamData = await streamResponse.json();
		
		if (!streamData.url) {
			return json(
				{ success: false, error: 'No stream URL available' },
				{ status: 404 }
			);
		}

		// Download the audio stream
		const audioResponse = await fetch(streamData.url);
		if (!audioResponse.ok) {
			return json(
				{ success: false, error: `Failed to download audio: HTTP ${audioResponse.status}` },
				{ status: 500 }
			);
		}

		const arrayBuffer = await audioResponse.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		if (buffer.length === 0) {
			return json(
				{ success: false, error: 'Downloaded audio file is empty' },
				{ status: 500 }
			);
		}

		// Build file path
		const finalArtistName = artistName || trackData.artist?.name || 'Unknown Artist';
		const finalAlbumTitle = albumTitle || trackData.album?.title || 'Unknown Album';
		const finalTrackTitle = trackTitle || trackData.title || 'Unknown Track';

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
				const coverUrl = losslessAPI.getCoverUrl(trackData.album.cover, '1280');
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
