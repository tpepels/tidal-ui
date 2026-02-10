import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
	pendingUploads,
	sanitizeDirName,
	MAX_FILE_SIZE,
	validateChecksum,
	endUpload
} from '../_shared';
import { finalizeTrack } from '$lib/server/download/finalizeTrack';

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

		const finalizeResult = await finalizeTrack({
			trackId,
			quality,
			albumTitle,
			artistName,
			trackTitle,
			trackLookup: uploadData.trackMetadata,
			buffer,
			conflictResolution: conflictResolution || 'overwrite_if_different',
			checksum,
			detectedMimeType: uploadData.detectedMimeType,
			downloadCoverSeperately,
			coverUrl
		});

		if (!finalizeResult.success) {
			if (!finalizeResult.error.recoverable) {
				endUpload(uploadId);
			}
			return json({ error: finalizeResult.error }, { status: finalizeResult.status });
		}

		// Clean up the upload session
		endUpload(uploadId);

		const artistDir = sanitizeDirName(artistName || 'Unknown Artist');
		const albumDir = sanitizeDirName(albumTitle || 'Unknown Album');
		const message =
			finalizeResult.action === 'rename'
				? `File renamed and saved to ${artistDir}/${albumDir}/${finalizeResult.filename}`
				: `File saved to ${artistDir}/${albumDir}/${finalizeResult.filename}`
					+ (finalizeResult.coverDownloaded ? ' (with cover)' : '');

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
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[Server Download] Error: ${errorMsg}`, error);
		if (params.uploadId) {
			endUpload(params.uploadId);
		}
		return json({ error: 'Download failed: ' + errorMsg }, { status: 500 });
	}
};
