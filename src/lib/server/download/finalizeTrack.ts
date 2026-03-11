import * as fs from 'fs/promises';
import * as path from 'path';
import type { Dirent } from 'node:fs';
import type { AudioQuality, TrackLookup } from '$lib/types';
import {
	embedMetadataToFile,
	type MetadataOverrides,
	type MusicBrainzLookupSummary
} from '$lib/server/metadataEmbedder';
import { validateAudioFileIntegrity } from '$lib/server/download/audioIntegrity';
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
	targetArtistDir?: string;
	targetAlbumDir?: string;
	targetFilenameHint?: string;
	requireExistingTargetDir?: boolean;
	trackTitle?: string;
	trackNumber?: number;
	outputBaseDir?: string;
	trackLookup?: TrackLookup;
	buffer?: Buffer | ArrayBuffer;
	tempFilePath?: string;
	conflictResolution?: ConflictResolution;
	checksum?: string;
	detectedMimeType?: string;
	downloadCoverSeperately?: boolean;
	coverUrl?: string;
	experimentalMusicBrainzTagging?: boolean;
	strictMusicBrainzMatching?: boolean;
}

export type FinalizeTrackResult =
	| {
			success: true;
			filepath: string;
			filename: string;
			action: 'overwrite' | 'skip' | 'rename';
			coverDownloaded: boolean;
			metadataEmbedded: boolean;
			musicBrainz?: MusicBrainzLookupSummary;
	  }
	| {
			success: false;
			error: DownloadError;
			status: number;
	  };

function logMusicBrainzFinalizeSummary(
	trackId: number,
	summary: MusicBrainzLookupSummary | undefined,
	context: 'skip' | 'finalize'
): void {
	if (!summary?.enabled) {
		return;
	}

	const mode = summary.strictMatch ? 'strict ISRC' : 'flex';
	const phase = context === 'skip' ? 'skip' : 'finalize';
	if (!summary.lookupAttempted) {
		console.warn(
			`[MusicBrainz] Track ${trackId} (${phase}, ${mode}): lookup enabled but not attempted.`
		);
		return;
	}
	if (summary.tagsApplied > 0) {
		console.log(
			`[MusicBrainz] Track ${trackId} (${phase}, ${mode}): applied ${summary.tagsApplied} tag(s).`
		);
		return;
	}
	console.log(`[MusicBrainz] Track ${trackId} (${phase}, ${mode}): lookup completed with no tags.`);
}

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

function sanitizeOverrideDirComponent(input: string | undefined): string | null {
	if (typeof input !== 'string') return null;
	const trimmed = input.trim();
	if (!trimmed || trimmed === '.' || trimmed === '..') {
		return null;
	}
	if (trimmed.includes('/') || trimmed.includes('\\')) {
		return null;
	}
	return trimmed;
}

function sanitizeTargetFilenameHint(input: string | undefined): string | null {
	if (typeof input !== 'string') return null;
	const trimmed = input.trim();
	if (!trimmed || trimmed === '.' || trimmed === '..') {
		return null;
	}
	if (path.basename(trimmed) !== trimmed) {
		return null;
	}
	return trimmed;
}

const AUDIO_FILE_EXTENSIONS = new Set([
	'.flac',
	'.m4a',
	'.mp4',
	'.mp3',
	'.aac',
	'.wav',
	'.ogg',
	'.opus'
]);
const DISC_TRACK_FILENAME_PREFIX_RE = /^\d{1,2}\s*[-_]\s*\d{1,2}\s*(?:-|\.|_)\s*/i;
const TRACK_FILENAME_PREFIX_RE = /^\d{1,3}\s*(?:-|\.|_)\s*/i;

