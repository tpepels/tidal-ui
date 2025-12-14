import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AudioQuality } from '$lib/types';
import { pendingUploads, startCleanupInterval, getDownloadDir, sanitizePath } from './_shared';

// Start the cleanup interval when the module loads
startCleanupInterval();

// Ensure directory exists
const ensureDir = async (dirPath: string): Promise<void> => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (err) {
        console.error(`Failed to create directory ${dirPath}:`, err);
        throw err;
    }
};

export const POST: RequestHandler = async ({ request, url }) => {
    try {
        // Check if this is a blob upload (URL contains uploadId)
        const pathParts = url.pathname.split('/');
        const uploadIdIndex = pathParts.indexOf('download-track') + 1;
        const uploadId = uploadIdIndex < pathParts.length ? pathParts[uploadIdIndex] : null;

        // Phase 1: Metadata POST (no uploadId in path)
        if (!uploadId) {
            const body = await request.json();
            const { trackId, quality, albumTitle, artistName, trackTitle } = body as {
                trackId: number;
                quality: AudioQuality;
                albumTitle?: string;
                artistName?: string;
                trackTitle?: string;
            };

            if (!trackId || !quality) {
                return json(
                    { error: 'Missing required fields: trackId, quality' },
                    { status: 400 }
                );
            }

            // Generate a unique upload ID
            const newUploadId = randomBytes(16).toString('hex');

            // Store metadata for the next phase
            pendingUploads.set(newUploadId, {
                trackId,
                quality,
                albumTitle,
                artistName,
                trackTitle,
                timestamp: Date.now()
            });

            console.log(`[Server Download] Metadata received, uploadId: ${newUploadId}`);

            return json(
                {
                    success: true,
                    uploadId: newUploadId,
                    message: 'Metadata registered. Send blob to /api/download-track/' + newUploadId
                },
                { status: 201 }
            );
        }

        // Phase 2: Blob POST (with uploadId in path)
        const uploadData = pendingUploads.get(uploadId);
        if (!uploadData) {
            return json(
                { error: 'Upload session not found or expired' },
                { status: 404 }
            );
        }

        // Read the binary blob from the request body
        const arrayBuffer = await request.arrayBuffer();
        if (arrayBuffer.byteLength === 0) {
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

        // Write blob to file
        const buffer = Buffer.from(arrayBuffer);
        await fs.writeFile(filepath, buffer);

        // Clean up the upload session
        pendingUploads.delete(uploadId);

        const sizeInMB = (buffer.length / 1024 / 1024).toFixed(2);
        console.log(`[Server Download] ✓ Saved to: ${filepath} (${sizeInMB} MB)`);

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
        console.error('[Server Download] Error:', errorMsg);
        return json({ error: 'Download failed: ' + errorMsg }, { status: 500 });
    }
};
