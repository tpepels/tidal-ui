/**
 * Background worker for processing server-side download queue
 * Runs independently of browser sessions
 */

import * as fs from 'node:fs/promises';
import * as path from 'path';
import {
	enqueueJob,
	dequeueJob,
	updateJobStatus,
	cleanupOldJobs,
	cleanupStuckJobs,
	categorizeError,
	getJob,
	type QueuedJob,
	type TrackJob,
	type AlbumJob,
	type ErrorCategory
} from './downloadQueueManager';
import { API_CONFIG } from '$lib/config';
import { refreshApiTargetsIfStale } from '$lib/config/targets';
import * as rateLimiter from './rateLimiter';
import type { AudioQuality } from '$lib/types';
import { losslessAPI } from '$lib/api';
import { downloadTrackServerSide } from './download/serverDownloadAdapter';
import { finalizeTrack } from '$lib/server/download/finalizeTrack';
import { sweepTransientAlbumArtifacts } from './mediaLibrary';
import { acquireMediaMaintenanceLock } from './mediaMaintenanceLock';
import {
	downloadCoverToDir,
	ensureDir,
	getDownloadDir,
	getTempDir,
	sanitizeDirName
} from '../../routes/api/download-track/_shared';

let isRunning = false;
let stopRequested = false;
const DEFAULT_WORKER_MAX_CONCURRENT = 4;
const MAX_CONCURRENT = Math.max(
	1,
	Number(process.env.WORKER_MAX_CONCURRENT || DEFAULT_WORKER_MAX_CONCURRENT)
);
const POLL_INTERVAL_MS = 2000;
const PROCESSING_TIMEOUT_MS = 300000; // 5 minute max time in 'processing' state
const activeSemaphore = new Map<string, Promise<void>>();
const HEALTH_BACKOFF_MS = {
	rateLimit: 5 * 60 * 1000, // 5 minutes
	serverError: 3 * 60 * 1000, // 3 minutes
	timeout: 2 * 60 * 1000 // 2 minutes
};
const targetHealth = new Map<string, number>();
let albumTargetCursor = 0;
const DEFAULT_SEGMENT_TIMEOUT_MS = 20000;
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
const ALBUM_RETRY_BASE_DELAY_MS = Math.max(
	1000,
	Number(process.env.ALBUM_RETRY_BASE_DELAY_MS || 5000)
);
const ALBUM_RETRY_MAX_DELAY_MS = Math.max(
	ALBUM_RETRY_BASE_DELAY_MS,
	Number(process.env.ALBUM_RETRY_MAX_DELAY_MS || 5 * 60 * 1000)
);
const DOWNLOAD_ENABLE_QUALITY_FALLBACK = process.env.DOWNLOAD_ENABLE_QUALITY_FALLBACK !== 'false';
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
const DEFAULT_ALBUM_TRACK_CONCURRENCY = 2;
const ALBUM_STAGING_ROOT = path.join(getTempDir(), 'album-staging');
const AUDIO_EXTENSIONS = new Set([
	'.flac',
	'.m4a',
	'.mp4',
	'.mp3',
	'.aac',
	'.wav',
	'.ogg',
	'.opus'
]);
const MEDIA_LIBRARY_PUBLISH_LOCK_WAIT_MS = Math.max(
	0,
	Number(process.env.MEDIA_LIBRARY_PUBLISH_LOCK_WAIT_MS || 120_000)
);

type ExpectedAlbumTrack = {
	trackId: number;
	trackTitle: string;
	trackNumber: number;
};

function formatMegabytes(bytes: number | undefined): string {
	if (!Number.isFinite(bytes) || !bytes) return '0 MB';
	const mb = (bytes as number) / (1024 * 1024);
	return `${mb.toFixed(2)} MB`;
}

function isTargetTemporarilyDown(name: string): boolean {
	const downUntil = targetHealth.get(name);
	return !!downUntil && downUntil > Date.now();
}

function markTargetDown(name: string, reason: string, timeoutMs: number): void {
	const until = Date.now() + timeoutMs;
	targetHealth.set(name, until);
	const seconds = Math.round(timeoutMs / 1000);
	console.warn(`[Worker] Marking target ${name} down for ${seconds}s (${reason})`);
}

function rotateTargets<T>(targets: T[], offset: number): T[] {
	if (targets.length === 0) return targets;
	const shift = ((offset % targets.length) + targets.length) % targets.length;
	return [...targets.slice(shift), ...targets.slice(0, shift)];
}

const QUALITY_FALLBACK_CHAIN: Record<AudioQuality, AudioQuality[]> = {
	HI_RES_LOSSLESS: ['LOSSLESS', 'HIGH', 'LOW'],
	LOSSLESS: ['HIGH', 'LOW'],
	HIGH: ['LOW'],
	LOW: []
};

function resolveNextFallbackQuality(
	current: AudioQuality,
	history: AudioQuality[] | undefined
): AudioQuality | null {
	const tried = new Set<AudioQuality>(history ?? []);
	const candidates = QUALITY_FALLBACK_CHAIN[current] ?? [];
	for (const candidate of candidates) {
		if (!tried.has(candidate)) {
			return candidate;
		}
	}
	return null;
}

function shouldAttemptQualityFallback(result: {
	errorCategory?: ErrorCategory;
	error?: string;
	retryable?: boolean;
}): boolean {
	if (!DOWNLOAD_ENABLE_QUALITY_FALLBACK) return false;
	if (result.retryable) return false;
	if (result.errorCategory === 'not_found') return true;
	const message = (result.error ?? '').toLowerCase();
	return (
		message.includes('quality') ||
		message.includes('manifest') ||
		message.includes('unsupported') ||
		message.includes('unavailable')
	);
}