function normalizeFilenameMatchKey(value: string | undefined): string {
	return (value ?? '')
		.toLowerCase()
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripTrackPrefixFromStem(stem: string): string {
	return stem
		.replace(DISC_TRACK_FILENAME_PREFIX_RE, '')
		.replace(TRACK_FILENAME_PREFIX_RE, '')
		.trim();
}

function parseTrackNumberFromStem(stem: string): number | undefined {
	const discTrackMatch = /^(\d{1,2})\s*[-_]\s*(\d{1,2})\s*(?:-|\.|_)\s*/.exec(stem);
	if (discTrackMatch?.[2]) {
		const parsed = Number.parseInt(discTrackMatch[2], 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
	}
	const trackOnlyMatch = /^(\d{1,3})\s*(?:-|\.|_)\s*/.exec(stem);
	if (trackOnlyMatch?.[1]) {
		const parsed = Number.parseInt(trackOnlyMatch[1], 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
	}
	return undefined;
}

function scoreFilenameCandidate(input: {
	filename: string;
	titleKey: string;
	expectedTrackNo?: number;
}): number {
	const stem = path.parse(input.filename).name.trim();
	const candidateTrackNo = parseTrackNumberFromStem(stem);
	const candidateTitleKey = normalizeFilenameMatchKey(stripTrackPrefixFromStem(stem));
	const hasTitle = input.titleKey.length > 0;

	if (input.expectedTrackNo !== undefined && candidateTrackNo !== undefined) {
		if (candidateTrackNo !== input.expectedTrackNo) {
			return 0;
		}
	}

	let score = 0;
	if (input.expectedTrackNo !== undefined && candidateTrackNo === input.expectedTrackNo) {
		score += 100;
	}
	if (hasTitle) {
		if (!candidateTitleKey) {
			return 0;
		}
		if (candidateTitleKey === input.titleKey) {
			score += 80;
		} else if (
			candidateTitleKey.includes(input.titleKey) ||
			input.titleKey.includes(candidateTitleKey)
		) {
			score += 40;
		} else {
			return 0;
		}
	}

	return score;
}

async function findExistingFilenameHint(params: {
	targetDir: string;
	trackTitle?: string;
	trackNumber?: number;
	expectedExtension: string;
}): Promise<string | null> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(params.targetDir, { withFileTypes: true });
	} catch {
		return null;
	}

	const titleKey = normalizeFilenameMatchKey(params.trackTitle);
	const numericTrackNumber = Number(params.trackNumber);
	const expectedTrackNo =
		Number.isFinite(numericTrackNumber) && numericTrackNumber > 0
			? Math.trunc(numericTrackNumber)
			: undefined;
	if (!titleKey && expectedTrackNo === undefined) {
		return null;
	}

	const extension = params.expectedExtension.startsWith('.')
		? params.expectedExtension.toLowerCase()
		: `.${params.expectedExtension.toLowerCase()}`;
	const scored: Array<{ filename: string; score: number }> = [];
	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		const candidateExtension = path.extname(entry.name).toLowerCase();
		if (!AUDIO_FILE_EXTENSIONS.has(candidateExtension) || candidateExtension !== extension) {
			continue;
		}
		const score = scoreFilenameCandidate({
			filename: entry.name,
			titleKey,
			expectedTrackNo
		});
		if (score <= 0) {
			continue;
		}
		scored.push({ filename: entry.name, score });
	}

	if (scored.length === 0) {
		return null;
	}
	scored.sort((a, b) => {
		if (a.score !== b.score) {
			return b.score - a.score;
		}
		if (a.filename.length !== b.filename.length) {
			return a.filename.length - b.filename.length;
		}
		return a.filename.localeCompare(b.filename);
	});
	return scored[0]?.filename ?? null;
}

