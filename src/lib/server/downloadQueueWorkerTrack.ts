import { API_CONFIG } from '$lib/config';
import { losslessAPI } from '$lib/api';
import { finalizeTrack } from '$lib/server/download/finalizeTrack';
import type { AudioQuality } from '$lib/types';
import {
	categorizeError,
	type ErrorCategory,
	type QueuedJob,
	type TrackJob,
	updateJobStatus
} from './downloadQueueManager';
import { downloadTrackServerSide } from './download/serverDownloadAdapter';
import * as rateLimiter from './rateLimiter';
import { shouldStopJob, waitWithJitter } from './downloadQueueWorkerControl';
import {
	deriveFailureCode,
	formatMegabytes,
	isDefinitiveExternalTrackFailure,
	resolveNextFallbackQuality,
	shouldAttemptQualityFallback
} from './downloadQueueWorkerPolicy';

const DEFAULT_SEGMENT_TIMEOUT_MS = 20_000;
const SEGMENT_TIMEOUT_MS = (() => {
	const raw = process.env.SEGMENT_TIMEOUT_MS || process.env.DOWNLOAD_SEGMENT_TIMEOUT_MS || '';
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SEGMENT_TIMEOUT_MS;
})();

const TRACK_RETRY_BASE_DELAY_MS = Math.max(
	200,
	Number(process.env.DOWNLOAD_TRACK_RETRY_BASE_DELAY_MS || 1000)
);
const TRACK_RETRY_MAX_DELAY_MS = Math.max(
	TRACK_RETRY_BASE_DELAY_MS,
	Number(process.env.DOWNLOAD_TRACK_RETRY_MAX_DELAY_MS || 30_000)
);
const DOWNLOAD_ENABLE_QUALITY_FALLBACK = process.env.DOWNLOAD_ENABLE_QUALITY_FALLBACK === 'true';
const DEFAULT_ALBUM_TRACK_MAX_ATTEMPTS = 12;
const legacyAlbumTrackRetriesRaw = Number(process.env.ALBUM_TRACK_RETRY_ATTEMPTS || '');
const legacyAlbumTrackAttemptsDefault =
	Number.isFinite(legacyAlbumTrackRetriesRaw) && legacyAlbumTrackRetriesRaw >= 0
		? Math.trunc(legacyAlbumTrackRetriesRaw) + 1
		: DEFAULT_ALBUM_TRACK_MAX_ATTEMPTS;
const albumTrackMaxAttemptsRaw = Number(
	process.env.ALBUM_TRACK_MAX_ATTEMPTS || legacyAlbumTrackAttemptsDefault
);
const ALBUM_TRACK_MAX_ATTEMPTS =
	Number.isFinite(albumTrackMaxAttemptsRaw) && albumTrackMaxAttemptsRaw > 0
		? Math.trunc(albumTrackMaxAttemptsRaw)
		: DEFAULT_ALBUM_TRACK_MAX_ATTEMPTS;