function isDefinitiveExternalTrackFailure(result: {
	errorCategory?: ErrorCategory;
	error?: string;
	retryable?: boolean;
}): boolean {
	if (result.retryable === true) return false;
	const category = result.errorCategory;
	if (category === 'auth' || category === 'not_found') {
		return true;
	}

	const message = (result.error ?? '').toLowerCase();
	return (
		message.includes('permission denied') ||
		message.includes('eacces') ||
		message.includes('enospc') ||
		message.includes('no space left') ||
		message.includes('disk space') ||
		message.includes('invalid track id') ||
		message.includes('unauthorized') ||
		message.includes('forbidden') ||
		message.includes('quality unavailable') ||
		message.includes('manifest unavailable') ||
		message.includes('unsupported quality') ||
		message.includes('not found')
	);
}

function isAlbumCategoryRetryable(category: ErrorCategory | undefined): boolean {
	return (
		category === 'network' ||
		category === 'rate_limit' ||
		category === 'server_error' ||
		category === 'unknown'
	);
}

function deriveFailureCode(category: ErrorCategory | undefined, message: string): string {
	const lower = message.toLowerCase();
	if (lower.includes('integrity') || lower.includes('ffprobe') || lower.includes('decode')) {
		return 'INTEGRITY_VALIDATION_FAILED';
	}
	if (lower.includes('enospc') || lower.includes('disk full') || lower.includes('no space left')) {
		return 'DISK_FULL';
	}
	if (lower.includes('permission') || lower.includes('eacces')) {
		return 'PERMISSION_DENIED';
	}
	if (lower.includes('album removed due external error')) {
		return 'ALBUM_EXTERNAL_ABORT';
	}
	if (lower.includes('reconciliation') || lower.includes('missing track')) {
		return 'ALBUM_RECONCILIATION_MISSING_TRACKS';
	}
	if (category === 'rate_limit') return 'UPSTREAM_RATE_LIMITED';
	if (category === 'network' && lower.includes('timeout')) return 'UPSTREAM_TIMEOUT';
	if (category === 'network') return 'UPSTREAM_NETWORK';
	if (category === 'auth') return 'UPSTREAM_AUTH';
	if (category === 'not_found') return 'UPSTREAM_NOT_FOUND';
	if (category === 'server_error') return 'UPSTREAM_SERVER_ERROR';
	if (category === 'api_error') return 'UPSTREAM_API_ERROR';
	return 'UNKNOWN';
}

function resetTrackProgressForAlbumRetry(
	trackProgress: QueuedJob['trackProgress']
): QueuedJob['trackProgress'] | undefined {
	if (!Array.isArray(trackProgress)) return undefined;
	return trackProgress.map((track) => ({
		...track,
		status: 'pending',
		error: undefined
	}));
}

function findMissingPublishedTracks(params: {
	expectedTracks: ExpectedAlbumTrack[];
	expectedFileByTrackId: Map<number, string>;
	publishedFiles: Set<string>;
}): ExpectedAlbumTrack[] {
	const missing: ExpectedAlbumTrack[] = [];
	for (const track of params.expectedTracks) {
		const expectedFile = params.expectedFileByTrackId.get(track.trackId);
		if (expectedFile) {
			if (!params.publishedFiles.has(expectedFile)) {
				missing.push(track);
			}
			continue;
		}
		const prefix = `${String(track.trackNumber).padStart(2, '0')} - `;
		const hasFallbackMatch = [...params.publishedFiles].some((name) => name.startsWith(prefix));
		if (!hasFallbackMatch) {
			missing.push(track);
		}
	}
	return missing;
}

async function reconcilePublishedAlbum(params: {
	quality: AudioQuality;
	artistName: string;
	albumTitle: string;
	coverUrl?: string;
	forceOverwrite?: boolean;
	experimentalMusicBrainzTagging?: boolean;
	strictMusicBrainzMatching?: boolean;
	finalAlbumDir: string;
	expectedTracks: ExpectedAlbumTrack[];
	expectedFileByTrackId: Map<number, string>;
}): Promise<{ ok: true } | { ok: false; reason: string; queuedTrackJobIds: string[] }> {
	const entries = await fs.readdir(params.finalAlbumDir, { withFileTypes: true });
	const publishedFiles = new Set(
		entries
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name)
			.filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()))
	);

	const missingTracks = findMissingPublishedTracks({
		expectedTracks: params.expectedTracks,
		expectedFileByTrackId: params.expectedFileByTrackId,
		publishedFiles
	});

	if (missingTracks.length === 0) {
		return { ok: true };
	}

	const queuedTrackJobIds: string[] = [];
	for (const missingTrack of missingTracks) {
		const jobId = await enqueueJob(
			{
				type: 'track',
				trackId: missingTrack.trackId,
				quality: params.quality,
				albumTitle: params.albumTitle,
				artistName: params.artistName,
				trackTitle: missingTrack.trackTitle,
				trackNumber: missingTrack.trackNumber,
				coverUrl: params.coverUrl,
				experimentalMusicBrainzTagging: params.experimentalMusicBrainzTagging === true,
				strictMusicBrainzMatching: params.strictMusicBrainzMatching === true,
				forceOverwrite: params.forceOverwrite === true
			},
			{
				priority: 'high',
				maxRetries: 6,
				checkDuplicate: true,
				forceOverwrite: params.forceOverwrite === true
			}
		);
		queuedTrackJobIds.push(jobId);
	}

	return {
		ok: false,
		reason:
			`Reconciliation found ${missingTracks.length} missing track(s) after publish. ` +
			`Queued ${queuedTrackJobIds.length} track job(s) for recovery.`,
		queuedTrackJobIds
	};
}

