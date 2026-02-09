import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
	pendingUploads,
	getDownloadDir,
	sanitizePath,
	ensureDir,
	resolveFileConflict,
	MAX_FILE_SIZE,
	validateChecksum,
	downloadCoverToDir,
	retryFs,
	endUpload
} from '../_shared';

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

		const {
			trackId,
			quality,
			albumTitle,
			artistName,
			trackTitle,
			conflictResolution,
			totalSize,
			checksum,
			downloadCoverSeperately,
			coverUrl
		} = uploadData;

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

		const buffer = Buffer.from(arrayBuffer);
		if (MAX_FILE_SIZE > 0 && buffer.length > MAX_FILE_SIZE) {
			const trackDesc = `track ID ${trackId} (${trackTitle || 'Unknown'})`;
			return json(
				{ error: `File too large (${(buffer.length / 1024 / 1024).toFixed(2)}MB) for ${trackDesc}: maximum ${MAX_FILE_SIZE} bytes allowed` },
				{ status: 400 }
			);
		}
		if (totalSize && buffer.length !== totalSize) {
			return json({ error: 'File size mismatch' }, { status: 400 });
		}
		if (checksum && !(await validateChecksum(buffer, checksum))) {
			return json({ error: 'Checksum validation failed' }, { status: 400 });
		}

		// Full filepath
		const initialFilepath = path.join(targetDir, filename);
		const { finalPath, action } = await resolveFileConflict(
			initialFilepath,
			conflictResolution || 'overwrite_if_different',
			buffer.length,
			checksum
		);
		if (action === 'skip') {
			const finalFilename = path.basename(finalPath);
			endUpload(uploadId);
			return json(
				{
					success: true,
					filepath: finalPath,
					filename: finalFilename,
					action,
					message: `File already exists, skipped: ${artistDir}/${albumDir}/${finalFilename}`
				},
				{ status: 201 }
			);
		}

		// Write blob directly to file
		// Note: Metadata is already embedded client-side by losslessAPI.fetchTrackBlob()
		await retryFs(() => fs.writeFile(finalPath, buffer));

		let coverDownloaded = false;
		if (downloadCoverSeperately && coverUrl) {
			coverDownloaded = await downloadCoverToDir(coverUrl, targetDir);
		}

		// Clean up the upload session
		endUpload(uploadId);

		return json(
			{
				success: true,
				filepath: finalPath,
				filename: path.basename(finalPath),
				action,
				message:
					action === 'rename'
						? `File renamed and saved to ${artistDir}/${albumDir}/${path.basename(finalPath)}`
						: `File saved to ${artistDir}/${albumDir}/${path.basename(finalPath)}`
							+ (coverDownloaded ? ' (with cover)' : '')
			},
			{ status: 201 }
		);
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[Server Download] Error: ${errorMsg}`, error);
		if (params.uploadId) {
			endUpload(params.uploadId);
		}
		return json({ error: 'Download failed: ' + errorMsg }, { status: 500 });
	}
};
