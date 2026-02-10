import * as fs from 'fs/promises';
import * as path from 'path';
import type { AudioQuality, TrackLookup } from '$lib/types';
import { embedMetadataToFile } from '$lib/server/metadataEmbedder';
import {
	buildServerFilename,
	sanitizeDirName,
	ensureDir,
	getDownloadDir,
	getTempDir,
	resolveFileConflict,
	detectAudioFormatFromBuffer,
	detectAudioFormatFromFile,
	getServerExtension,
	downloadCoverToDir,
	moveFile,
	retryFs,
	readFileSample,
	generateChecksum,
	createDownloadError,
	ERROR_CODES,
	type ConflictResolution,
	type DownloadError
} from '../../../routes/api/download-track/_shared';

export interface FinalizeTrackParams {
	trackId: number;
	quality: AudioQuality;
	albumTitle?: string;
	artistName?: string;
	trackTitle?: string;
	trackNumber?: number;
	trackLookup?: TrackLookup;
	buffer?: Buffer | ArrayBuffer;
	tempFilePath?: string;
	conflictResolution?: ConflictResolution;
	checksum?: string;
	detectedMimeType?: string;
	downloadCoverSeperately?: boolean;
	coverUrl?: string;
}

export type FinalizeTrackResult =
	| {
			success: true;
			filepath: string;
			filename: string;
			action: 'overwrite' | 'skip' | 'rename';
			coverDownloaded: boolean;
			metadataEmbedded: boolean;
	  }
	| {
			success: false;
			error: DownloadError;
			status: number;
	  };

const toDownloadError = (
	error: NodeJS.ErrnoException,
	message: string,
	recoverable: boolean,
	code: keyof typeof ERROR_CODES,
	status: number,
	suggestion?: string
): { error: DownloadError; status: number } => ({
	error: createDownloadError(
		ERROR_CODES[code],
		message,
		recoverable,
		{ originalError: error.message, errorCode: error.code },
		recoverable ? 10 : undefined,
		suggestion
	),
	status
});

const mapFsError = (error: NodeJS.ErrnoException): { error: DownloadError; status: number } => {
	if (error.code === 'ENOSPC' || error.message?.includes('disk full')) {
		return toDownloadError(
			error,
			'Not enough disk space available to finalize the download',
			false,
			'DISK_FULL',
			507,
			'Please free up disk space and retry the download.'
		);
	}
	if (error.code === 'EACCES' || error.message?.includes('permission denied')) {
		return toDownloadError(
			error,
			'Permission denied when saving the file',
			false,
			'PERMISSION_DENIED',
			403,
			'Please check file permissions and retry the download.'
		);
	}
	return toDownloadError(
		error,
		'Failed to finalize download',
		true,
		'UNKNOWN_ERROR',
		500,
		'Please retry the download.'
	);
};

export async function finalizeTrack(params: FinalizeTrackParams): Promise<FinalizeTrackResult> {
	const {
		trackId,
		quality,
		albumTitle,
		artistName,
		trackTitle,
		trackNumber,
		trackLookup,
		buffer,
		tempFilePath,
		conflictResolution = 'overwrite_if_different',
		checksum,
		detectedMimeType,
		downloadCoverSeperately = false,
		coverUrl
	} = params;

	let workingBuffer: Buffer | undefined;
	if (buffer) {
		if (buffer instanceof Buffer) {
			workingBuffer = buffer;
		} else if (buffer instanceof ArrayBuffer) {
			workingBuffer = Buffer.from(buffer);
		} else {
			workingBuffer = Buffer.from(new Uint8Array(buffer));
		}
	}

	let detectedFormat: { extension: string } | null = null;
	try {
		if (workingBuffer) {
			detectedFormat = detectAudioFormatFromBuffer(workingBuffer);
		} else if (tempFilePath) {
			detectedFormat = await detectAudioFormatFromFile(tempFilePath);
		}
	} catch {
		detectedFormat = null;
	}

	const ext = getServerExtension(quality, detectedFormat, detectedMimeType);
	const filename = buildServerFilename(
		artistName,
		trackTitle,
		trackId,
		ext,
		trackLookup,
		trackNumber
	);

	const baseDir = getDownloadDir();
	const artistDir = sanitizeDirName(artistName || 'Unknown Artist');
	const albumDir = sanitizeDirName(albumTitle || 'Unknown Album');
	const targetDir = path.join(baseDir, artistDir, albumDir);
	await ensureDir(targetDir);
	const initialFilepath = path.join(targetDir, filename);

	let newFileSize = 0;
	if (workingBuffer) {
		newFileSize = workingBuffer.length;
	} else if (tempFilePath) {
		const stats = await fs.stat(tempFilePath);
		newFileSize = stats.size;
	} else {
		return {
			success: false,
			error: createDownloadError(
				ERROR_CODES.INVALID_FILE,
				'No audio payload available to finalize',
				false
			),
			status: 400
		};
	}

	let resolvedChecksum = checksum;
	if (!resolvedChecksum && conflictResolution === 'overwrite_if_different') {
		try {
			if (workingBuffer) {
				resolvedChecksum = await generateChecksum(workingBuffer);
			} else if (tempFilePath) {
				const sample = await readFileSample(tempFilePath);
				resolvedChecksum = await generateChecksum(sample);
			}
		} catch {
			resolvedChecksum = undefined;
		}
	}

	const { finalPath, action } = await resolveFileConflict(
		initialFilepath,
		conflictResolution,
		newFileSize,
		resolvedChecksum
	);

	if (action === 'skip') {
		if (tempFilePath) {
			await fs.unlink(tempFilePath).catch(() => {});
		}
		return {
			success: true,
			filepath: finalPath,
			filename: path.basename(finalPath),
			action,
			coverDownloaded: false,
			metadataEmbedded: false
		};
	}

	let workingPath = tempFilePath;
	if (!workingPath) {
		const tempDir = getTempDir();
		await ensureDir(tempDir);
		const tempName = `finalize-${trackId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`;
		workingPath = path.join(tempDir, tempName);
		try {
			await retryFs(() => fs.writeFile(workingPath as string, workingBuffer as Buffer));
		} catch (err) {
			const mapped = mapFsError(err as NodeJS.ErrnoException);
			return { success: false, ...mapped };
		}
	}

	try {
		await moveFile(workingPath, finalPath);
	} catch (err) {
		const mapped = mapFsError(err as NodeJS.ErrnoException);
		return { success: false, ...mapped };
	}

	let finalOutputPath = finalPath;
	let metadataEmbedded = false;
	if (trackLookup) {
		try {
			finalOutputPath = await embedMetadataToFile(finalOutputPath, trackLookup);
			metadataEmbedded = true;
		} catch {
			metadataEmbedded = false;
		}
	}

	let coverDownloaded = false;
	let resolvedCoverUrl = coverUrl;
	if (!resolvedCoverUrl && trackLookup?.track?.album?.cover) {
		resolvedCoverUrl = `https://resources.tidal.com/images/${trackLookup.track.album.cover.replace(/-/g, '/')}/1280x1280.jpg`;
	}
	if (downloadCoverSeperately && resolvedCoverUrl) {
		coverDownloaded = await downloadCoverToDir(resolvedCoverUrl, targetDir);
	}

	return {
		success: true,
		filepath: finalOutputPath,
		filename: path.basename(finalOutputPath),
		action,
		coverDownloaded,
		metadataEmbedded
	};
}