async function failOrRequeueAlbumJob(params: {
	job: QueuedJob;
	errorMessage: string;
	errorCategory: ErrorCategory;
	retryAfterMs?: number;
	downloadTimeMs?: number;
	completedTracks?: number;
	totalTracks?: number;
	trackProgress?: QueuedJob['trackProgress'];
}): Promise<'requeued' | 'failed'> {
	const retryCount = params.job.retryCount ?? 0;
	const maxRetries = Math.max(0, params.job.maxRetries ?? 3);
	const failureCode = deriveFailureCode(params.errorCategory, params.errorMessage);

	if (isAlbumCategoryRetryable(params.errorCategory) && retryCount < maxRetries) {
		const nextRetryCount = retryCount + 1;
		const backoffMs = Math.min(
			ALBUM_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, nextRetryCount - 1)),
			ALBUM_RETRY_MAX_DELAY_MS
		);
		const delayMs =
			params.retryAfterMs && params.retryAfterMs > 0 ? params.retryAfterMs : backoffMs;
		await updateJobStatus(params.job.id, {
			status: 'queued',
			progress: 0,
			error: `Auto-retrying album (${nextRetryCount}/${maxRetries}) in ${Math.round(delayMs / 1000)}s: ${params.errorMessage}`,
			errorCategory: params.errorCategory,
			failureCode,
			lastError: params.errorMessage,
			retryCount: nextRetryCount,
			nextRetryAt: Date.now() + delayMs,
			startedAt: undefined,
			completedAt: undefined,
			completedTracks: 0,
			trackProgress: resetTrackProgressForAlbumRetry(params.trackProgress),
			cancellationRequested: false,
			pauseRequested: false
		});
		console.warn(
			`[Worker] Album job ${params.job.id} requeued (${nextRetryCount}/${maxRetries}) after ${params.errorCategory}: ${params.errorMessage}`
		);
		return 'requeued';
	}

	const progress =
		params.totalTracks && params.totalTracks > 0
			? (params.completedTracks ?? 0) / params.totalTracks
			: params.job.progress;
	await updateJobStatus(params.job.id, {
		status: 'failed',
		error: `${params.errorMessage} (action required: retry or adjust quality/settings)`,
		errorCategory: params.errorCategory,
		failureCode,
		completedAt: Date.now(),
		downloadTimeMs: params.downloadTimeMs,
		completedTracks: params.completedTracks,
		progress,
		lastError: params.errorMessage,
		retryCount,
		trackProgress: params.trackProgress
	});
	return 'failed';
}

async function waitWithJitter(baseMs: number): Promise<void> {
	const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseMs * 0.2)));
	await new Promise((resolve) => setTimeout(resolve, baseMs + jitter));
}

async function shouldStopJob(jobId: string): Promise<'cancelled' | 'paused' | null> {
	const latest = await getJob(jobId);
	if (!latest) {
		return 'cancelled';
	}
	if (latest.cancellationRequested) {
		return 'cancelled';
	}
	if (latest.pauseRequested) {
		return 'paused';
	}
	return null;
}

function randomSuffix(): string {
	return Math.random().toString(36).slice(2, 10);
}

function buildAlbumStagingRoot(jobId: string): string {
	return path.join(ALBUM_STAGING_ROOT, `${jobId}-${Date.now()}-${randomSuffix()}`);
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function cleanupAlbumStaging(stagingRoot: string | undefined): Promise<void> {
	if (!stagingRoot) return;
	try {
		await fs.rm(stagingRoot, { recursive: true, force: true });
	} catch (error) {
		console.warn(`[Worker] Failed to clean up staging directory ${stagingRoot}:`, error);
	}
}

async function cleanupStaleAlbumStagingOnStartup(): Promise<number> {
	try {
		await ensureDir(ALBUM_STAGING_ROOT);
		const entries = await fs.readdir(ALBUM_STAGING_ROOT, { withFileTypes: true });
		let cleaned = 0;
		for (const entry of entries) {
			const entryPath = path.join(ALBUM_STAGING_ROOT, entry.name);
			try {
				await fs.rm(entryPath, { recursive: true, force: true });
				cleaned += 1;
			} catch (error) {
				console.warn(`[Worker] Failed to remove stale album staging path ${entryPath}:`, error);
			}
		}
		if (cleaned > 0) {
			console.log(`[Worker] Cleaned ${cleaned} stale album staging path(s) on startup`);
		}
		return cleaned;
	} catch (error) {
		console.warn('[Worker] Failed to sweep album staging directory on startup:', error);
		return 0;
	}
}

async function publishAlbumFromStaging(options: {
	jobId: string;
	stagingRoot: string;
	artistDirName: string;
	albumDirName: string;
}): Promise<void> {
	const stagedAlbumDir = path.join(
		options.stagingRoot,
		options.artistDirName,
		options.albumDirName
	);
	if (!(await pathExists(stagedAlbumDir))) {
		throw new Error('Album staging directory missing before publish');
	}

	const finalArtistDir = path.join(getDownloadDir(), options.artistDirName);
	const finalAlbumDir = path.join(finalArtistDir, options.albumDirName);
	await ensureDir(finalArtistDir);
	const publishingDir = path.join(
		finalArtistDir,
		`.${options.albumDirName}.publishing-${options.jobId}-${randomSuffix()}`
	);
	const backupDir = path.join(
		finalArtistDir,
		`.${options.albumDirName}.backup-${options.jobId}-${randomSuffix()}`
	);

	await fs.rm(publishingDir, { recursive: true, force: true });
	await fs.rm(backupDir, { recursive: true, force: true });
	await fs.cp(stagedAlbumDir, publishingDir, { recursive: true, force: true });

	const finalExists = await pathExists(finalAlbumDir);
	if (!finalExists) {
		try {
			await fs.rename(publishingDir, finalAlbumDir);
			await fs.rm(stagedAlbumDir, { recursive: true, force: true });
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== 'EEXIST' && code !== 'ENOTEMPTY') {
				throw error;
			}
		}
	}

	let movedExistingToBackup = false;
	try {
		if (await pathExists(finalAlbumDir)) {
			await fs.rename(finalAlbumDir, backupDir);
			movedExistingToBackup = true;
		}
		await fs.rename(publishingDir, finalAlbumDir);
		if (movedExistingToBackup) {
			await fs.rm(backupDir, { recursive: true, force: true });
		}
		await fs.rm(stagedAlbumDir, { recursive: true, force: true });
	} catch (error) {
		await fs.rm(finalAlbumDir, { recursive: true, force: true }).catch(() => {});
		if (movedExistingToBackup) {
			try {
				await fs.rename(backupDir, finalAlbumDir);
			} catch (restoreError) {
				console.error(
					`[Worker] Failed to restore album backup after publish error for ${finalAlbumDir}:`,
					restoreError
				);
			}
		}
		throw error;
	} finally {
		await fs.rm(publishingDir, { recursive: true, force: true }).catch(() => {});
		await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
	}
}

