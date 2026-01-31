import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
	chunkUploads,
	pendingUploads,
	getDownloadDir,
	sanitizePath,
	ensureDir,
	resolveFileConflict,
	createDownloadError,
	ERROR_CODES,
	endUpload,
	MAX_FILE_SIZE,
	MAX_CHUNK_SIZE,
	validateFileChecksum,
	downloadCoverToDir,
	moveFile,
	retryFs
} from '../../_shared';
import { embedMetadataToFile } from '$lib/server/metadataEmbedder';

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
		if (
			!Number.isFinite(chunkState.totalSize) ||
			chunkState.totalSize <= 0 ||
			!Number.isFinite(chunkState.chunkSize) ||
			chunkState.chunkSize <= 0 ||
			!Number.isFinite(chunkState.totalChunks) ||
			chunkState.totalChunks <= 0
		) {
			const error = createDownloadError(
				ERROR_CODES.INVALID_FILE,
				'Invalid upload state detected',
				true,
				{ uploadId },
				30,
				'Please restart the download.'
			);
			endUpload(uploadId);
			return json({ error }, { status: 400 });
		}
		if (chunkState.totalSize > MAX_FILE_SIZE) {
			await fs.unlink(chunkState.tempFilePath).catch(() => {});
			endUpload(uploadId);
			return json(
				{ error: `File too large: maximum ${MAX_FILE_SIZE} bytes allowed` },
				{ status: 400 }
			);
		}

		const finalizeUpload = async () => {
			let stats: { size: number };
			try {
				stats = await fs.stat(chunkState.tempFilePath);
			} catch (err) {
				console.error('Temp file missing during finalize:', err);
				endUpload(uploadId);
				return json({ error: 'Temporary file missing' }, { status: 500 });
			}

			if (stats.size !== chunkState.totalSize) {
				await fs.unlink(chunkState.tempFilePath).catch(() => {});
				endUpload(uploadId);
				return json({ error: 'File size mismatch' }, { status: 400 });
			}

			if (chunkState.checksum) {
				if (!(await validateFileChecksum(chunkState.tempFilePath, chunkState.checksum))) {
					await fs.unlink(chunkState.tempFilePath).catch(() => {});
					endUpload(uploadId);
					return json({ error: 'Checksum validation failed' }, { status: 400 });
				}
			}

			const uploadData = pendingUploads.get(uploadId);
			if (!uploadData) {
				await fs.unlink(chunkState.tempFilePath).catch(() => {});
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
				totalSize,
				downloadCoverSeperately,
				coverUrl
			} = uploadData;
			if (totalSize && totalSize > MAX_FILE_SIZE) {
				await fs.unlink(chunkState.tempFilePath).catch(() => {});
				endUpload(uploadId);
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

			if (action === 'skip') {
				await fs.unlink(chunkState.tempFilePath).catch(() => {});
				endUpload(uploadId);
				const finalFilename = path.basename(finalPath);
				return json(
					{
						success: true,
						filepath: finalPath,
						filename: finalFilename,
						action,
						message: `File already exists, skipped: ${artistDir}/${albumDir}/${finalFilename}`,
						coverDownloaded: false
					},
					{ status: 201 }
				);
			}

			try {
				await moveFile(chunkState.tempFilePath, finalPath);
			} catch (err: unknown) {
				console.error('File move error:', err);
				const error = err as NodeJS.ErrnoException;
				await fs.unlink(finalPath).catch(() => {});
				if (error.code === 'ENOSPC' || error.message?.includes('disk full')) {
					await fs.unlink(chunkState.tempFilePath).catch(() => {});
					endUpload(uploadId);
					const downloadError = createDownloadError(
						ERROR_CODES.DISK_FULL,
						'Not enough disk space available to finalize the download',
						false,
						{ originalError: error.message, uploadId },
						undefined,
						'Please free up disk space and retry the download.'
					);
					return json({ error: downloadError }, { status: 507 });
				}
				if (error.code === 'EACCES' || error.message?.includes('permission denied')) {
					await fs.unlink(chunkState.tempFilePath).catch(() => {});
					endUpload(uploadId);
					const downloadError = createDownloadError(
						ERROR_CODES.PERMISSION_DENIED,
						'Permission denied when saving the file',
						false,
						{ originalError: error.message, uploadId },
						undefined,
						'Please check file permissions and retry the download.'
					);
					return json({ error: downloadError }, { status: 403 });
				}
				chunkState.timestamp = Date.now();
				const pending = pendingUploads.get(uploadId);
				if (pending) {
					pending.timestamp = Date.now();
				}
				const downloadError = createDownloadError(
					ERROR_CODES.UNKNOWN_ERROR,
					'Failed to move file to final location: ' + (error.message || 'Unknown error'),
					true,
					{ originalError: error.message, uploadId },
					10,
					'Please retry. The upload can continue from the last chunk.'
				);
				return json({ error: downloadError }, { status: 500 });
			}

			if (uploadData.trackMetadata) {
				try {
					await embedMetadataToFile(finalPath, uploadData.trackMetadata);
					console.log('[Server Download] Metadata embedded successfully');
				} catch (metadataError) {
					console.warn(
						'[Server Download] Metadata embedding failed, continuing with raw file:',
						metadataError
					);
				}
			}

			let coverDownloaded = false;
			if (downloadCoverSeperately && coverUrl) {
				coverDownloaded = await downloadCoverToDir(coverUrl, targetDir);
			}

			endUpload(uploadId);

			const finalFilename = path.basename(finalPath);
			let message = `File saved to ${artistDir}/${albumDir}/${finalFilename}`;
			if (action === 'rename') {
				message = `File renamed and saved to ${artistDir}/${albumDir}/${finalFilename}`;
			}
			if (coverDownloaded) {
				message += ' (with cover)';
			}

			return json(
				{
					success: true,
					filepath: finalPath,
					filename: finalFilename,
					action,
					message,
					coverDownloaded
				},
				{ status: 201 }
			);
		};

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
		if (totalChunks !== chunkState.totalChunks) {
			return json(
				{
					error: `Chunk count mismatch: expected ${chunkState.totalChunks}, received ${totalChunks}`
				},
				{ status: 400 }
			);
		}

		if (chunkIndex < chunkState.chunkIndex) {
			chunkState.timestamp = Date.now();
			const pending = pendingUploads.get(uploadId);
			if (pending) {
				pending.timestamp = Date.now();
			}
			if (chunkState.chunkIndex >= chunkState.totalChunks && !chunkState.completed) {
				return await finalizeUpload();
			}
			const progress = (chunkState.chunkIndex / chunkState.totalChunks) * 100;
			return json({
				success: true,
				progress: Math.round(progress),
				uploadedChunks: chunkState.chunkIndex,
				totalChunks: chunkState.totalChunks,
				message: `Chunk ${chunkIndex + 1} already received`
			});
		}

		if (chunkIndex !== chunkState.chunkIndex) {
			return json(
				{
					error: `Out-of-order chunk: expected ${chunkState.chunkIndex}, received ${chunkIndex}`
				},
				{ status: 409 }
			);
		}

		// Read chunk data
		const chunkBuffer = Buffer.from(await request.arrayBuffer());
		if (chunkBuffer.length === 0) {
			return json({ error: 'Empty chunk data' }, { status: 400 });
		}
		if (chunkBuffer.length > MAX_CHUNK_SIZE) {
			return json({ error: `Chunk too large: maximum ${MAX_CHUNK_SIZE} bytes` }, { status: 400 });
		}
		const expectedChunkSize =
			chunkIndex === chunkState.totalChunks - 1
				? chunkState.totalSize - chunkIndex * chunkState.chunkSize
				: chunkState.chunkSize;
		if (expectedChunkSize <= 0) {
			return json({ error: 'Invalid chunk size configuration' }, { status: 400 });
		}
		if (chunkBuffer.length !== expectedChunkSize) {
			return json(
				{
					error: `Chunk size mismatch: expected ${expectedChunkSize} bytes, received ${chunkBuffer.length}`
				},
				{ status: 400 }
			);
		}

		// Append chunk to temp file
		try {
			await retryFs(() => fs.appendFile(chunkState.tempFilePath, chunkBuffer));
		} catch (err: unknown) {
			console.error('Chunk append error:', err);
			const error = err as NodeJS.ErrnoException;
			let downloadError;
			if (error.code === 'ENOSPC' || (error.message && error.message.includes('disk full'))) {
				downloadError = createDownloadError(
					ERROR_CODES.DISK_FULL,
					'Not enough disk space available for chunk',
					false,
					{ originalError: error.message, uploadId },
					undefined,
					'Please free up disk space and restart the download.'
				);
			} else if (
				error.code === 'EACCES' ||
				(error.message && error.message.includes('permission denied'))
			) {
				downloadError = createDownloadError(
					ERROR_CODES.PERMISSION_DENIED,
					'Permission denied when appending chunk',
					false,
					{ originalError: error.message, uploadId },
					undefined,
					'Please check file permissions and restart the download.'
				);
			} else {
				downloadError = createDownloadError(
					ERROR_CODES.UNKNOWN_ERROR,
					'Chunk append failed: ' + (error.message || 'Unknown error'),
					true,
					{ originalError: error.message, uploadId },
					10,
					'Please try the download again.'
				);
			}
			return json({ error: downloadError }, { status: 500 });
		}

		// Update chunk state
		chunkState.chunkIndex = chunkIndex + 1;
		chunkState.timestamp = Date.now();
		const pending = pendingUploads.get(uploadId);
		if (pending) {
			pending.timestamp = Date.now();
		}

		// Check if upload is complete
		if (chunkState.chunkIndex >= chunkState.totalChunks) {
			return await finalizeUpload();
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

		// IMPORTANT: Do NOT call endUpload here for recoverable errors!
		// Calling endUpload deletes the session, causing subsequent retries to get 404 "session expired"
		// Only delete session for non-recoverable errors (disk full, permission denied)
		if (uploadId && !downloadError.recoverable) {
			endUpload(uploadId);
		}
		return json({ error: downloadError }, { status: 500 });
	}
};
