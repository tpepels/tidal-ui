import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pendingUploads, getDownloadDir, sanitizePath } from '../_shared';

const execFileAsync = promisify(execFile);

// Ensure directory exists
const ensureDir = async (dirPath: string): Promise<void> => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (err) {
        console.error(`Failed to create directory ${dirPath}:`, err);
        throw err;
    }
};

// Embed metadata into audio file using ffmpeg
const embedMetadata = async (
    inputPath: string,
    outputPath: string,
    metadata: {
        title?: string;
        artist?: string;
        album?: string;
        trackId?: number;
    }
): Promise<void> => {
    const args: string[] = ['-i', inputPath];

    // Add metadata if available
    if (metadata.title) {
        args.push('-metadata', `title=${metadata.title}`);
    }
    if (metadata.artist) {
        args.push('-metadata', `artist=${metadata.artist}`);
    }
    if (metadata.album) {
        args.push('-metadata', `album=${metadata.album}`);
    }

    // Copy codec without re-encoding (fast)
    args.push('-c', 'copy');
    args.push(outputPath);

    console.log(`[Metadata Embed] Running ffmpeg with args:`, args);

    try {
        await execFileAsync('ffmpeg', args, {
            timeout: 60000 // 60 second timeout
        });
        console.log(`[Metadata Embed] Successfully embedded metadata`);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Metadata Embed] Failed:`, errorMsg);
        throw new Error(`Failed to embed metadata: ${errorMsg}`);
    }
};

export const POST: RequestHandler = async ({ request, params }) => {
    try {
        const uploadId = params.uploadId;

        if (!uploadId) {
            return json(
                { error: 'uploadId is required' },
                { status: 400 }
            );
        }

        console.log(`[Server Download] [${uploadId}] Blob upload received`);

        // Phase 2: Blob POST (with uploadId in path)
        const uploadData = pendingUploads.get(uploadId);
        if (!uploadData) {
            console.error(`[Server Download] [${uploadId}] Upload session not found`);
            console.log(`[Server Download] Available upload IDs:`, Array.from(pendingUploads.keys()));
            return json(
                { error: 'Upload session not found or expired' },
                { status: 404 }
            );
        }

        // Read the binary blob from the request body
        const arrayBuffer = await request.arrayBuffer();
        if (arrayBuffer.byteLength === 0) {
            console.error(`[Server Download] [${uploadId}] Empty blob received`);
            return json({ error: 'Empty blob' }, { status: 400 });
        }

        const { trackId, quality, albumTitle, artistName, trackTitle } = uploadData;

        console.log(`[Server Download] [${uploadId}] Processing blob: ${trackTitle} (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);

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

        // Write blob to temporary file first
        const tempFilePath = path.join(targetDir, `.${filename}.tmp`);
        const buffer = Buffer.from(arrayBuffer);
        await fs.writeFile(tempFilePath, buffer);

        try {
            // Embed metadata using ffmpeg
            console.log(`[Server Download] [${uploadId}] Embedding metadata...`);
            await embedMetadata(tempFilePath, filepath, {
                title: trackTitle,
                artist: artistName,
                album: albumTitle,
                trackId
            });

            // Clean up temporary file
            await fs.unlink(tempFilePath).catch(() => {
                // Ignore if temp file can't be deleted
            });
        } catch (embedError) {
            console.warn(`[Server Download] [${uploadId}] Metadata embedding failed, saving without metadata:`, embedError);
            // If metadata embedding fails, just copy the temp file to final location
            try {
                await fs.rename(tempFilePath, filepath);
            } catch (renameError) {
                // If rename fails, copy instead
                await fs.copyFile(tempFilePath, filepath);
                await fs.unlink(tempFilePath).catch(() => {
                    // Ignore if can't delete
                });
            }
        }

        // Clean up the upload session
        pendingUploads.delete(uploadId);

        const sizeInMB = (buffer.length / 1024 / 1024).toFixed(2);
        console.log(`[Server Download] [${uploadId}] ✓ Saved to: ${filepath} (${sizeInMB} MB)`);

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
        console.error(`[Server Download] Error: ${errorMsg}`, error);
        return json({ error: 'Download failed: ' + errorMsg }, { status: 500 });
    }
};