/**
 * Download a single track using the server download adapter
 * This bypasses HTTP entirely and calls the download core directly
 */
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

		// Call the server adapter directly (NO HTTP)
		// Pass losslessAPI which uses fetchWithCORS for proper target rotation
		const result = await downloadTrackServerSide({
			trackId,
			quality,
			albumTitle,
			artistName,
			trackTitle,
			trackNumber,
			coverUrl,
			conflictResolution,
			apiClient: losslessAPI, // Main branch's API client with all the tested logic
			experimentalMusicBrainzTagging: options?.experimentalMusicBrainzTagging === true,
			strictMusicBrainzMatching: options?.strictMusicBrainzMatching === true,
			segmentTimeoutMs: SEGMENT_TIMEOUT_MS
		});

		if (!result.success || !result.buffer) {
			const errorMsg = result.error || 'Download failed';
			const categorized = categorizeError(errorMsg, undefined);
			const retryable = result.retryable ?? categorized.isRetryable;

			if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
				rateLimiter.recordError(apiTarget, 'rate_limit');
			}

			console.error(`[Worker] Track ${trackId} failed: ${errorMsg}`);
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
			experimentalMusicBrainzTagging: options?.experimentalMusicBrainzTagging === true,
			strictMusicBrainzMatching: options?.strictMusicBrainzMatching === true,
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

		// Record success for rate limiter
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

/**
 * Process a track job with retry logic
 */
