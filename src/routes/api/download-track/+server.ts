import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
	pendingUploads,
	chunkUploads,
	activeUploads,
	startCleanupInterval,
	getDownloadDir,
	getTempDir,
	sanitizePath,
	ensureDir,
	resolveFileConflict,
	canStartUpload,
	startUpload
} from './_shared';

// Start the cleanup interval when the module loads
startCleanupInterval();

export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const pathParts = url.pathname.split('/');
		const uploadId = pathParts[pathParts.indexOf('download-track') + 1];

		if (!uploadId) {
			const body = await request.json();
			if (body.blob) {
				// Direct blob upload
				const buffer = Buffer.from(body.blob.split(',')[1], 'base64');
				let ext = 'm4a';
				if (body.quality === 'HI_RES_LOSSLESS' || body.quality === 'LOSSLESS') {
					ext = 'flac';
				}
				let filename = body.trackTitle
					? `${sanitizePath(body.artistName || 'Unknown')} - ${sanitizePath(body.trackTitle)}.${ext}`
					: `track-${body.trackId}.${ext}`;
				const baseDir = getDownloadDir();
				const artistDir = sanitizePath(body.artistName || 'Unknown Artist');
				const albumDir = sanitizePath(body.albumTitle || 'Unknown Album');
				const targetDir = path.join(baseDir, artistDir, albumDir);
				await ensureDir(targetDir);
				const initialFilepath = path.join(targetDir, filename);
				const { finalPath, action } = await resolveFileConflict(
					initialFilepath,
					body.conflictResolution || 'overwrite',
					buffer.length
				);
				await fs.writeFile(finalPath, buffer);
				const finalFilename = path.basename(finalPath);
				let message = `File saved to ${artistDir}/${albumDir}/${finalFilename}`;
				if (action === 'rename')
					message = `File renamed and saved to ${artistDir}/${albumDir}/${finalFilename}`;
				else if (action === 'skip')
					message = `File already exists, skipped: ${artistDir}/${albumDir}/${finalFilename}`;
				return json(
					{ success: true, filepath: finalPath, filename: finalFilename, action, message },
					{ status: 201 }
				);
			} else {
				// Metadata
				const {
					trackId,
					quality,
					albumTitle,
					artistName,
					trackTitle,
					blobSize,
					useChunks,
					chunkSize,
					checksum,
					conflictResolution
				} = body;
				if (!trackId || !quality) return json({ error: 'Missing fields' }, { status: 400 });
				const newUploadId = randomBytes(16).toString('hex');
				if (!canStartUpload()) return json({ error: 'Too many uploads' }, { status: 429 });
				startUpload(newUploadId);
				pendingUploads.set(newUploadId, {
					trackId,
					quality,
					albumTitle,
					artistName,
					trackTitle,
					timestamp: Date.now(),
					totalSize: blobSize,
					checksum,
					conflictResolution
				});
				const response: any = {
					success: true,
					uploadId: newUploadId,
					message: 'Metadata registered'
				};
				if (useChunks && blobSize) {
					const totalChunks = Math.ceil(blobSize / chunkSize);
					const tempDir = getTempDir();
					await ensureDir(tempDir);
					const tempFilePath = path.join(tempDir, `${newUploadId}.tmp`);
					await fs.writeFile(tempFilePath, Buffer.alloc(0));
					chunkUploads.set(newUploadId, {
						uploadId: newUploadId,
						chunkIndex: 0,
						totalChunks,
						chunkSize,
						totalSize: blobSize,
						checksum: checksum || '',
						tempFilePath,
						completed: false,
						timestamp: Date.now()
					});
					response.chunked = true;
					response.totalChunks = totalChunks;
					response.chunkSize = chunkSize;
					response.message = `Send ${totalChunks} chunks`;
				}
				return json(response, { status: 201 });
			}
		} else {
			// Blob upload
			const uploadData = pendingUploads.get(uploadId);
			if (!uploadData) return json({ error: 'Session not found' }, { status: 404 });
			const arrayBuffer = await request.arrayBuffer();
			if (arrayBuffer.byteLength === 0) return json({ error: 'Empty file' }, { status: 400 });
			const { trackId, quality, albumTitle, artistName, trackTitle, conflictResolution } =
				uploadData;
			let ext = 'm4a';
			if (quality === 'HI_RES_LOSSLESS' || quality === 'LOSSLESS') ext = 'flac';
			let filename = trackTitle
				? `${sanitizePath(artistName || 'Unknown')} - ${sanitizePath(trackTitle)}.${ext}`
				: `track-${trackId}.${ext}`;
			const baseDir = getDownloadDir();
			const artistDir = sanitizePath(artistName || 'Unknown Artist');
			const albumDir = sanitizePath(albumTitle || 'Unknown Album');
			const targetDir = path.join(baseDir, artistDir, albumDir);
			await ensureDir(targetDir);
			const initialFilepath = path.join(targetDir, filename);
			const buffer = Buffer.from(arrayBuffer);
			const { finalPath, action } = await resolveFileConflict(
				initialFilepath,
				conflictResolution,
				buffer.length,
				uploadData.checksum
			);
			await fs.writeFile(finalPath, buffer);
			pendingUploads.delete(uploadId);
			activeUploads.delete(uploadId);
			const finalFilename = path.basename(finalPath);
			let message = `File saved to ${artistDir}/${albumDir}/${finalFilename}`;
			if (action === 'rename') message = `File renamed`;
			else if (action === 'skip') message = `File skipped`;
			return json(
				{ success: true, filepath: finalPath, filename: finalFilename, action, message },
				{ status: 201 }
			);
		}
	} catch (error) {
		console.error('Download error:', error);
		return json({ error: 'Server error' }, { status: 500 });
	}
};