async function downloadTrack(
	trackId: number,
	quality: AudioQuality,
	albumTitle?: string,
	artistName?: string,
	trackTitle?: string,
	trackNumber?: number,
	coverUrl?: string,
	options?: {
		downloadCover?: boolean;
		outputBaseDir?: string;
		forceOverwrite?: boolean;
		targetArtistDir?: string;
		targetAlbumDir?: string;
		targetFilenameHint?: string;
		requireMetadata?: boolean;
		experimentalMusicBrainzTagging?: boolean;
		strictMusicBrainzMatching?: boolean;
		musicBrainzReleaseId?: string;
	}
): Promise<{
	success: boolean;
	error?: string;
	filepath?: string;
	retryable?: boolean;
	errorCategory?: ErrorCategory;
	retryAfterMs?: number;
}> {
	try {
		console.log(
			`[Worker] Downloading track ${trackId} (${quality}) [segment timeout ${SEGMENT_TIMEOUT_MS}ms]`
		);
		const conflictResolution = options?.forceOverwrite ? 'overwrite' : 'overwrite_if_different';

		const apiTarget = API_CONFIG.baseUrl || API_CONFIG.targets[0]?.baseUrl || 'unknown';
		const downloadStart = Date.now();
		const result = await downloadTrackServerSide({
			trackId,
			quality,
			albumTitle,
			artistName,
			trackTitle,
			trackNumber,
			coverUrl,
			conflictResolution,
			apiClient: losslessAPI,
			experimentalMusicBrainzTagging: options?.experimentalMusicBrainzTagging !== false,
			strictMusicBrainzMatching: options?.strictMusicBrainzMatching === true,
			musicBrainzReleaseId: options?.musicBrainzReleaseId,
			segmentTimeoutMs: SEGMENT_TIMEOUT_MS
		});

		if (!result.success || !result.buffer) {
			const errorMsg = result.error || 'Download failed';
			const categorized = categorizeError(errorMsg, undefined);
			const retryable = result.retryable ?? categorized.isRetryable;

			if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
				rateLimiter.recordError(apiTarget, 'rate_limit');
			}

			const errorLogMsg = errorMsg.length > 200 ? errorMsg.slice(0, 200) + '…' : errorMsg;
			console.error(`[Worker] Track ${trackId} failed: ${errorLogMsg}`);
			return {
				success: false,
				error: errorMsg,
				retryable,
				errorCategory: categorized.category,
				retryAfterMs: categorized.retryAfterMs
			};
		}

		if (!result.trackLookup && options?.requireMetadata) {
			const metadataError =
				result.warning || `Metadata lookup unavailable for track ${trackId} (required for repair)`;
			const categorized = categorizeError(metadataError);
			console.warn(
				`[Worker] Track ${trackId} metadata missing in strict repair mode; retrying: ${metadataError}`
			);
			return {
				success: false,
				error: metadataError,
				retryable: categorized.isRetryable,
				errorCategory: categorized.category,
				retryAfterMs: categorized.retryAfterMs
			};
		}
		if (!result.trackLookup) {
			console.warn(
				`[Worker] Track ${trackId} downloaded without track metadata; proceeding with filename-only finalization.`
			);
		}
		if (result.warning) {
			console.warn(`[Worker] Track ${trackId} warning: ${result.warning}`);
		}
		const downloadDurationMs = Date.now() - downloadStart;
		console.log(
			`[Worker] Track ${trackId} download completed in ${downloadDurationMs}ms (${formatMegabytes(result.receivedBytes)})`
		);

		const resolvedArtist = artistName || result.trackLookup?.track.artist?.name || 'Unknown Artist';
		const resolvedAlbum = albumTitle || result.trackLookup?.track.album?.title || 'Unknown Album';
		const lookupTitle = result.trackLookup?.track.title;
		const lookupVersion = result.trackLookup?.track.version;
		const computedTitle = lookupTitle
			? lookupVersion
				? `${lookupTitle} (${lookupVersion})`
				: lookupTitle
			: undefined;
		const resolvedTitle = trackTitle || computedTitle || 'Unknown Track';
		const resolvedTrackNumber =
			trackNumber || Number(result.trackLookup?.track.trackNumber) || undefined;

		const finalizeStart = Date.now();
		const finalizeResult = await finalizeTrack({
			trackId,
			quality,
			albumTitle: resolvedAlbum,
			artistName: resolvedArtist,
			targetArtistDir: options?.targetArtistDir,
			targetAlbumDir: options?.targetAlbumDir,
			targetFilenameHint: options?.targetFilenameHint,
			requireExistingTargetDir: Boolean(options?.targetArtistDir && options?.targetAlbumDir),
			trackTitle: resolvedTitle,
			trackNumber: resolvedTrackNumber,
			trackLookup: result.trackLookup,
			buffer: result.buffer,
			conflictResolution,
			detectedMimeType: result.mimeType,
			downloadCoverSeperately: options?.downloadCover ?? true,
			coverUrl,
			experimentalMusicBrainzTagging: options?.experimentalMusicBrainzTagging !== false,
			strictMusicBrainzMatching: options?.strictMusicBrainzMatching === true,
			musicBrainzReleaseId: options?.musicBrainzReleaseId,
			outputBaseDir: options?.outputBaseDir
		});
		const finalizeDurationMs = Date.now() - finalizeStart;
		console.log(`[Worker] Track ${trackId} finalize completed in ${finalizeDurationMs}ms`);

		if (!finalizeResult.success) {
			console.error(`[Worker] Track ${trackId} finalize failed: ${finalizeResult.error.message}`);
			return {
				success: false,
				error: finalizeResult.error.message,
				retryable: finalizeResult.error.recoverable
			};
		}

		rateLimiter.recordSuccess(apiTarget);
		console.log(`[Worker] Completed: ${finalizeResult.filename || trackId}`);
		return {
			success: true,
			filepath: finalizeResult.filepath
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const categorized = categorizeError(message);
		console.error(`[Worker] Track ${trackId} failed: ${message}`);
		return {
			success: false,
			error: message,
			retryable: categorized.isRetryable,
			errorCategory: categorized.category,
			retryAfterMs: categorized.retryAfterMs
		};
	}
}