async function processTrackJob(job: QueuedJob): Promise<void> {
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
				experimentalMusicBrainzTagging: trackJob.experimentalMusicBrainzTagging === true,
				strictMusicBrainzMatching: trackJob.strictMusicBrainzMatching === true,
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
		if (fallbackQuality && shouldAttemptQualityFallback(result)) {
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

/**
 * Parse album response data which can be in multiple formats
 */
function parseAlbumResponse(data: unknown): {
	album: Record<string, unknown>;
	tracks: Array<Record<string, unknown>>;
} {
	if (!data) {
		throw new Error('Empty response from API');
	}

	// Handle v2 API format: { data: { items: [...] } }
	if (data && typeof data === 'object' && 'data' in data) {
		const dataObj = data as { data?: unknown };
		if (dataObj.data && typeof dataObj.data === 'object' && 'items' in dataObj.data) {
			const items = (dataObj.data as { items?: unknown }).items;
			if (Array.isArray(items) && items.length > 0) {
				const firstItem = items[0];
				const firstTrack =
					firstItem && typeof firstItem === 'object' && 'item' in firstItem
						? (firstItem as { item: unknown }).item
						: firstItem;

				if (firstTrack && typeof firstTrack === 'object' && 'album' in firstTrack) {
					const albumData = (firstTrack as { album?: unknown }).album;
					if (!albumData || typeof albumData !== 'object') {
						throw new Error('Invalid album data in API response');
					}
					const album = albumData as Record<string, unknown>;

					const tracks = items
						.map((i: unknown) => {
							if (!i || typeof i !== 'object') return null;
							const item = 'item' in i ? (i as { item: unknown }).item : i;
							if (!item || typeof item !== 'object') return null;
							const track = item as Record<string, unknown>;
							// Validate track has required fields
							if (!track.id || typeof track.id !== 'number') return null;
							return track;
						})
						.filter((t): t is Record<string, unknown> => t !== null);

					if (tracks.length === 0) {
						throw new Error('No valid tracks found in album');
					}

					return { album, tracks };
				}
			}
		}
	}

	// Handle array format: [album, { items: [...] }]
	const entries = Array.isArray(data) ? data : [data];
	let album: Record<string, unknown> | undefined;
	let trackCollection: { items?: unknown[] } | undefined;

	for (const entry of entries) {
		if (!entry || typeof entry !== 'object') continue;

		// Check if this is an album object
		if (!album && 'title' in entry && 'id' in entry) {
			album = entry as Record<string, unknown>;
			continue;
		}

		// Check if this is a track collection
		if (
			!trackCollection &&
			'items' in entry &&
			Array.isArray((entry as { items?: unknown[] }).items)
		) {
			trackCollection = entry as { items?: unknown[] };
		}
	}

	if (!album) {
		throw new Error('Album not found in response');
	}

	const tracks: Array<Record<string, unknown>> = [];
	if (trackCollection?.items) {
		for (const rawItem of trackCollection.items) {
			if (!rawItem || typeof rawItem !== 'object') continue;

			const trackObj =
				'item' in rawItem && rawItem.item && typeof rawItem.item === 'object'
					? (rawItem.item as Record<string, unknown>)
					: (rawItem as Record<string, unknown>);

			// Validate track has required fields
			if (trackObj.id && typeof trackObj.id === 'number') {
				tracks.push(trackObj);
			}
		}
	}

	if (tracks.length === 0) {
		throw new Error('No valid tracks found in album response');
	}

	return { album, tracks };
}

function warnIfAlbumTrackListIncomplete(
	albumId: number,
	album: Record<string, unknown>,
	tracks: Array<Record<string, unknown>>
): void {
	const rawExpectedCount = Number(album.numberOfTracks);
	if (!Number.isFinite(rawExpectedCount) || rawExpectedCount <= 0) {
		return;
	}
	const expectedCount = Math.trunc(rawExpectedCount);
	const observedTrackNumbers = new Set<number>();
	for (const track of tracks) {
		const trackNumber = Number(track.trackNumber);
		if (Number.isFinite(trackNumber) && trackNumber > 0) {
			observedTrackNumbers.add(Math.trunc(trackNumber));
		}
	}

	const missingTrackNumbers: number[] = [];
	for (let expected = 1; expected <= expectedCount; expected += 1) {
		if (!observedTrackNumbers.has(expected)) {
			missingTrackNumbers.push(expected);
		}
	}

	if (tracks.length >= expectedCount && missingTrackNumbers.length === 0) {
		return;
	}

	const missingPart =
		missingTrackNumbers.length > 0
			? ` Missing track number(s): ${missingTrackNumbers.join(', ')}.`
			: '';
	console.warn(
		`[Worker] Album ${albumId} metadata incomplete: received ${tracks.length}/${expectedCount} track item(s).${missingPart}`
	);
}

async function downloadAlbumTrackWithPolicy(options: {
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
				experimentalMusicBrainzTagging: options.experimentalMusicBrainzTagging === true,
				strictMusicBrainzMatching: options.strictMusicBrainzMatching === true
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
		if (fallbackQuality && shouldAttemptQualityFallback(result)) {
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
		console.warn(
			`[Worker] Track ${options.trackId}: retrying after failure (${attempts}/${ALBUM_TRACK_MAX_ATTEMPTS}) in ${delayMs}ms: ${result.error ?? 'unknown'}`
		);
		await waitWithJitter(delayMs);
		continue;
	}
}

/**
 * Process an album job
 */
async function processAlbumJob(job: QueuedJob): Promise<void> {
	const albumJob = job.job as AlbumJob;
	let stagingRoot: string | undefined;

	await updateJobStatus(job.id, {
		status: 'processing',
		startedAt: Date.now(),
		progress: 0,
		error: undefined,
		failureCode: undefined,
		cancellationRequested: false
	});

	try {
		try {
			await refreshApiTargetsIfStale();
		} catch (refreshError) {
			console.warn(
				'[Worker] API target refresh failed, continuing with cached targets:',
				refreshError
			);
		}

		// Fetch album with target rotation (server-safe direct fetch, not browser proxy)
		const targets =
			API_CONFIG.targets.length > 0
				? API_CONFIG.targets
				: [
						{
							name: 'default',
							baseUrl: API_CONFIG.baseUrl || 'https://triton.squid.wtf',
							weight: 1,
							requiresProxy: false,
							category: 'auto-only' as const
						}
					];

		const healthyTargets = targets.filter((t) => !isTargetTemporarilyDown(t.name));
		const selectedTargets = healthyTargets.length > 0 ? healthyTargets : targets;
		const rateAllowedTargets = selectedTargets.filter((t) => rateLimiter.isRequestAllowed(t.name));
		if (rateAllowedTargets.length === 0 && selectedTargets.length > 0) {
			console.warn('[Worker] All API targets are rate-limited; falling back to full list.');
		}

		if (selectedTargets.length === 0) {
			throw new Error('No API targets available for album fetch');
		}

		let albumData: {
			album: Record<string, unknown>;
			tracks: Array<Record<string, unknown>>;
		} | null = null;
		let lastError: Error | null = null;
		const rotatedTargets = rotateTargets(
			rateAllowedTargets.length > 0 ? rateAllowedTargets : selectedTargets,
			albumTargetCursor++
		);

		// Try up to 3 targets with 10s timeout per target (30s max total)
		const maxAttempts = Math.min(3, rotatedTargets.length);
		for (let i = 0; i < maxAttempts; i++) {
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
			const target = rotatedTargets[i];
			try {
				const albumUrl = `${target.baseUrl}/album/?id=${albumJob.albumId}`;
				console.log(
					`[Worker] Album ${albumJob.albumId}: Trying ${target.name} (${target.baseUrl})`
				);

				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 10_000); // 10s per target

				let albumResponse: Response;
				try {
					albumResponse = await globalThis.fetch(albumUrl, { signal: controller.signal });
				} finally {
					clearTimeout(timeout);
				}

				if (!albumResponse.ok) {
					const statusText = albumResponse.statusText || '';
					const errorBody = await albumResponse.text().catch(() => '');
					const bodySnippet = errorBody.trim().slice(0, 300);
					const statusSummary = `HTTP ${albumResponse.status}${statusText ? ` ${statusText}` : ''} from ${target.name}`;
					const logSummary = bodySnippet
						? `${statusSummary}: ${bodySnippet}`
						: `${statusSummary} (no body)`;
					console.warn(`[Worker] ${logSummary}`);
					lastError = new Error(bodySnippet ? `${statusSummary} - ${bodySnippet}` : statusSummary);

					if (albumResponse.status === 429) {
						const { backoffMs } = rateLimiter.recordError(target.name, 'rate_limit');
						markTargetDown(
							target.name,
							'rate limited',
							backoffMs > 0 ? backoffMs : HEALTH_BACKOFF_MS.rateLimit
						);
					} else if (albumResponse.status >= 500) {
						const { backoffMs } = rateLimiter.recordError(target.name, 'server_error');
						markTargetDown(
							target.name,
							'server error',
							backoffMs > 0 ? backoffMs : HEALTH_BACKOFF_MS.serverError
						);
					}

					continue;
				}

				const responseData = await albumResponse.json();
				albumData = parseAlbumResponse(responseData);
				rateLimiter.recordSuccess(target.name);
				console.log(`[Worker] Album ${albumJob.albumId}: Successfully fetched from ${target.name}`);
				break; // Success!
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				console.warn(`[Worker] Target ${target.name} failed: ${lastError.message}`);

				if (lastError.name === 'AbortError') {
					const { backoffMs } = rateLimiter.recordError(target.name, 'network');
					markTargetDown(
						target.name,
						'timeout',
						backoffMs > 0 ? backoffMs : HEALTH_BACKOFF_MS.timeout
					);
				} else {
					const { backoffMs } = rateLimiter.recordError(target.name, 'network');
					markTargetDown(
						target.name,
						'network error',
						backoffMs > 0 ? backoffMs : HEALTH_BACKOFF_MS.serverError
					);
				}
				// Continue to next target
			}
		}

		if (!albumData) {
			throw lastError || new Error('All targets failed to fetch album');
		}

		const { album, tracks } = albumData;
		warnIfAlbumTrackListIncomplete(albumJob.albumId, album, tracks);
		const totalTracks = tracks.length;

		if (totalTracks === 0) {
			throw new Error('Album has no tracks');
		}

		const artistName =
			albumJob.artistName ||
			(album.artist && typeof album.artist === 'object' && 'name' in album.artist
				? String((album.artist as { name: unknown }).name)
				: undefined) ||
			'Unknown Artist';

		const albumTitle =
			(typeof album.title === 'string' ? album.title : undefined) || 'Unknown Album';
		const artistDirName = sanitizeDirName(artistName);
		const albumDirName = sanitizeDirName(albumTitle);
		stagingRoot = buildAlbumStagingRoot(job.id);
		const stagingAlbumDir = path.join(stagingRoot, artistDirName, albumDirName);
		await ensureDir(stagingAlbumDir);
		console.log(`[Worker] Album ${albumJob.albumId}: staging download in ${stagingAlbumDir}`);

		await updateJobStatus(job.id, {
			job: { ...job.job, albumTitle, artistName },
			trackCount: totalTracks,
			completedTracks: 0
		});

		// Extract cover art URL
		let coverUrl: string | undefined;
		if (album.cover && typeof album.cover === 'string') {
			const coverId = album.cover;
			coverUrl = `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/1280x1280.jpg`;
			console.log(`[Worker] Found cover art: ${coverId}`);
		}

		if (coverUrl) {
			const coverResult = await downloadCoverToDir(coverUrl, stagingAlbumDir);
			if (coverResult) {
				console.log(`[Worker] Album ${albumJob.albumId}: cover downloaded to staging`);
			}
		}

		let completedTracks = 0;
		let failedTracks = 0;
		const startTime = Date.now();
		const expectedTracks: ExpectedAlbumTrack[] = tracks.map((track, idx) => ({
			trackId: typeof track.id === 'number' ? track.id : 0,
			trackTitle: (typeof track.title === 'string' ? track.title : undefined) || `Track ${idx + 1}`,
			trackNumber: typeof track.trackNumber === 'number' ? track.trackNumber : idx + 1
		}));
		const publishedFilenameByTrackId = new Map<number, string>();

		const trackProgress = expectedTracks.map((track) => ({
			trackId: track.trackId,
			trackTitle: track.trackTitle,
			status: 'pending' as 'pending' | 'downloading' | 'completed' | 'failed',
			error: undefined as string | undefined
		}));

		await updateJobStatus(job.id, { trackProgress });

		// ALBUM FAILURE POLICY:
		// If ANY track fails to download, the entire album is marked as 'failed'.
		// This prevents silent partial downloads where some tracks are missing.
		// UI must handle failed albums with clear indication and retry/delete options.
		// This is intentional to maintain data integrity.

		const requestedConcurrency = Number(
			process.env.ALBUM_TRACK_CONCURRENCY || DEFAULT_ALBUM_TRACK_CONCURRENCY
		);
		const albumConcurrency = Math.max(
			1,
			Math.min(
				MAX_CONCURRENT,
				Number.isFinite(requestedConcurrency) ? requestedConcurrency : 6,
				tracks.length
			)
		);
		console.log(
			`[Worker] Album ${albumJob.albumId}: track concurrency ${albumConcurrency}/${MAX_CONCURRENT} (total ${totalTracks})`
		);
		if (Number.isFinite(requestedConcurrency) && requestedConcurrency > MAX_CONCURRENT) {
			console.log(
				`[Worker] Album ${albumJob.albumId}: ALBUM_TRACK_CONCURRENCY=${requestedConcurrency} capped by WORKER_MAX_CONCURRENT=${MAX_CONCURRENT}`
			);
		}

		let nextIndex = 0;
		let inFlight = 0;
		let requestedTerminalState: 'cancelled' | 'paused' | null = null;
		const terminalAlbumFailureState: {
			value: {
				trackId: number;
				error: string;
				errorCategory?: ErrorCategory;
			} | null;
		} = { value: null };
		const processNextTrack = async (): Promise<void> => {
			while (true) {
				if (requestedTerminalState || terminalAlbumFailureState.value) return;
				const requestedStop = await shouldStopJob(job.id);
				if (requestedStop) {
					requestedTerminalState = requestedStop;
					return;
				}

				const i = nextIndex++;
				if (i >= tracks.length) return;

				const track = tracks[i];
				const trackId = typeof track.id === 'number' ? track.id : 0;
				const trackTitle =
					(typeof track.title === 'string' ? track.title : undefined) || 'Unknown Track';
				const trackNumber = typeof track.trackNumber === 'number' ? track.trackNumber : i + 1;

				if (!trackId) {
					const externalError = 'Invalid track ID in album payload';
					console.warn(`[Worker] Album ${albumJob.albumId}: ${externalError} at index ${i}`);
					failedTracks++;
					trackProgress[i].status = 'failed';
					trackProgress[i].error = externalError;
					if (!terminalAlbumFailureState.value) {
						terminalAlbumFailureState.value = {
							trackId: 0,
							error: externalError,
							errorCategory: 'api_error'
						};
					}
					const processed = completedTracks + failedTracks;
					await updateJobStatus(job.id, {
						progress: processed / totalTracks,
						completedTracks,
						trackProgress
					});
					return;
				}

				trackProgress[i].status = 'downloading';
				await updateJobStatus(job.id, { trackProgress });

				inFlight += 1;
				console.log(
					`[Worker] Album ${albumJob.albumId}: in-flight ${inFlight}/${albumConcurrency} (track ${trackId})`
				);

				let result: {
					success: boolean;
					error?: string;
					errorCategory?: ErrorCategory;
					retries: number;
					attempts: number;
					finalQuality: AudioQuality;
					terminalExternal: boolean;
					filepath?: string;
				};
				try {
					result = await downloadAlbumTrackWithPolicy({
						trackId,
						quality: albumJob.quality,
						albumTitle,
						artistName,
						trackTitle,
						trackNumber,
						coverUrl,
						outputBaseDir: stagingRoot,
						experimentalMusicBrainzTagging: albumJob.experimentalMusicBrainzTagging === true,
						strictMusicBrainzMatching: albumJob.strictMusicBrainzMatching === true,
						forceOverwrite: albumJob.forceOverwrite === true
					});
				} finally {
					inFlight = Math.max(0, inFlight - 1);
					console.log(
						`[Worker] Album ${albumJob.albumId}: in-flight ${inFlight}/${albumConcurrency} (track ${trackId} done)`
					);
				}

				if (result.success) {
					completedTracks++;
					trackProgress[i].status = 'completed';
					if (result.filepath) {
						publishedFilenameByTrackId.set(trackId, path.basename(result.filepath));
					}
				} else {
					failedTracks++;
					trackProgress[i].status = 'failed';
					trackProgress[i].error = result.error;
					if (result.terminalExternal && !terminalAlbumFailureState.value) {
						terminalAlbumFailureState.value = {
							trackId,
							error: result.error ?? 'External error',
							errorCategory: result.errorCategory
						};
						console.error(
							`[Worker] Album ${albumJob.albumId}: terminal track failure on ${trackId} after ${result.attempts} attempt(s): ${terminalAlbumFailureState.value.error}`
						);
					}
				}

				const processed = completedTracks + failedTracks;
				await updateJobStatus(job.id, {
					progress: processed / totalTracks,
					completedTracks,
					trackProgress
				});
			}
		};

		const workers = Array.from({ length: Math.min(albumConcurrency, tracks.length) }, () =>
			processNextTrack()
		);
		await Promise.all(workers);

		if (requestedTerminalState) {
			if (requestedTerminalState === 'cancelled') {
				await updateJobStatus(job.id, {
					status: 'cancelled',
					completedAt: Date.now(),
					progress: totalTracks > 0 ? completedTracks / totalTracks : 0,
					completedTracks
				});
				return;
			}
			await updateJobStatus(job.id, {
				status: 'paused',
				progress: totalTracks > 0 ? completedTracks / totalTracks : 0,
				completedTracks
			});
			return;
		}

		const duration = Date.now() - startTime;
		const terminalAlbumFailure = terminalAlbumFailureState.value;
		if (terminalAlbumFailure) {
			const failureMessage =
				terminalAlbumFailure.trackId > 0
					? `Album removed due external error on track ${terminalAlbumFailure.trackId}: ${terminalAlbumFailure.error}`
					: `Album removed due external error: ${terminalAlbumFailure.error}`;
			for (const track of trackProgress) {
				if (track.status === 'pending' || track.status === 'downloading') {
					track.status = 'failed';
					track.error = failureMessage;
				}
			}
			completedTracks = trackProgress.filter((track) => track.status === 'completed').length;
			failedTracks = trackProgress.filter((track) => track.status === 'failed').length;
			await updateJobStatus(job.id, {
				trackProgress,
				progress: totalTracks > 0 ? completedTracks / totalTracks : 0,
				completedTracks
			});
			const terminalCategory = terminalAlbumFailure.errorCategory ?? 'api_error';
			await failOrRequeueAlbumJob({
				job,
				errorMessage: failureMessage,
				errorCategory: terminalCategory,
				downloadTimeMs: duration,
				completedTracks,
				totalTracks,
				trackProgress
			});
			return;
		}

		if (failedTracks > 0) {
			// ANY track failure = album failure (no partial albums allowed)
			// This ensures albums are either complete or marked as failed for retry/deletion
			const errorMessage =
				failedTracks === totalTracks
					? 'All tracks failed'
					: `Album incomplete: ${failedTracks} of ${totalTracks} tracks could not be downloaded`;
			await failOrRequeueAlbumJob({
				job,
				errorMessage,
				errorCategory: 'api_error',
				downloadTimeMs: duration,
				completedTracks,
				totalTracks,
				trackProgress
			});
			return;
		} else {
			if (!stagingRoot) {
				throw new Error('Album staging root missing before publish');
			}
			const publishLock = await acquireMediaMaintenanceLock({
				owner: `worker:publish:${job.id}`,
				waitTimeoutMs: MEDIA_LIBRARY_PUBLISH_LOCK_WAIT_MS
			});
			if (!publishLock) {
				throw new Error(
					'Media-library maintenance lock busy; cannot publish album while maintenance is active'
				);
			}
			try {
				const finalAlbumDir = path.join(getDownloadDir(), artistDirName, albumDirName);
				await publishAlbumFromStaging({
					jobId: job.id,
					stagingRoot,
					artistDirName,
					albumDirName
				});

				const validExpectedTracks = expectedTracks.filter((track) => track.trackId > 0);
				const reconciliation = await reconcilePublishedAlbum({
					quality: albumJob.quality,
					artistName,
					albumTitle,
					coverUrl,
					forceOverwrite: albumJob.forceOverwrite === true,
					experimentalMusicBrainzTagging: albumJob.experimentalMusicBrainzTagging === true,
					strictMusicBrainzMatching: albumJob.strictMusicBrainzMatching === true,
					finalAlbumDir,
					expectedTracks: validExpectedTracks,
					expectedFileByTrackId: publishedFilenameByTrackId
				});
				if (!reconciliation.ok) {
					await failOrRequeueAlbumJob({
						job,
						errorMessage: reconciliation.reason,
						errorCategory: 'api_error',
						downloadTimeMs: duration,
						completedTracks,
						totalTracks,
						trackProgress
					});
					return;
				}
				await updateJobStatus(job.id, {
					status: 'completed',
					completedAt: Date.now(),
					downloadTimeMs: duration,
					progress: 1,
					error: undefined,
					errorCategory: undefined,
					failureCode: undefined
				});
			} finally {
				await publishLock.release();
			}
		}

		console.log(
			`[Worker] Album ${albumJob.albumId} completed: ${completedTracks}/${totalTracks} tracks`
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		let errorMsg = message;

		if (message.includes('abort') || message.includes('AbortError')) {
			errorMsg = 'Timeout fetching album data (tried 3 targets, 10s each)';
		} else if (message.includes('All targets failed')) {
			errorMsg = `${message} - check network connectivity and API availability`;
		} else if (message.includes('ECONNREFUSED')) {
			errorMsg = 'Connection refused - API targets not reachable';
		} else if (message.includes('ENOTFOUND')) {
			errorMsg = 'Host not found - DNS resolution failed for all targets';
		} else if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
			errorMsg = 'Connection timeout - all API targets took too long to respond';
		}

		console.error(`[Worker] Album ${albumJob.albumId} failed: ${errorMsg}`);
		const categorized = categorizeError(errorMsg);

		await failOrRequeueAlbumJob({
			job,
			errorMessage: errorMsg,
			errorCategory: categorized.category,
			retryAfterMs: categorized.retryAfterMs
		});
	} finally {
		await cleanupAlbumStaging(stagingRoot);
	}
}

/**
 * Process a single job with proper error handling
 */
async function processJob(jobId: string, job: QueuedJob): Promise<void> {
	const startTime = Date.now();

	try {
		if (job.job.type === 'track') {
			await processTrackJob(job);
		} else if (job.job.type === 'album') {
			await processAlbumJob(job);
		}

		// Check if processing took too long (shouldn't happen, but log it)
		const duration = Date.now() - startTime;
		if (duration > PROCESSING_TIMEOUT_MS) {
			console.warn(`[Worker] Job ${jobId} took ${duration}ms (over timeout)`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error(`[Worker] Job ${jobId} processing error:`, message);

		// Mark as failed if not already marked
		const currentJob = await getJob(jobId);
		if (currentJob && currentJob.status === 'processing') {
			await updateJobStatus(jobId, {
				status: 'failed',
				error: message,
				completedAt: Date.now()
			});
		}
	}
}

/**
 * Main worker loop - properly handles concurrency and timeouts
 */
async function workerLoop(): Promise<void> {
	console.log(`[Worker] Main loop started, max concurrent: ${MAX_CONCURRENT}`);
	while (!stopRequested) {
		try {
			// Cleanup stuck jobs periodically
			if (Math.random() < 0.05) {
				const cleanedStuck = await cleanupStuckJobs(PROCESSING_TIMEOUT_MS);
				if (cleanedStuck > 0) {
					console.log(`[Worker] Cleaned ${cleanedStuck} stuck jobs`);
				}
			}

			// Check if we can process more jobs
			if (activeSemaphore.size < MAX_CONCURRENT) {
				const job = await dequeueJob();

				if (job) {
					// Check for cancellation request before starting
					if (job.cancellationRequested) {
						await updateJobStatus(job.id, {
							status: 'cancelled',
							completedAt: Date.now()
						});
						console.log(`[Worker] Job ${job.id} cancelled before processing`);
						continue;
					}
					if (job.pauseRequested || job.status === 'paused') {
						await updateJobStatus(job.id, {
							status: 'paused',
							error: undefined
						});
						console.log(`[Worker] Job ${job.id} paused before processing`);
						continue;
					}

					// Create a promise for this job and track it
					const jobPromise = processJob(job.id, job).finally(() => {
						activeSemaphore.delete(job.id);
					});

					activeSemaphore.set(job.id, jobPromise);
					console.log(
						`[Worker] Started job ${job.id}, active: ${activeSemaphore.size}/${MAX_CONCURRENT}`
					);
				} else {
					// No jobs, wait before polling again
					await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
				}
			} else {
				// Max concurrent reached, wait a bit
				await new Promise((resolve) => setTimeout(resolve, 500));
			}

			// Periodic cleanup (every 100 iterations ≈ 200 seconds)
			if (Math.random() < 0.01) {
				const cleaned = await cleanupOldJobs();
				if (cleaned > 0) {
					console.log(`[Worker] Periodic cleanup removed ${cleaned} old jobs`);
				}
			}
		} catch (error) {
			console.error('[Worker] Loop error:', error);
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
	}

	// Wait for active downloads to finish
	let maxWaitCycles = 300; // Max 5 minutes wait
	while (activeSemaphore.size > 0 && maxWaitCycles > 0) {
		console.log(`[Worker] Waiting for ${activeSemaphore.size} active downloads to finish...`);
		await Promise.all(activeSemaphore.values()).catch((err) => {
			console.error('[Worker] Wait error:', err);
		});
		maxWaitCycles--;
		if (activeSemaphore.size > 0) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	if (activeSemaphore.size > 0) {
		console.warn(`[Worker] Stopped with ${activeSemaphore.size} jobs still processing`);
	}
	console.log('[Worker] Stopped');
	isRunning = false;
}

/**
 * Start the background worker
 */
export async function startWorker(): Promise<void> {
	if (isRunning) {
		console.log('[Worker] Already running');
		return;
	}

	console.log('[Worker] Starting...');

	// Initialize queue (recover from crashes)
	const { initializeQueue } = await import('./downloadQueueManager');
	await initializeQueue();
	await cleanupStaleAlbumStagingOnStartup();
	const startupSweepLock = await acquireMediaMaintenanceLock({
		owner: `worker:startup-sweep:${Date.now()}`,
		waitTimeoutMs: 0
	});
	if (startupSweepLock) {
		try {
			const transientSweep = await sweepTransientAlbumArtifacts({ dryRun: false });
			if (transientSweep.artifactDirsFound > 0) {
				console.log(
					`[Worker] Swept ${transientSweep.artifactDirsRemoved}/${transientSweep.artifactDirsFound} stale publish/backup folder(s) on startup (skipped active: ${transientSweep.skippedActive}, too fresh: ${transientSweep.skippedTooFresh})`
				);
			}
		} finally {
			await startupSweepLock.release();
		}
	} else {
		console.log(
			'[Worker] Skipping startup transient sweep: media-library maintenance lock is busy'
		);
	}

	isRunning = true;
	stopRequested = false;
	workerLoop();
}

/**
 * Stop the background worker
 */
export async function stopWorker(): Promise<void> {
	if (!isRunning) {
		return;
	}

	console.log('[Worker] Stopping...');
	stopRequested = true;

	// Wait for worker to stop
	while (isRunning) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

/**
 * Get worker status
 */
export function getWorkerStatus(): {
	running: boolean;
	activeDownloads: number;
	maxConcurrent: number;
} {
	return {
		running: isRunning,
		activeDownloads: activeSemaphore.size,
		maxConcurrent: MAX_CONCURRENT
	};
}

export const __test = {
	cleanupStaleAlbumStagingOnStartup,
	getAlbumStagingRoot: (): string => ALBUM_STAGING_ROOT,
	isDefinitiveExternalTrackFailure,
	deriveFailureCode,
	findMissingPublishedTracks
};
