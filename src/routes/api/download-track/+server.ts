import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { AudioQuality } from '$lib/types';
import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
	pendingUploads,
	chunkUploads,
	startCleanupInterval,
	getTempDir,
	sanitizeDirName,
	ensureDir,
	canStartUpload,
	startUpload,
	endUpload,
	cleanupExpiredUploads,
	MAX_FILE_SIZE,
	MAX_CHUNK_SIZE,
	validateChecksum
} from './_shared';
import { createDownloadOperationLogger, downloadLogger } from '$lib/server/observability';
import { finalizeTrack } from '$lib/server/download/finalizeTrack';

// Start the cleanup interval when the module loads (with await to ensure state is loaded)
const initPromise = startCleanupInterval();

export const POST: RequestHandler = async ({ request, url }) => {
	// Ensure initialization completes before processing requests
	await initPromise;
	
	let startedUploadId: string | undefined;
	const pathParts = url.pathname.split('/');
	const uploadId = pathParts[pathParts.indexOf('download-track') + 1];
	try {
		if (!uploadId) {
			const body = await request.json();
			if (body.blob) {
				const bodyUploadId = typeof body.uploadId === 'string' ? body.uploadId : undefined;
				const pendingUpload = bodyUploadId ? pendingUploads.get(bodyUploadId) : undefined;
				// Direct blob upload
				const blobParts = body.blob.split(',');
				if (blobParts.length !== 2 || !blobParts[1])
					return json({ error: 'Invalid blob format' }, { status: 400 });
				const buffer = Buffer.from(blobParts[1], 'base64');
				if (buffer.length === 0) return json({ error: 'Empty blob' }, { status: 400 });
				if (MAX_FILE_SIZE > 0 && buffer.length > MAX_FILE_SIZE)
					return json(
						{ error: `File too large: maximum ${MAX_FILE_SIZE} bytes allowed` },
						{ status: 400 }
					);
				if (pendingUpload?.totalSize && buffer.length !== pendingUpload.totalSize) {
					return json({ error: 'File size mismatch' }, { status: 400 });
				}
				if (pendingUpload?.checksum && !(await validateChecksum(buffer, pendingUpload.checksum))) {
					return json({ error: 'Checksum validation failed' }, { status: 400 });
				}
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
				// Validate track metadata for embedding
				if (
					body.trackMetadata !== undefined &&
					(typeof body.trackMetadata !== 'object' || body.trackMetadata === null)
				)
					return json(
						{ error: 'Invalid trackMetadata: must be an object or undefined' },
						{ status: 400 }
					);
				const trackMetadata = body.trackMetadata ?? pendingUpload?.trackMetadata;
				const finalizeResult = await finalizeTrack({
					trackId: body.trackId,
					quality: body.quality,
					albumTitle: body.albumTitle,
					artistName: body.artistName,
					trackTitle: body.trackTitle,
					trackLookup: trackMetadata,
					buffer,
					conflictResolution: body.conflictResolution || pendingUpload?.conflictResolution || 'overwrite',
					checksum: pendingUpload?.checksum,
					detectedMimeType: body.detectedMimeType ?? pendingUpload?.detectedMimeType,
					downloadCoverSeperately: body.downloadCoverSeperately ?? pendingUpload?.downloadCoverSeperately,
					coverUrl: body.coverUrl ?? pendingUpload?.coverUrl
				});

				if (bodyUploadId) {
					endUpload(bodyUploadId);
				}

				if (!finalizeResult.success) {
					return json({ error: finalizeResult.error }, { status: finalizeResult.status });
				}

				const artistDir = sanitizeDirName(body.artistName || 'Unknown Artist');
				const albumDir = sanitizeDirName(body.albumTitle || 'Unknown Album');
				let message = `File saved to ${artistDir}/${albumDir}/${finalizeResult.filename}`;
				if (finalizeResult.coverDownloaded) {
					message += ' (with cover)';
				}
				if (finalizeResult.action === 'rename') {
					message = `File renamed and saved to ${artistDir}/${albumDir}/${finalizeResult.filename}`;
				}

				return json(
					{
						success: true,
						filepath: finalizeResult.filepath,
						filename: finalizeResult.filename,
						action: finalizeResult.action,
						message,
						coverDownloaded: finalizeResult.coverDownloaded
					},
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
					conflictResolution,
					downloadCoverSeperately,
					coverUrl,
					trackMetadata,
					detectedMimeType
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
				if (useChunks && chunkSize === undefined) {
					return json(
						{ error: 'chunkSize is required when useChunks is true' },
						{ status: 400 }
					);
				}
				if (chunkSize !== undefined && chunkSize > MAX_CHUNK_SIZE)
					return json(
						{ error: `Invalid chunkSize: maximum ${MAX_CHUNK_SIZE} bytes` },
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
				if (
					downloadCoverSeperately !== undefined &&
					typeof downloadCoverSeperately !== 'boolean'
				)
					return json(
						{ error: 'Invalid downloadCoverSeperately: must be a boolean or undefined' },
						{ status: 400 }
					);
				if (coverUrl !== undefined && typeof coverUrl !== 'string')
					return json({ error: 'Invalid coverUrl: must be a string or undefined' }, { status: 400 });
				if (
					trackMetadata !== undefined &&
					(typeof trackMetadata !== 'object' || trackMetadata === null)
				)
					return json(
						{ error: 'Invalid trackMetadata: must be an object or undefined' },
						{ status: 400 }
					);
				if (MAX_FILE_SIZE > 0 && blobSize !== undefined && blobSize > MAX_FILE_SIZE)
					return json(
						{ error: `File too large (${(blobSize / 1024 / 1024).toFixed(2)}MB) for track "${body.trackTitle || 'Unknown'}" by ${body.artistName || 'Unknown'}: maximum ${MAX_FILE_SIZE} bytes allowed` },
						{ status: 400 }
					);
				if (useChunks && blobSize === undefined) {
					return json(
						{ error: 'blobSize is required when useChunks is true' },
						{ status: 400 }
					);
				}

				const newUploadId = randomBytes(16).toString('hex');
				await cleanupExpiredUploads(); // Aggressive cleanup before starting
				if (!canStartUpload()) {
					downloadLogger.warn('Upload rejected: too many concurrent uploads', {
						phase: 'init',
						trackId
					});
					return json({ error: 'Too many uploads' }, { status: 429 });
				}
				if (!startUpload(newUploadId)) {
					downloadLogger.warn('Upload rejected: failed to start', {
						phase: 'init',
						uploadId: newUploadId,
						trackId
					});
					return json({ error: 'Too many uploads' }, { status: 429 });
				}
				startedUploadId = newUploadId;

				// Create operation logger for this upload
				const opLogger = createDownloadOperationLogger(newUploadId, {
					trackId,
					quality,
					artistName,
					albumTitle,
					trackTitle,
					phase: 'init'
				});
				opLogger.info('Upload session created', {
					totalSize: blobSize,
					useChunks,
					chunkSize
				});

				pendingUploads.set(newUploadId, {
					trackId,
					quality,
					albumTitle,
					artistName,
					trackTitle,
					trackMetadata,
					detectedMimeType: typeof detectedMimeType === 'string' ? detectedMimeType : undefined,
					downloadCoverSeperately,
					coverUrl,
					timestamp: Date.now(),
					totalSize: blobSize,
					checksum,
					conflictResolution
				});
				const response: {
					success: boolean;
					uploadId: string;
					message: string;
					chunked?: boolean;
					totalChunks?: number;
					chunkSize?: number;
				} = {
					success: true,
					uploadId: newUploadId,
					message: 'Metadata registered'
				};
				if (useChunks && blobSize) {
					const totalChunks = Math.ceil(blobSize / chunkSize);
					if (!Number.isFinite(totalChunks) || totalChunks <= 0) {
						return json({ error: 'Invalid chunk configuration' }, { status: 400 });
					}
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
			const buffer = Buffer.from(arrayBuffer);
			if (MAX_FILE_SIZE > 0 && buffer.length > MAX_FILE_SIZE) {
				return json(
					{ error: `File too large (${(buffer.length / 1024 / 1024).toFixed(2)}MB) for track "${trackTitle || 'Unknown'}" by ${artistName || 'Unknown'}: maximum ${MAX_FILE_SIZE} bytes allowed` },
					{ status: 400 }
				);
			}
			if (uploadData.totalSize && buffer.length !== uploadData.totalSize) {
				return json({ error: 'File size mismatch' }, { status: 400 });
			}
			if (uploadData.checksum && !(await validateChecksum(buffer, uploadData.checksum))) {
				return json({ error: 'Checksum validation failed' }, { status: 400 });
			}
			const finalizeResult = await finalizeTrack({
				trackId,
				quality,
				albumTitle,
				artistName,
				trackTitle,
				trackLookup: uploadData.trackMetadata,
				buffer,
				conflictResolution,
				checksum: uploadData.checksum,
				detectedMimeType: uploadData.detectedMimeType,
				downloadCoverSeperately: uploadData.downloadCoverSeperately,
				coverUrl: uploadData.coverUrl
			});

			if (!finalizeResult.success) {
				if (!finalizeResult.error.recoverable) {
					endUpload(uploadId);
				}
				return json({ error: finalizeResult.error }, { status: finalizeResult.status });
			}

			endUpload(uploadId);
			const artistDir = sanitizeDirName(artistName || 'Unknown Artist');
			const albumDir = sanitizeDirName(albumTitle || 'Unknown Album');
			let message = `File saved to ${artistDir}/${albumDir}/${finalizeResult.filename}`;
			if (finalizeResult.action === 'rename') message = `File renamed`;
			return json(
				{
					success: true,
					filepath: finalizeResult.filepath,
					filename: finalizeResult.filename,
					action: finalizeResult.action,
					message
				},
				{ status: 201 }
			);
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		downloadLogger.error('Download error', {
			uploadId: uploadId || startedUploadId,
			phase: 'error',
			error: errorMsg
		});
		if (uploadId) endUpload(uploadId);
		else if (startedUploadId) endUpload(startedUploadId);
		return json({ error: 'Server error' }, { status: 500 });
	}
};
