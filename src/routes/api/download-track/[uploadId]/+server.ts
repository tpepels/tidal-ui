import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import * as fs from 'fs/promises';
import * as path from 'path';
import { pendingUploads, getDownloadDir, sanitizePath } from '../_shared';

// Ensure directory exists
const ensureDir = async (dirPath: string): Promise<void> => {
	try {
		await fs.mkdir(dirPath, { recursive: true });
	} catch (err) {
		console.error(`Failed to create directory ${dirPath}:`, err);
		throw err;
	}
};

export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const uploadId = params.uploadId;

		if (!uploadId) {
			return json({ error: 'uploadId is required' }, { status: 400 });
		}

		// Phase 2: Blob POST (with uploadId in path)
		const uploadData = pendingUploads.get(uploadId);
		if (!uploadData) {
			console.error(`[Server Download] [${uploadId}] Upload session not found`);
			return json({ error: 'Upload session not found or expired' }, { status: 404 });
		}

		// Read the binary blob from the request body
		const arrayBuffer = await request.arrayBuffer();
		if (arrayBuffer.byteLength === 0) {
			console.error(`[Server Download] [${uploadId}] Empty blob received`);
			return json({ error: 'Empty blob' }, { status: 400 });
		}

		const { trackId, quality, albumTitle, artistName, trackTitle } = uploadData;

		// Determine file extension based on quality
		let ext = 'm4a';
		if (quality === 'HI_RES_LOSSLESS' || quality === 'LOSSLESS') {
			ext = 'flac';
		} else if (quality === 'HIGH') {
			ext = 'm4a';
		} else {
			ext = 'm4a';
		}

		// Generate filename using track title if available, otherwise use track ID
		let filename: string;
		if (trackTitle) {
			const sanitizedTitle = sanitizePath(trackTitle);
			const sanitizedArtist = sanitizePath(artistName || 'Unknown');
			filename = `${sanitizedArtist} - ${sanitizedTitle}.${ext}`;
		} else {
			filename = `track-${trackId}.${ext}`;
		}

		// Organize by artist/album directory structure
		const baseDir = getDownloadDir();
		const artistDir = sanitizePath(artistName || 'Unknown Artist');
		const albumDir = sanitizePath(albumTitle || 'Unknown Album');
		const targetDir = path.join(baseDir, artistDir, albumDir);

		// Ensure target directory exists
		await ensureDir(targetDir);

		// Full filepath
		const filepath = path.join(targetDir, filename);

		// Write blob directly to file
		// Note: Metadata is already embedded client-side by losslessAPI.fetchTrackBlob()
		const buffer = Buffer.from(arrayBuffer);
		await fs.writeFile(filepath, buffer);

		// Clean up the upload session
		pendingUploads.delete(uploadId);

		return json(
			{
				success: true,
				filepath,
				filename,
				message: `File saved to ${artistDir}/${albumDir}/${filename}`
			},
			{ status: 201 }
		);
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[Server Download] Error: ${errorMsg}`, error);
		return json({ error: 'Download failed: ' + errorMsg }, { status: 500 });
	}
};