export async function processTrackJob(job: QueuedJob): Promise<void> {
	const trackJob = job.job as TrackJob;
	const startTime = Date.now();
	const maxRetries = Math.max(0, job.maxRetries ?? 3);
	let currentQuality = trackJob.quality;
	let retryCount = job.retryCount ?? 0;
	const fallbackHistory = Array.isArray(job.fallbackHistory) ? [...job.fallbackHistory] : [];

	await updateJobStatus(job.id, {
		status: 'processing',
		startedAt: startTime,
		progress: 0,
		error: undefined,
		errorCategory: undefined,
		failureCode: undefined,
		nextRetryAt: undefined
	});

	while (true) {
		const requestedStop = await shouldStopJob(job.id);
		if (requestedStop === 'cancelled') {
			await updateJobStatus(job.id, {
				status: 'cancelled',
				completedAt: Date.now(),
				error: undefined
			});
			return;
		}
		if (requestedStop === 'paused') {
			await updateJobStatus(job.id, {
				status: 'paused',
				error: undefined
			});
			return;
		}

		const result = await downloadTrack(
			trackJob.trackId,
			currentQuality,
			trackJob.albumTitle,
			trackJob.artistName,
			trackJob.trackTitle,
			trackJob.trackNumber,
			trackJob.coverUrl,
			{
				forceOverwrite: trackJob.forceOverwrite === true,
				targetArtistDir: trackJob.targetArtistDir,
				targetAlbumDir: trackJob.targetAlbumDir,
				targetFilenameHint: trackJob.targetFilenameHint,
				experimentalMusicBrainzTagging: trackJob.experimentalMusicBrainzTagging !== false,
				strictMusicBrainzMatching: trackJob.strictMusicBrainzMatching === true,
				musicBrainzReleaseId: trackJob.musicBrainzReleaseId,
				requireMetadata: Boolean(
					trackJob.targetArtistDir && trackJob.targetAlbumDir && trackJob.targetFilenameHint
				)
			}
		);

		if (result.success) {
			const duration = Date.now() - startTime;
			await updateJobStatus(job.id, {
				status: 'completed',
				progress: 1,
				completedAt: Date.now(),
				downloadTimeMs: duration,
				error: undefined,
				errorCategory: undefined,
				failureCode: undefined,
				retryCount,
				job: { ...trackJob, quality: currentQuality },
				fallbackHistory
			});
			return;
		}

		const categorized = categorizeError(result.error ?? 'Download failed');
		const errorCategory = result.errorCategory ?? categorized.category;
		const retryable = result.retryable ?? categorized.isRetryable;
		const retryAfterMs = result.retryAfterMs ?? categorized.retryAfterMs;

		if (retryable && retryCount < maxRetries) {
			retryCount += 1;
			const backoffMs = Math.min(
				TRACK_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, retryCount - 1)),
				TRACK_RETRY_MAX_DELAY_MS
			);
			const delayMs = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : backoffMs;
			await updateJobStatus(job.id, {
				status: 'processing',
				error: `Retrying (${retryCount}/${maxRetries}) after error: ${result.error ?? 'unknown'}`,
				errorCategory,
				retryCount,
				lastError: result.error
			});
			await waitWithJitter(delayMs);
			continue;
		}

		const fallbackQuality = resolveNextFallbackQuality(currentQuality, fallbackHistory);
		if (fallbackQuality && shouldAttemptQualityFallback(result, DOWNLOAD_ENABLE_QUALITY_FALLBACK)) {
			fallbackHistory.push(currentQuality);
			currentQuality = fallbackQuality;
			retryCount = 0;
			await updateJobStatus(job.id, {
				status: 'processing',
				error: `Primary quality unavailable. Falling back to ${fallbackQuality}.`,
				errorCategory,
				retryCount,
				job: { ...trackJob, quality: fallbackQuality },
				fallbackHistory
			});
			continue;
		}

		await updateJobStatus(job.id, {
			status: 'failed',
			error: `${result.error ?? 'Download failed'} (action required: retry or adjust quality settings)`,
			errorCategory,
			failureCode: deriveFailureCode(errorCategory, result.error ?? 'Download failed'),
			completedAt: Date.now(),
			retryCount,
			lastError: result.error,
			fallbackHistory
		});
		return;
	}
}

