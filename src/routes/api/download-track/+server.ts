import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { AudioQuality } from '$lib/types';
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
	startUpload,
	endUpload,
	cleanupExpiredUploads,
	MAX_FILE_SIZE,
	retryFs
} from './_shared';

// Start the cleanup interval when the module loads
startCleanupInterval();

export const POST: RequestHandler = async ({ request, url }) => {
	let startedUploadId: string | undefined;
	const pathParts = url.pathname.split('/');
	const uploadId = pathParts[pathParts.indexOf('download-track') + 1];
	try {
		if (!uploadId) {
			const body = await request.json();
			if (body.blob) {
				// Direct blob upload
				const blobParts = body.blob.split(',');
				if (blobParts.length !== 2 || !blobParts[1])
					return json({ error: 'Invalid blob format' }, { status: 400 });
				const buffer = Buffer.from(blobParts[1], 'base64');
				if (buffer.length === 0) return json({ error: 'Empty blob' }, { status: 400 });
				if (buffer.length > MAX_FILE_SIZE)
					return json(
						{ error: `File too large: maximum ${MAX_FILE_SIZE} bytes allowed` },
						{ status: 400 }
					);
				// Validate other fields
				if (typeof body.trackId !== 'number' || body.trackId <= 0)
					return json({ error: 'Invalid trackId: must be a positive number' }, { status: 400 });
				const validQualities: AudioQuality[] = ['LOW', 'HIGH', 'LOSSLESS', 'HI_RES_LOSSLESS'];
				if (!body.quality || !validQualities.includes(body.quality))
					return json(
						{ error: 'Invalid quality: must be one of LOW, HIGH, LOSSLESS, HI_RES_LOSSLESS' },
						{ status: 400 }
					);
				if (body.albumTitle !== undefined && typeof body.albumTitle !== 'string')
					return json(
						{ error: 'Invalid albumTitle: must be a string or undefined' },
						{ status: 400 }
					);
				if (body.artistName !== undefined && typeof body.artistName !== 'string')
					return json(
						{ error: 'Invalid artistName: must be a string or undefined' },
						{ status: 400 }
					);
				if (body.trackTitle !== undefined && typeof body.trackTitle !== 'string')
					return json(
						{ error: 'Invalid trackTitle: must be a string or undefined' },
						{ status: 400 }
					);
				if (
					body.conflictResolution !== undefined &&
					!['overwrite', 'skip', 'rename', 'overwrite_if_different'].includes(
						body.conflictResolution
					)
				)
					return json(
						{
							error:
								'Invalid conflictResolution: must be one of overwrite, skip, rename, overwrite_if_different'
						},
						{ status: 400 }
					);
				let ext = 'm4a';
				if (body.quality === 'HI_RES_LOSSLESS' || body.quality === 'LOSSLESS') {
					ext = 'flac';
				}
				const filename = body.trackTitle
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
				try {
					await fs.writeFile(finalPath, buffer);
				} catch (err: any) {
					console.error('Direct blob write error:', err);
					if (err.code === 'ENOSPC')
						return json({ error: 'Not enough disk space' }, { status: 507 });
					if (err.code === 'EACCES') return json({ error: 'Permission denied' }, { status: 403 });
					return json({ error: 'File write failed' }, { status: 500 });
				}
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
				// Input validation
				if (typeof trackId !== 'number' || trackId <= 0)
					return json({ error: 'Invalid trackId: must be a positive number' }, { status: 400 });
				const validQualities: AudioQuality[] = ['LOW', 'HIGH', 'LOSSLESS', 'HI_RES_LOSSLESS'];
				if (!quality || !validQualities.includes(quality))
					return json(
						{ error: 'Invalid quality: must be one of LOW, HIGH, LOSSLESS, HI_RES_LOSSLESS' },
						{ status: 400 }
					);
				if (albumTitle !== undefined && typeof albumTitle !== 'string')
					return json(
						{ error: 'Invalid albumTitle: must be a string or undefined' },
						{ status: 400 }
					);
				if (artistName !== undefined && typeof artistName !== 'string')
					return json(
						{ error: 'Invalid artistName: must be a string or undefined' },
						{ status: 400 }
					);
				if (trackTitle !== undefined && typeof trackTitle !== 'string')
					return json(
						{ error: 'Invalid trackTitle: must be a string or undefined' },
						{ status: 400 }
					);
				if (blobSize !== undefined && (typeof blobSize !== 'number' || blobSize <= 0))
					return json(
						{ error: 'Invalid blobSize: must be a positive number or undefined' },
						{ status: 400 }
					);
				if (useChunks !== undefined && typeof useChunks !== 'boolean')
					return json(
						{ error: 'Invalid useChunks: must be a boolean or undefined' },
						{ status: 400 }
					);
				if (chunkSize !== undefined && (typeof chunkSize !== 'number' || chunkSize <= 0))
					return json(
						{ error: 'Invalid chunkSize: must be a positive number or undefined' },
						{ status: 400 }
					);
				if (checksum !== undefined && typeof checksum !== 'string')
					return json(
						{ error: 'Invalid checksum: must be a string or undefined' },
						{ status: 400 }
					);
				if (
					conflictResolution !== undefined &&
					!['overwrite', 'skip', 'rename', 'overwrite_if_different'].includes(conflictResolution)
				)
					return json(
						{
							error:
								'Invalid conflictResolution: must be one of overwrite, skip, rename, overwrite_if_different'
						},
						{ status: 400 }
					);
				if (blobSize !== undefined && blobSize > MAX_FILE_SIZE)
					return json(
						{ error: `File too large: maximum ${MAX_FILE_SIZE} bytes allowed` },
						{ status: 400 }
					);

				const newUploadId = randomBytes(16).toString('hex');
				cleanupExpiredUploads(); // Aggressive cleanup before starting
				if (!canStartUpload()) return json({ error: 'Too many uploads' }, { status: 429 });
				startUpload(newUploadId);
				startedUploadId = newUploadId;
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
			const filename = trackTitle
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
			try {
				await retryFs(() => fs.writeFile(finalPath, buffer));
			} catch (err: any) {
				console.error('Blob upload write error:', err);
				if (err.code === 'ENOSPC') return json({ error: 'Not enough disk space' }, { status: 507 });
				if (err.code === 'EACCES') return json({ error: 'Permission denied' }, { status: 403 });
				return json({ error: 'File write failed' }, { status: 500 });
			}
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
		if (uploadId) endUpload(uploadId);
		else if (startedUploadId) endUpload(startedUploadId);
		return json({ error: 'Server error' }, { status: 500 });
	}
};
