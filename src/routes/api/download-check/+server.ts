import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AudioQuality } from '$lib/types';
import { getDownloadDir, sanitizePath } from '../download-track/_shared';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { trackId, quality, albumTitle, artistName, trackTitle } = body as {
			trackId: number;
			quality: AudioQuality;
			albumTitle?: string;
			artistName?: string;
			trackTitle?: string;
		};

		if (typeof trackId !== 'number' || trackId <= 0 || !quality) {
			return json({ error: 'Missing required fields: trackId, quality' }, { status: 400 });
		}
		const validQualities: AudioQuality[] = ['LOW', 'HIGH', 'LOSSLESS', 'HI_RES_LOSSLESS'];
		if (!validQualities.includes(quality)) {
			return json({ error: 'Invalid quality' }, { status: 400 });
		}

		// Determine file extension based on quality
		let ext = 'm4a';
		if (quality === 'HI_RES_LOSSLESS' || quality === 'LOSSLESS') {
			ext = 'flac';
		} else if (quality === 'HIGH') {
			ext = 'm4a';
		}

		// Generate filename
		let filename: string;
		if (trackTitle) {
			const sanitizedTitle = sanitizePath(trackTitle);
			const sanitizedArtist = sanitizePath(artistName || 'Unknown');
			filename = `${sanitizedArtist} - ${sanitizedTitle}.${ext}`;
		} else {
			filename = `track-${trackId}.${ext}`;
		}

		// Check if file exists in expected location
		const baseDir = getDownloadDir();
		const artistDir = sanitizePath(artistName || 'Unknown Artist');
		const albumDir = sanitizePath(albumTitle || 'Unknown Album');
		const expectedPath = path.join(baseDir, artistDir, albumDir, filename);

		try {
			await fs.access(expectedPath);
			return json({
				exists: true,
				filepath: expectedPath,
				filename,
				size: (await fs.stat(expectedPath)).size
			});
		} catch {
			return json({
				exists: false,
				expectedPath,
				filename
			});
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[Download Check] Error:', errorMsg);
		return json({ error: 'Check failed: ' + errorMsg }, { status: 500 });
	}
};
