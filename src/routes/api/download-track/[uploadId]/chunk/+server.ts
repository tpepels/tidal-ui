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
	endUpload,
	MAX_FILE_SIZE,
	MAX_CHUNK_SIZE,
	retryFs
} from '../../_shared';

export const POST: RequestHandler = async ({ request, params }) => {
	const uploadId = params.uploadId;
	const chunkIndex = parseInt(request.headers.get('x-chunk-index') || '0');
	const totalChunks = parseInt(request.headers.get('x-total-chunks') || '0');

	try {
		if (!uploadId) {
			return json({ error: 'uploadId is required' }, { status: 400 });
		}

		// Validate headers
		if (isNaN(chunkIndex) || chunkIndex < 0) {
			return json(
				{ error: 'Invalid x-chunk-index header: must be a non-negative integer' },
				{ status: 400 }
			);
		}
		if (isNaN(totalChunks) || totalChunks <= 0) {
			return json(
				{ error: 'Invalid x-total-chunks header: must be a positive integer' },
				{ status: 400 }
			);
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
		if (chunkBuffer.length === 0) {
			return json({ error: 'Empty chunk data' }, { status: 400 });
		}
		if (chunkBuffer.length > MAX_CHUNK_SIZE) {
			return json({ error: `Chunk too large: maximum ${MAX_CHUNK_SIZE} bytes` }, { status: 400 });
		}

		// Append chunk to temp file
		try {
			await retryFs(() => fs.appendFile(chunkState.tempFilePath, chunkBuffer));
		} catch (err: any) {
			console.error('Chunk append error:', err);
			let downloadError;
			if (err.code === 'ENOSPC' || err.message.includes('disk full')) {
				downloadError = createDownloadError(
					ERROR_CODES.DISK_FULL,
					'Not enough disk space available for chunk',
					false,
					{ originalError: err.message, uploadId },
					undefined,
					'Please free up disk space and restart the download.'
				);
			} else if (err.code === 'EACCES' || err.message.includes('permission denied')) {
				downloadError = createDownloadError(
					ERROR_CODES.PERMISSION_DENIED,
					'Permission denied when appending chunk',
					false,
					{ originalError: err.message, uploadId },
					undefined,
					'Please check file permissions and restart the download.'
				);
			} else {
				downloadError = createDownloadError(
					ERROR_CODES.UNKNOWN_ERROR,
					'Chunk append failed: ' + err.message,
					true,
					{ originalError: err.message, uploadId },
					10,
					'Please try the download again.'
				);
			}
			return json({ error: downloadError }, { status: 500 });
		}

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
					endUpload(uploadId);
					return json({ error: 'Checksum validation failed' }, { status: 400 });
				}
			}

			// Move file to final location
			const uploadData = pendingUploads.get(uploadId);
			if (!uploadData) {
				await fs.unlink(chunkState.tempFilePath);
				chunkUploads.delete(uploadId);
				endUpload(uploadId);
				return json({ error: 'Upload metadata not found' }, { status: 404 });
			}

			const {
				trackId,
				quality,
				albumTitle,
				artistName,
				trackTitle,
				conflictResolution,
				totalSize
			} = uploadData;
			if (totalSize && totalSize > MAX_FILE_SIZE) {
				await fs.unlink(chunkState.tempFilePath);
				chunkUploads.delete(uploadId);
				return json(
					{ error: `File too large: maximum ${MAX_FILE_SIZE} bytes allowed` },
					{ status: 400 }
				);
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
			try {
				await retryFs(() => fs.rename(chunkState.tempFilePath, finalPath));
			} catch (err: any) {
				console.error('File rename error:', err);
				const downloadError = createDownloadError(
					ERROR_CODES.UNKNOWN_ERROR,
					'Failed to move file to final location: ' + err.message,
					false,
					{ originalError: err.message, uploadId },
					undefined,
					'Please check disk space and permissions.'
				);
				return json({ error: downloadError }, { status: 500 });
			}

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

		if (uploadId) endUpload(uploadId);
		return json({ error: downloadError }, { status: 500 });
	}
};
