import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
	chunkUploads,
	pendingUploads,
	getDownloadDir,
	sanitizePath,
	validateChecksum,
	ensureDir,
	resolveFileConflict,
	createDownloadError,
	ERROR_CODES,
	endUpload
} from '../../_shared';

export const POST: RequestHandler = async ({ request, params }) => {
	const uploadId = params.uploadId;
	const chunkIndex = parseInt(request.headers.get('x-chunk-index') || '0');
	const totalChunks = parseInt(request.headers.get('x-total-chunks') || '0');

	try {
		if (!uploadId) {
			return json({ error: 'uploadId is required' }, { status: 400 });
		}

		const chunkState = chunkUploads.get(uploadId);
		if (!chunkState) {
			const error = createDownloadError(
				ERROR_CODES.SESSION_EXPIRED,
				'Chunk upload session not found or expired',
				true,
				{ uploadId },
				30,
				'The upload session has expired. Please restart the download.'
			);
			return json({ error }, { status: 404 });
		}

		if (chunkIndex >= chunkState.totalChunks) {
			const error = createDownloadError(
				ERROR_CODES.INVALID_FILE,
				'Invalid chunk index provided',
				false,
				{ chunkIndex, totalChunks: chunkState.totalChunks },
				undefined,
				'The chunk index is out of range. Please restart the download.'
			);
			return json({ error }, { status: 400 });
		}

		// Read chunk data
		const chunkBuffer = Buffer.from(await request.arrayBuffer());

		// Append chunk to temp file
		await fs.appendFile(chunkState.tempFilePath, chunkBuffer);

		// Update chunk state
		chunkState.chunkIndex = Math.max(chunkState.chunkIndex, chunkIndex + 1);

		// Check if upload is complete
		if (chunkState.chunkIndex >= chunkState.totalChunks) {
			chunkState.completed = true;

			// Validate file size
			const stats = await fs.stat(chunkState.tempFilePath);
			if (stats.size !== chunkState.totalSize) {
				await fs.unlink(chunkState.tempFilePath);
				chunkUploads.delete(uploadId);
				return json({ error: 'File size mismatch' }, { status: 400 });
			}

			// Validate checksum if provided
			if (chunkState.checksum) {
				const fileBuffer = await fs.readFile(chunkState.tempFilePath);
				if (!(await validateChecksum(fileBuffer, chunkState.checksum))) {
					await fs.unlink(chunkState.tempFilePath);
					chunkUploads.delete(uploadId);
					return json({ error: 'Checksum validation failed' }, { status: 400 });
				}
			}

			// Move file to final location
			const uploadData = pendingUploads.get(uploadId);
			if (!uploadData) {
				await fs.unlink(chunkState.tempFilePath);
				chunkUploads.delete(uploadId);
				return json({ error: 'Upload metadata not found' }, { status: 404 });
			}

			const { trackId, quality, albumTitle, artistName, trackTitle, conflictResolution } =
				uploadData;

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

			// Organize by artist/album directory structure
			const baseDir = getDownloadDir();
			const artistDir = sanitizePath(artistName || 'Unknown Artist');
			const albumDir = sanitizePath(albumTitle || 'Unknown Album');
			const targetDir = path.join(baseDir, artistDir, albumDir);

			await ensureDir(targetDir);
			const initialFilepath = path.join(targetDir, filename);

			// Handle file conflicts
			const { finalPath, action } = await resolveFileConflict(
				initialFilepath,
				conflictResolution || 'overwrite_if_different',
				chunkState.totalSize,
				chunkState.checksum || undefined
			);

			// Move temp file to final location
			await fs.rename(chunkState.tempFilePath, finalPath);

			// Clean up
			pendingUploads.delete(uploadId);
			chunkUploads.delete(uploadId);
			endUpload(uploadId);

			const finalFilename = path.basename(finalPath);
			let message = `File saved to ${artistDir}/${albumDir}/${finalFilename}`;
			if (action === 'rename') {
				message = `File renamed and saved to ${artistDir}/${albumDir}/${finalFilename}`;
			} else if (action === 'skip') {
				message = `File already exists, skipped: ${artistDir}/${albumDir}/${finalFilename}`;
			}

			return json(
				{
					success: true,
					filepath: finalPath,
					filename: finalFilename,
					action,
					message
				},
				{ status: 201 }
			);
		} else {
			// Upload not complete, return progress
			const progress = (chunkState.chunkIndex / chunkState.totalChunks) * 100;
			return json({
				success: true,
				progress: Math.round(progress),
				uploadedChunks: chunkState.chunkIndex,
				totalChunks: chunkState.totalChunks,
				message: `Chunk ${chunkIndex + 1}/${chunkState.totalChunks} uploaded`
			});
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[Chunk Upload] Error: ${errorMsg}`, error);

		let downloadError;
		if (errorMsg.includes('ENOSPC') || errorMsg.includes('disk full')) {
			downloadError = createDownloadError(
				ERROR_CODES.DISK_FULL,
				'Not enough disk space available',
				false,
				{ originalError: errorMsg, uploadId: uploadId },
				undefined,
				'Please free up disk space and restart the download.'
			);
		} else if (errorMsg.includes('EACCES') || errorMsg.includes('permission denied')) {
			downloadError = createDownloadError(
				ERROR_CODES.PERMISSION_DENIED,
				'Permission denied when saving chunk',
				false,
				{ originalError: errorMsg, uploadId },
				undefined,
				'Please check file permissions and restart the download.'
			);
		} else {
			downloadError = createDownloadError(
				ERROR_CODES.UNKNOWN_ERROR,
				'Chunk upload failed: ' + errorMsg,
				true,
				{ originalError: errorMsg, uploadId },
				10,
				'Please try the download again. The upload will resume from the last successful chunk.'
			);
		}

		return json({ error: downloadError }, { status: 500 });
	}
};
