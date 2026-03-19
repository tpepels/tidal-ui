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
	type AlbumJob,
	type ErrorCategory
} from './downloadQueueManager';
import {
	deriveFailureCode,
	findMissingPublishedTracks,
	isAlbumCategoryRetryable,
	isDefinitiveExternalTrackFailure,
	resetTrackProgressForAlbumRetry,
	type ExpectedAlbumTrack
} from './downloadQueueWorkerPolicy';
import { warnIfAlbumTrackListIncomplete } from './downloadQueueWorkerAlbumResponse';
import type { AudioQuality } from '$lib/types';
import { sweepTransientAlbumArtifacts } from './mediaLibrary';
import { clearMediaLibraryScanCache } from './mediaLibrary';
import { acquireMediaMaintenanceLock } from './mediaMaintenanceLock';
import { fetchAlbumWithTargetRotation } from './downloadQueueWorkerAlbumFetch';
import {
	buildAlbumStagingRoot,
	cleanupAlbumStaging,
	cleanupStaleAlbumStagingOnStartup,
	getAlbumStagingRoot,
	publishAlbumFromStaging
} from './downloadQueueWorkerStaging';
import { processTrackJob, downloadAlbumTrackWithPolicy } from './downloadQueueWorkerTrack';
import { shouldStopJob } from './downloadQueueWorkerControl';
import { downloadCoverToDir, ensureDir, getDownloadDir, sanitizeDirName } from '../../routes/api/download-track/_shared';

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
const ALBUM_RETRY_BASE_DELAY_MS = Math.max(
	1000,
	Number(process.env.ALBUM_RETRY_BASE_DELAY_MS || 5000)
);
const ALBUM_RETRY_MAX_DELAY_MS = Math.max(
	ALBUM_RETRY_BASE_DELAY_MS,
	Number(process.env.ALBUM_RETRY_MAX_DELAY_MS || 5 * 60 * 1000)
);
const DEFAULT_ALBUM_TRACK_CONCURRENCY = 2;
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

async function reconcilePublishedAlbum(params: {
	quality: AudioQuality;
	artistName: string;
	albumTitle: string;
	coverUrl?: string;
	forceOverwrite?: boolean;
	experimentalMusicBrainzTagging?: boolean;
	strictMusicBrainzMatching?: boolean;
	musicBrainzReleaseId?: string;
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
				experimentalMusicBrainzTagging: params.experimentalMusicBrainzTagging !== false,
				strictMusicBrainzMatching: params.strictMusicBrainzMatching === true,
				musicBrainzReleaseId: params.musicBrainzReleaseId,
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
		const albumData = await fetchAlbumWithTargetRotation(job.id, albumJob.albumId);
		if ('stopState' in albumData && albumData.stopState) {
			if (albumData.stopState === 'cancelled') {
				await updateJobStatus(job.id, {
					status: 'cancelled',
					completedAt: Date.now(),
					error: undefined
				});
				return;
			}
			await updateJobStatus(job.id, {
				status: 'paused',
				error: undefined
			});
			return;
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
		let preferredMusicBrainzReleaseId =
			typeof albumJob.musicBrainzReleaseId === 'string' &&
			albumJob.musicBrainzReleaseId.trim().length > 0
				? albumJob.musicBrainzReleaseId.trim()
				: undefined;
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
				if (!preferredMusicBrainzReleaseId) {
					const latestJob = await getJob(job.id);
					if (
						latestJob?.job.type === 'album' &&
						typeof latestJob.job.musicBrainzReleaseId === 'string' &&
						latestJob.job.musicBrainzReleaseId.trim().length > 0
					) {
						preferredMusicBrainzReleaseId = latestJob.job.musicBrainzReleaseId.trim();
					}
				}

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
						experimentalMusicBrainzTagging: albumJob.experimentalMusicBrainzTagging !== false,
						strictMusicBrainzMatching: albumJob.strictMusicBrainzMatching === true,
						musicBrainzReleaseId: preferredMusicBrainzReleaseId,
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
					experimentalMusicBrainzTagging: albumJob.experimentalMusicBrainzTagging !== false,
					strictMusicBrainzMatching: albumJob.strictMusicBrainzMatching === true,
					musicBrainzReleaseId: albumJob.musicBrainzReleaseId,
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
				clearMediaLibraryScanCache();
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
	getAlbumStagingRoot,
	isDefinitiveExternalTrackFailure,
	deriveFailureCode,
	findMissingPublishedTracks
};
