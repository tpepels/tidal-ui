import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AudioQuality } from '$lib/types';
import {
	pendingUploads,
	chunkUploads,
	activeUploads,
	MAX_CONCURRENT_UPLOADS,
	startCleanupInterval,
	getDownloadDir,
	getTempDir,
	sanitizePath,
	generateChecksum,
	validateChecksum,
	ensureDir,
	resolveFileConflict,
	createDownloadError,
	ERROR_CODES,
	canStartUpload,
	startUpload,
	type ConflictResolution,
	type DownloadError
} from './_shared';

// Start the cleanup interval when the module loads
startCleanupInterval();

// ensureDir is now imported from _shared

export const POST: RequestHandler = async ({ request, url }) => {
	try {
		// Check if this is a blob upload (URL contains uploadId)
		const pathParts = url.pathname.split('/');
		const uploadIdIndex = pathParts.indexOf('download-track') + 1;
		const uploadId = uploadIdIndex < pathParts.length ? pathParts[uploadIdIndex] : null;

		// Phase 1: Metadata POST (no uploadId in path)
		if (!uploadId) {
			const body = await request.json();
			const {
				trackId,
				quality,
				albumTitle,
				artistName,
				trackTitle,
				blobSize,
				useChunks = false,
				chunkSize = 1024 * 1024, // 1MB default
				checksum,
				conflictResolution = 'overwrite'
			} = body as {
				trackId: number;
				quality: AudioQuality;
				albumTitle?: string;
				artistName?: string;
				trackTitle?: string;
				blobSize?: number;
				useChunks?: boolean;
				chunkSize?: number;
				checksum?: string;
				conflictResolution?: ConflictResolution;
			};

			if (!trackId || !quality) {
				const error = createDownloadError(
					ERROR_CODES.INVALID_FILE,
					'Missing required fields: trackId, quality',
					false,
					{ provided: { trackId, quality } },
					undefined,
					'Please ensure you have selected a valid track to download.'
				);
				return json({ error }, { status: 400 });
			}

			// Generate a unique upload ID
			const newUploadId = randomBytes(16).toString('hex');

			// Check upload limits
			if (!canStartUpload()) {
				const error = createDownloadError(
					ERROR_CODES.RATE_LIMITED,
					'Too many concurrent uploads',
					true,
					{
						activeUploads: Array.from(activeUploads),
						maxConcurrent: MAX_CONCURRENT_UPLOADS
					},
					30,
					`Maximum ${MAX_CONCURRENT_UPLOADS} concurrent uploads allowed. Please wait for other downloads to complete.`
				);
				return json({ error }, { status: 429 });
			}

			// Start the upload
			if (!startUpload(newUploadId)) {
				const error = createDownloadError(
					ERROR_CODES.RATE_LIMITED,
					'Failed to start upload - queue full',
					true,
					{ maxConcurrent: MAX_CONCURRENT_UPLOADS },
					10,
					'The upload queue is full. Please try again in a moment.'
				);
				return json({ error }, { status: 429 });
			}

			// Store metadata for the next phase
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
				message: 'Metadata registered. Send blob to /api/download-track/' + newUploadId
			};

			// If chunked upload requested, initialize chunk state
			if (useChunks && blobSize) {
				const totalChunks = Math.ceil(blobSize / chunkSize);
				const tempDir = getTempDir();
				await ensureDir(tempDir);
				const tempFilePath = path.join(tempDir, `${newUploadId}.tmp`);

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

				// Initialize empty temp file
				await fs.writeFile(tempFilePath, Buffer.alloc(0));

				response.chunked = true;
				response.totalChunks = totalChunks;
				response.chunkSize = chunkSize;
				response.message = `Metadata registered. Send ${totalChunks} chunks to /api/download-track/${newUploadId}/chunk`;
			}

			return json(response, { status: 201 });
		}

		// Phase 2: Blob POST (with uploadId in path)
		const uploadData = pendingUploads.get(uploadId);
		if (!uploadData) {
			const error = createDownloadError(
				ERROR_CODES.SESSION_EXPIRED,
				'Upload session not found or expired',
				true,
				{ uploadId },
				30,
				'Please try starting the download again. Upload sessions expire after 5 minutes.'
			);
			return json({ error }, { status: 404 });
		}

		// Read the binary blob from the request body
		const arrayBuffer = await request.arrayBuffer();
		if (arrayBuffer.byteLength === 0) {
			const error = createDownloadError(
				ERROR_CODES.INVALID_FILE,
				'Received empty file data',
				true,
				{ uploadId },
				5,
				'The file appears to be empty. Please try downloading again.'
			);
			return json({ error }, { status: 400 });
		}

		const { trackId, quality, albumTitle, artistName, trackTitle, totalSize, checksum } =
			uploadData;

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
		const initialFilepath = path.join(targetDir, filename);

		// Write blob directly to file
		// Note: Metadata is already embedded client-side by losslessAPI.fetchTrackBlob()
		const buffer = Buffer.from(arrayBuffer);

		// Handle file conflicts
		const { finalPath, action } = await resolveFileConflict(
			initialFilepath,
			uploadData.conflictResolution,
			buffer.length,
			uploadData.checksum
		);
		await fs.writeFile(finalPath, buffer);

		// Clean up the upload session
		pendingUploads.delete(uploadId);
		activeUploads.delete(uploadId);

		const finalFilename = path.basename(finalPath);
		const sizeInMB = (buffer.length / 1024 / 1024).toFixed(2);

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
				message,
				queueInfo: {
					activeUploads: activeUploads.size,
					maxConcurrent: MAX_CONCURRENT_UPLOADS
				}
			},
			{ status: 201 }
		);
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[Server Download] Error:', errorMsg);

		// Categorize the error
		let downloadError: DownloadError;
		if (errorMsg.includes('ENOSPC') || errorMsg.includes('disk full')) {
			downloadError = createDownloadError(
				ERROR_CODES.DISK_FULL,
				'Not enough disk space available',
				false,
				{ originalError: errorMsg },
				undefined,
				'Please free up disk space and try again.'
			);
		} else if (errorMsg.includes('EACCES') || errorMsg.includes('permission denied')) {
			downloadError = createDownloadError(
				ERROR_CODES.PERMISSION_DENIED,
				'Permission denied when saving file',
				false,
				{ originalError: errorMsg },
				undefined,
				'Please check file permissions and try again.'
			);
		} else {
			downloadError = createDownloadError(
				ERROR_CODES.UNKNOWN_ERROR,
				'Download failed: ' + errorMsg,
				true,
				{ originalError: errorMsg },
				10,
				'Please try the download again. If the problem persists, contact support.'
			);
		}

		return json({ error: downloadError }, { status: 500 });
	}
};