export async function finalizeTrack(params: FinalizeTrackParams): Promise<FinalizeTrackResult> {
	const {
		trackId,
		quality,
		albumTitle,
		artistName,
		targetArtistDir,
		targetAlbumDir,
		targetFilenameHint,
		requireExistingTargetDir = false,
		trackTitle,
		trackNumber,
		outputBaseDir,
		trackLookup,
		buffer,
		tempFilePath,
		conflictResolution = 'overwrite_if_different',
		checksum,
		detectedMimeType,
		downloadCoverSeperately = false,
		coverUrl,
		experimentalMusicBrainzTagging = false,
		strictMusicBrainzMatching = false
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

	const baseDir = outputBaseDir ?? getDownloadDir();
	const overrideArtistDir = sanitizeOverrideDirComponent(targetArtistDir);
	const overrideAlbumDir = sanitizeOverrideDirComponent(targetAlbumDir);
	const overrideFilenameHint = sanitizeTargetFilenameHint(targetFilenameHint);
	if (
		(targetArtistDir && !overrideArtistDir) ||
		(targetAlbumDir && !overrideAlbumDir)
	) {
		console.warn(
			`[Server Download] Invalid target directory override for track ${trackId}; falling back to sanitized metadata path.`
		);
	}
	if (targetFilenameHint && !overrideFilenameHint) {
		return {
			success: false,
			error: createDownloadError(
				ERROR_CODES.INVALID_FILE,
				`Invalid repair filename hint: ${targetFilenameHint}`,
				false
			),
			status: 400
		};
	}
	const artistDir = overrideArtistDir ?? sanitizeDirName(artistName || 'Unknown Artist');
	const albumDir = overrideAlbumDir ?? sanitizeDirName(albumTitle || 'Unknown Album');
	const targetDir = path.join(baseDir, artistDir, albumDir);
	if (requireExistingTargetDir) {
		if (!overrideArtistDir || !overrideAlbumDir) {
			return {
				success: false,
				error: createDownloadError(
					ERROR_CODES.INVALID_FILE,
					'Repair target directory is missing or invalid',
					false
				),
				status: 400
			};
		}
		let targetStat;
		try {
			targetStat = await fs.stat(targetDir);
		} catch {
			targetStat = null;
		}
		if (!targetStat?.isDirectory()) {
			return {
				success: false,
				error: createDownloadError(
					ERROR_CODES.INVALID_FILE,
					`Repair target directory does not exist: ${targetDir}`,
					false
				),
				status: 409
			};
		}
		if (!overrideFilenameHint) {
			return {
				success: false,
				error: createDownloadError(
					ERROR_CODES.INVALID_FILE,
					'Repair target filename hint is missing or invalid',
					false
				),
				status: 400
			};
		}
	} else {
		await ensureDir(targetDir);
	}
	let initialFilepath = path.join(targetDir, filename);
	if (!requireExistingTargetDir && !overrideFilenameHint && conflictResolution !== 'rename') {
		const existingFilenameHint = await findExistingFilenameHint({
			targetDir,
			trackTitle,
			trackNumber,
			expectedExtension: ext
		});
		if (existingFilenameHint) {
			initialFilepath = path.join(targetDir, existingFilenameHint);
			if (existingFilenameHint !== filename) {
				console.log(
					`[Server Download] Reusing existing filename for track ${trackId}: ${existingFilenameHint}`
				);
			}
		}
	}
	if (requireExistingTargetDir && overrideFilenameHint) {
		const hintedPath = path.join(targetDir, overrideFilenameHint);
		let hintedStat;
		try {
			hintedStat = await fs.stat(hintedPath);
		} catch {
			hintedStat = null;
		}
		if (!hintedStat?.isFile()) {
			return {
				success: false,
				error: createDownloadError(
					ERROR_CODES.INVALID_FILE,
					`Repair target file does not exist: ${hintedPath}`,
					false
				),
				status: 409
			};
		}
		initialFilepath = hintedPath;
	}
	const effectiveConflictResolution: ConflictResolution = requireExistingTargetDir
		? 'overwrite'
		: conflictResolution;
	let musicBrainzSummary: MusicBrainzLookupSummary | undefined = experimentalMusicBrainzTagging
		? {
				enabled: true,
				strictMatch: strictMusicBrainzMatching,
				lookupAttempted: false,
				tagsApplied: 0
			}
		: undefined;

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
	if (!resolvedChecksum && effectiveConflictResolution === 'overwrite_if_different') {
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

	const resolvedConflict = await resolveFileConflict(
		initialFilepath,
		effectiveConflictResolution,
		newFileSize,
		resolvedChecksum,
		baseDir
	);
	const finalPath = resolvedConflict.finalPath;
	let action = resolvedConflict.action;

	if (action === 'skip') {
		const existingIntegrity = await validateAudioFileIntegrity({
			filePath: finalPath,
			expectedExtension: path.extname(finalPath),
			expectedDurationSeconds: Number(trackLookup?.track?.duration)
		});
		if (!existingIntegrity.ok) {
			console.warn(
				`[Server Download] Existing file failed integrity validation for track ${trackId}; overwriting instead of skipping: ${existingIntegrity.error}`
			);
			action = 'overwrite';
		}
	}

	if (action === 'skip') {
		if (tempFilePath) {
			await fs.unlink(tempFilePath).catch(() => {});
		}
		logMusicBrainzFinalizeSummary(trackId, musicBrainzSummary, 'skip');
		return {
			success: true,
			filepath: finalPath,
			filename: path.basename(finalPath),
			action,
			coverDownloaded: false,
			metadataEmbedded: false,
			musicBrainz: musicBrainzSummary
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
			const overrideAlbumTitle = albumTitle && albumTitle.trim().length > 0 ? albumTitle.trim() : undefined;
			const overrideAlbumArtist = artistName && artistName.trim().length > 0 ? artistName.trim() : undefined;
			const numericTrackNumber = Number(trackNumber);
			const overrideTrackNumber =
				Number.isFinite(numericTrackNumber) && numericTrackNumber > 0
					? Math.trunc(numericTrackNumber)
					: undefined;
			const metadataOverrides: MetadataOverrides = {};
			if (overrideAlbumTitle) {
				metadataOverrides.albumTitle = overrideAlbumTitle;
			}
			if (overrideAlbumArtist) {
				metadataOverrides.albumArtist = overrideAlbumArtist;
			}
			if (overrideTrackNumber !== undefined) {
				metadataOverrides.trackNumber = overrideTrackNumber;
			}
			const hasMetadataOverrides = Object.keys(metadataOverrides).length > 0;
			if (hasMetadataOverrides) {
				const trackAlbumTitle = trackLookup.track?.album?.title;
				const trackAlbumArtist =
					trackLookup.track?.album?.artist?.name ??
					(trackLookup.track?.album?.artists && trackLookup.track.album.artists.length > 0
						? trackLookup.track.album.artists[0]?.name
						: undefined);
				if (overrideAlbumTitle && trackAlbumTitle && overrideAlbumTitle !== trackAlbumTitle) {
					console.log(
						`[Server Metadata] Normalizing album title for track ${trackId}: "${trackAlbumTitle}" -> "${overrideAlbumTitle}"`
					);
				}
				if (overrideAlbumArtist && trackAlbumArtist && overrideAlbumArtist !== trackAlbumArtist) {
					console.log(
						`[Server Metadata] Normalizing album artist for track ${trackId}: "${trackAlbumArtist}" -> "${overrideAlbumArtist}"`
					);
				}
				if (
					overrideTrackNumber !== undefined &&
					Number(trackLookup.track?.trackNumber) !== overrideTrackNumber
				) {
					console.log(
						`[Server Metadata] Normalizing track number for track ${trackId}: "${trackLookup.track?.trackNumber}" -> "${overrideTrackNumber}"`
					);
				}
			}
			finalOutputPath = await embedMetadataToFile(
				finalOutputPath,
				trackLookup,
				hasMetadataOverrides ? metadataOverrides : undefined,
				{
					enableExperimentalMusicBrainzTagging: experimentalMusicBrainzTagging,
					strictMusicBrainzMatching,
					onMusicBrainzLookupResult: (summary) => {
						musicBrainzSummary = summary;
					}
				}
			);
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

	let finalSize = 0;
	try {
		const finalStat = await fs.stat(finalOutputPath);
		finalSize = finalStat.size;
	} catch (error) {
		return {
			success: false,
			error: createDownloadError(
				ERROR_CODES.SIZE_MISMATCH,
				'Failed to verify finalized file size on disk',
				true,
				{ originalError: error instanceof Error ? error.message : String(error) },
				10,
				'Please retry the download.'
			),
			status: 500
		};
	}

	if (finalSize <= 0) {
		return {
			success: false,
			error: createDownloadError(
				ERROR_CODES.SIZE_MISMATCH,
				'Finalized file is empty',
				true,
				{ path: finalOutputPath, size: finalSize },
				10,
				'Please retry the download.'
			),
			status: 500
		};
	}

	if (!metadataEmbedded && finalOutputPath === finalPath && finalSize !== newFileSize) {
		return {
			success: false,
			error: createDownloadError(
				ERROR_CODES.SIZE_MISMATCH,
				`Finalized file size mismatch: expected ${newFileSize} bytes, got ${finalSize} bytes`,
				true,
				{ path: finalOutputPath, expectedBytes: newFileSize, actualBytes: finalSize },
				10,
				'Please retry the download.'
			),
			status: 500
		};
	}

	const integrity = await validateAudioFileIntegrity({
		filePath: finalOutputPath,
		expectedExtension: path.extname(finalOutputPath),
		expectedDurationSeconds: Number(trackLookup?.track?.duration)
	});
	if (!integrity.ok) {
		return {
			success: false,
			error: createDownloadError(
				ERROR_CODES.INTEGRITY_CHECK_FAILED,
				`Audio integrity validation failed: ${integrity.error || 'unknown reason'}`,
				true,
				{
					path: finalOutputPath,
					durationSeconds: integrity.durationSeconds,
					codecName: integrity.codecName,
					formatName: integrity.formatName
				},
				10,
				'Please retry the download.'
			),
			status: 500
		};
	}

	logMusicBrainzFinalizeSummary(trackId, musicBrainzSummary, 'finalize');
	return {
		success: true,
		filepath: finalOutputPath,
		filename: path.basename(finalOutputPath),
		action,
		coverDownloaded,
		metadataEmbedded,
		musicBrainz: musicBrainzSummary
	};
}