export async function downloadAlbumTrackWithPolicy(options: {
	trackId: number;
	quality: AudioQuality;
	albumTitle: string;
	artistName: string;
	trackTitle: string;
	trackNumber: number;
	coverUrl?: string;
	outputBaseDir?: string;
	forceOverwrite?: boolean;
	experimentalMusicBrainzTagging?: boolean;
	strictMusicBrainzMatching?: boolean;
	musicBrainzReleaseId?: string;
}): Promise<{
	success: boolean;
	error?: string;
	errorCategory?: ErrorCategory;
	retries: number;
	attempts: number;
	finalQuality: AudioQuality;
	terminalExternal: boolean;
	filepath?: string;
}> {
	let currentQuality = options.quality;
	let attempts = 0;
	let retries = 0;
	const fallbackHistory: AudioQuality[] = [];

	while (true) {
		attempts += 1;
		const result = await downloadTrack(
			options.trackId,
			currentQuality,
			options.albumTitle,
			options.artistName,
			options.trackTitle,
			options.trackNumber,
			options.coverUrl,
			{
				downloadCover: false,
				outputBaseDir: options.outputBaseDir,
				forceOverwrite: options.forceOverwrite === true,
				experimentalMusicBrainzTagging: options.experimentalMusicBrainzTagging !== false,
				strictMusicBrainzMatching: options.strictMusicBrainzMatching === true,
				musicBrainzReleaseId: options.musicBrainzReleaseId
			}
		);

		if (result.success) {
			return {
				success: true,
				retries,
				attempts,
				finalQuality: currentQuality,
				terminalExternal: false,
				filepath: result.filepath
			};
		}

		const categorized = categorizeError(result.error ?? 'Download failed');
		const errorCategory = result.errorCategory ?? categorized.category;
		const retryable = result.retryable ?? categorized.isRetryable;
		const retryAfterMs = result.retryAfterMs ?? categorized.retryAfterMs;

		const fallbackQuality = resolveNextFallbackQuality(currentQuality, fallbackHistory);
		if (fallbackQuality && shouldAttemptQualityFallback(result, DOWNLOAD_ENABLE_QUALITY_FALLBACK)) {
			console.warn(
				`[Worker] Track ${options.trackId}: switching quality ${currentQuality} -> ${fallbackQuality} after failure: ${result.error ?? 'unknown'}`
			);
			fallbackHistory.push(currentQuality);
			currentQuality = fallbackQuality;
			continue;
		}

		const isExternalFailure = isDefinitiveExternalTrackFailure({
			errorCategory,
			error: result.error,
			retryable
		});
		if (isExternalFailure) {
			return {
				success: false,
				error:
					result.error ??
					'External error while downloading track (authentication, availability, or local disk issue)',
				errorCategory,
				retries,
				attempts,
				finalQuality: currentQuality,
				terminalExternal: true
			};
		}

		if (attempts >= ALBUM_TRACK_MAX_ATTEMPTS) {
			const terminalError =
				`Persistent upstream failure after ${attempts} attempt(s): ` +
				(result.error ?? 'unknown error');
			return {
				success: false,
				error: terminalError,
				errorCategory,
				retries,
				attempts,
				finalQuality: currentQuality,
				terminalExternal: true
			};
		}

		retries += 1;
		const backoffMs = Math.min(
			TRACK_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, retries - 1)),
			TRACK_RETRY_MAX_DELAY_MS
		);
		const delayMs = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : backoffMs;
		const retryErrMsg = (result.error ?? 'unknown');
		const retryErrLogMsg = retryErrMsg.length > 120 ? retryErrMsg.slice(0, 120) + '…' : retryErrMsg;
		console.warn(
			`[Worker] Track ${options.trackId}: retrying after failure (${attempts}/${ALBUM_TRACK_MAX_ATTEMPTS}) in ${delayMs}ms: ${retryErrLogMsg}`
		);
		await waitWithJitter(delayMs);
	}
}
