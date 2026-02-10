/**
 * Background worker for processing server-side download queue
 * Runs independently of browser sessions
 */

import * as path from 'path';
import {
	dequeueJob,
	updateJobStatus,
	cleanupOldJobs,
	cleanupStuckJobs,
	categorizeError,
	type QueuedJob,
	type TrackJob,
	type AlbumJob
} from './downloadQueueManager';
import { API_CONFIG } from '$lib/config';
import * as rateLimiter from './rateLimiter';
import type { AudioQuality } from '$lib/types';
import { losslessAPI } from '$lib/api';
import { downloadTrackServerSide } from './download/serverDownloadAdapter';
import { finalizeTrack } from '$lib/server/download/finalizeTrack';
import {
	downloadCoverToDir,
	ensureDir,
	getDownloadDir,
	sanitizePath
} from '../../routes/api/download-track/_shared';

let isRunning = false;
let stopRequested = false;
const MAX_CONCURRENT = Math.max(1, Number(process.env.WORKER_MAX_CONCURRENT || 6));
const POLL_INTERVAL_MS = 2000;
const PROCESSING_TIMEOUT_MS = 300000; // 5 minute max time in 'processing' state
const activeSemaphore = new Map<string, Promise<void>>();
const HEALTH_BACKOFF_MS = {
	rateLimit: 5 * 60 * 1000, // 5 minutes
	serverError: 3 * 60 * 1000, // 3 minutes
	timeout: 2 * 60 * 1000 // 2 minutes
};
const targetHealth = new Map<string, number>();

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
	options?: { downloadCover?: boolean }
): Promise<{ success: boolean; error?: string; filepath?: string; retryable?: boolean }> {
	try {
		console.log(`[Worker] Downloading track ${trackId} (${quality})`);
		
		const apiTarget = API_CONFIG.baseUrl || API_CONFIG.targets[0]?.baseUrl || 'unknown';
		
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
			conflictResolution: 'overwrite_if_different',
			apiClient: losslessAPI // Main branch's API client with all the tested logic
		});

		if (!result.success || !result.buffer || !result.trackLookup) {
			const errorMsg = result.error || 'Download failed';
			const errorCategory = categorizeError(errorMsg, undefined);

			if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
				rateLimiter.recordError(apiTarget, 'rate_limit');
			}

			console.error(`[Worker] Track ${trackId} failed: ${errorMsg}`);
			return {
				success: false,
				error: errorMsg,
				retryable: errorCategory.isRetryable
			};
		}

		const resolvedArtist =
			artistName ||
			result.trackLookup.track.artist?.name ||
			'Unknown Artist';
		const resolvedAlbum =
			albumTitle ||
			result.trackLookup.track.album?.title ||
			'Unknown Album';
		const lookupTitle = result.trackLookup.track.title;
		const lookupVersion = result.trackLookup.track.version;
		const computedTitle = lookupTitle
			? lookupVersion
				? `${lookupTitle} (${lookupVersion})`
				: lookupTitle
			: undefined;
		const resolvedTitle = trackTitle || computedTitle || 'Unknown Track';
		const resolvedTrackNumber =
			trackNumber || Number(result.trackLookup.track.trackNumber) || undefined;

		const finalizeResult = await finalizeTrack({
			trackId,
			quality,
			albumTitle: resolvedAlbum,
			artistName: resolvedArtist,
			trackTitle: resolvedTitle,
			trackNumber: resolvedTrackNumber,
			trackLookup: result.trackLookup,
			buffer: result.buffer,
			conflictResolution: 'overwrite_if_different',
			detectedMimeType: result.mimeType,
			downloadCoverSeperately: options?.downloadCover ?? true,
			coverUrl
		});

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
		console.error(`[Worker] Track ${trackId} failed: ${message}`);
		return { 
			success: false, 
			error: message,
			retryable: false
		};
	}
}

/**
 * Process a track job with retry logic
 */
async function processTrackJob(job: QueuedJob): Promise<void> {
	const trackJob = job.job as TrackJob;
	const startTime = Date.now();
	
	await updateJobStatus(job.id, { 
		status: 'processing', 
		startedAt: startTime,
		progress: 0
	});

	const result = await downloadTrack(
		trackJob.trackId,
		trackJob.quality,
		trackJob.albumTitle,
		trackJob.artistName,
		trackJob.trackTitle,
		trackJob.trackNumber,
		trackJob.coverUrl
	);

	if (result.success) {
		const duration = Date.now() - startTime;
		await updateJobStatus(job.id, {
			status: 'completed',
			progress: 1,
			completedAt: Date.now(),
			downloadTimeMs: duration
		});
	} else {
		// Handle retryable errors
		if (result.retryable && (!job.maxRetries || job.retryCount! < job.maxRetries)) {
			const retryCount = (job.retryCount || 0) + 1;
			const backoffMs = (job.job as TrackJob).type === 'track' ? 
				Math.min(5000 * retryCount, 300000) : // Cap at 5 minutes
				5000;
			
			console.log(`[Worker] Job ${job.id} retryable, scheduling retry in ${backoffMs}ms (attempt ${retryCount}/${job.maxRetries})`);
			
			await updateJobStatus(job.id, {
				status: 'queued',
				progress: 0,
				error: result.error,
				errorCategory: 'network', // Will be categorized properly on next attempt
				retryCount,
				nextRetryAt: Date.now() + backoffMs,
				lastError: result.error
			});
		} else {
			// Non-retryable or max retries exceeded
			const errorCategory = result.retryable ? 'unknown' : 'api_error';
			
			await updateJobStatus(job.id, {
				status: 'failed',
				error: result.error,
				errorCategory,
				completedAt: Date.now()
			});
		}
	}
}

/**
 * Parse album response data which can be in multiple formats
 */
function parseAlbumResponse(data: unknown): { album: Record<string, unknown>; tracks: Array<Record<string, unknown>> } {
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
				const firstTrack = (firstItem && typeof firstItem === 'object' && 'item' in firstItem) 
					? (firstItem as { item: unknown }).item 
					: firstItem;
				
				if (firstTrack && typeof firstTrack === 'object' && 'album' in firstTrack) {
					const albumData = (firstTrack as { album?: unknown }).album;
					if (!albumData || typeof albumData !== 'object') {
						throw new Error('Invalid album data in API response');
					}
					const album = albumData as Record<string, unknown>;
					
					const tracks = items.map((i: unknown) => {
						if (!i || typeof i !== 'object') return null;
						const item = ('item' in i) ? (i as { item: unknown }).item : i;
						if (!item || typeof item !== 'object') return null;
						const track = item as Record<string, unknown>;
						// Validate track has required fields
						if (!track.id || typeof track.id !== 'number') return null;
						return track;
					}).filter((t): t is Record<string, unknown> => t !== null);
					
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
		if (!trackCollection && 'items' in entry && Array.isArray((entry as { items?: unknown[] }).items)) {
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
			
			const trackObj = ('item' in rawItem && rawItem.item && typeof rawItem.item === 'object')
				? rawItem.item as Record<string, unknown>
				: rawItem as Record<string, unknown>;
			
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

/**
 * Process an album job
 */
async function processAlbumJob(job: QueuedJob): Promise<void> {
	const albumJob = job.job as AlbumJob;

	await updateJobStatus(job.id, { 
		status: 'processing', 
		startedAt: Date.now(),
		progress: 0
	});

	try {
		// Fetch album with target rotation (server-safe direct fetch, not browser proxy)
		const targets = API_CONFIG.targets.length > 0 
			? API_CONFIG.targets 
			: [{ name: 'default', baseUrl: API_CONFIG.baseUrl || 'https://triton.squid.wtf', weight: 1, requiresProxy: false, category: 'auto-only' as const }];

		const healthyTargets = targets.filter(t => !isTargetTemporarilyDown(t.name));
		const selectedTargets = healthyTargets.length > 0 ? healthyTargets : targets;

		if (selectedTargets.length === 0) {
			throw new Error('No API targets available for album fetch');
		}
		
		let albumData: { album: Record<string, unknown>; tracks: Array<Record<string, unknown>> } | null = null;
		let lastError: Error | null = null;
		
		// Try up to 3 targets with 10s timeout per target (30s max total)
		const maxAttempts = Math.min(3, selectedTargets.length);
		for (let i = 0; i < maxAttempts; i++) {
			const target = selectedTargets[i];
			try {
				const albumUrl = `${target.baseUrl}/album/?id=${albumJob.albumId}`;
				console.log(`[Worker] Album ${albumJob.albumId}: Trying ${target.name} (${target.baseUrl})`);
				
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
					const logSummary = bodySnippet ? `${statusSummary}: ${bodySnippet}` : `${statusSummary} (no body)`;
					console.warn(`[Worker] ${logSummary}`);
					lastError = new Error(bodySnippet ? `${statusSummary} - ${bodySnippet}` : statusSummary);

					if (albumResponse.status === 429) {
						markTargetDown(target.name, 'rate limited', HEALTH_BACKOFF_MS.rateLimit);
					} else if (albumResponse.status >= 500) {
						markTargetDown(target.name, 'server error', HEALTH_BACKOFF_MS.serverError);
					}

					continue;
				}
				
				const responseData = await albumResponse.json();
				albumData = parseAlbumResponse(responseData);
				console.log(`[Worker] Album ${albumJob.albumId}: Successfully fetched from ${target.name}`);
				break; // Success!
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				console.warn(`[Worker] Target ${target.name} failed: ${lastError.message}`);

				if (lastError.name === 'AbortError') {
					markTargetDown(target.name, 'timeout', HEALTH_BACKOFF_MS.timeout);
				} else {
					markTargetDown(target.name, 'network error', HEALTH_BACKOFF_MS.serverError);
				}
				// Continue to next target
			}
		}
		
		if (!albumData) {
			throw lastError || new Error('All targets failed to fetch album');
		}
		
		const { album, tracks } = albumData;
		const totalTracks = tracks.length;

		if (totalTracks === 0) {
			throw new Error('Album has no tracks');
		}

		const artistName =
			albumJob.artistName ||
			(album.artist &&
			typeof album.artist === 'object' &&
			'name' in album.artist
				? String((album.artist as { name: unknown }).name)
				: undefined) ||
			'Unknown Artist';

		const albumTitle =
			(typeof album.title === 'string' ? album.title : undefined) || 'Unknown Album';

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
			const coverDir = path.join(
				getDownloadDir(),
				sanitizePath(artistName),
				sanitizePath(albumTitle)
			);
			await ensureDir(coverDir);
			const coverResult = await downloadCoverToDir(coverUrl, coverDir);
			if (coverResult) {
				console.log(`[Worker] Album ${albumJob.albumId}: cover downloaded once`);
			}
		}

		let completedTracks = 0;
		let failedTracks = 0;
		const startTime = Date.now();

		const trackProgress = tracks.map((track, idx) => ({
			trackId: typeof track.id === 'number' ? track.id : 0,
			trackTitle:
				(typeof track.title === 'string' ? track.title : undefined) ||
				`Track ${idx + 1}`,
			status: 'pending' as 'pending' | 'downloading' | 'completed' | 'failed',
			error: undefined as string | undefined
		}));

		await updateJobStatus(job.id, { trackProgress });

		// ALBUM FAILURE POLICY: 
		// If ANY track fails to download, the entire album is marked as 'failed'.
		// This prevents silent partial downloads where some tracks are missing.
		// UI must handle failed albums with clear indication and retry/delete options.
		// This is intentional to maintain data integrity.
		
		const requestedConcurrency = Number(process.env.ALBUM_TRACK_CONCURRENCY || 6);
		const albumConcurrency = Math.max(
			1,
			Math.min(MAX_CONCURRENT, Number.isFinite(requestedConcurrency) ? requestedConcurrency : 6, tracks.length)
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
		const processNextTrack = async (): Promise<void> => {
			while (true) {
				const i = nextIndex++;
				if (i >= tracks.length) return;

				const track = tracks[i];
				const trackId = typeof track.id === 'number' ? track.id : 0;
				const trackTitle =
					(typeof track.title === 'string' ? track.title : undefined) ||
					'Unknown Track';
				const trackNumber =
					typeof track.trackNumber === 'number' ? track.trackNumber : i + 1;

				if (!trackId) {
					console.warn(`[Worker] Skipping track ${i} - invalid ID`);
					failedTracks++;
					trackProgress[i].status = 'failed';
					trackProgress[i].error = 'Invalid track ID';
					const processed = completedTracks + failedTracks;
					await updateJobStatus(job.id, {
						progress: processed / totalTracks,
						completedTracks,
						trackProgress
					});
					continue;
				}

				trackProgress[i].status = 'downloading';
				await updateJobStatus(job.id, { trackProgress });

				inFlight += 1;
				console.log(
					`[Worker] Album ${albumJob.albumId}: in-flight ${inFlight}/${albumConcurrency} (track ${trackId})`
				);

				let result: { success: boolean; error?: string };
				try {
					result = await downloadTrack(
						trackId,
						albumJob.quality,
						albumTitle,
						artistName,
						trackTitle,
						trackNumber,
						coverUrl,
						{ downloadCover: false }
					);
				} finally {
					inFlight = Math.max(0, inFlight - 1);
					console.log(
						`[Worker] Album ${albumJob.albumId}: in-flight ${inFlight}/${albumConcurrency} (track ${trackId} done)`
					);
				}

				if (result.success) {
					completedTracks++;
					trackProgress[i].status = 'completed';
				} else {
					failedTracks++;
					trackProgress[i].status = 'failed';
					trackProgress[i].error = result.error;
				}

				const processed = completedTracks + failedTracks;
				await updateJobStatus(job.id, {
					progress: processed / totalTracks,
					completedTracks,
					trackProgress
				});
			}
		};

		const workers = Array.from(
			{ length: Math.min(albumConcurrency, tracks.length) },
			() => processNextTrack()
		);
		await Promise.all(workers);

		const duration = Date.now() - startTime;

		if (failedTracks > 0) {
			// ANY track failure = album failure (no partial albums allowed)
			// This ensures albums are either complete or marked as failed for retry/deletion
			await updateJobStatus(job.id, {
				status: 'failed',
				error: failedTracks === totalTracks 
					? 'All tracks failed'
					: `Album incomplete: ${failedTracks} of ${totalTracks} tracks could not be downloaded`,
				completedAt: Date.now(),
				downloadTimeMs: duration,
				progress: completedTracks / totalTracks
			});
		} else {
			await updateJobStatus(job.id, {
				status: 'completed',
				completedAt: Date.now(),
				downloadTimeMs: duration,
				progress: 1
			});
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

		await updateJobStatus(job.id, {
			status: 'failed',
			error: errorMsg,
			completedAt: Date.now()
		});
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
		const currentJob = await import('./downloadQueueManager').then(m => m.getJob(jobId));
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
					
					// Create a promise for this job and track it
					const jobPromise = processJob(job.id, job)
						.finally(() => {
							activeSemaphore.delete(job.id);
						});
					
					activeSemaphore.set(job.id, jobPromise);
					console.log(`[Worker] Started job ${job.id}, active: ${activeSemaphore.size}/${MAX_CONCURRENT}`);
				} else {
					// No jobs, wait before polling again
					await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
				}
			} else {
				// Max concurrent reached, wait a bit
				await new Promise(resolve => setTimeout(resolve, 500));
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
			await new Promise(resolve => setTimeout(resolve, 5000));
		}
	}

	// Wait for active downloads to finish
	let maxWaitCycles = 300; // Max 5 minutes wait
	while (activeSemaphore.size > 0 && maxWaitCycles > 0) {
		console.log(`[Worker] Waiting for ${activeSemaphore.size} active downloads to finish...`);
		await Promise.all(activeSemaphore.values()).catch(err => {
			console.error('[Worker] Wait error:', err);
		});
		maxWaitCycles--;
		if (activeSemaphore.size > 0) {
			await new Promise(resolve => setTimeout(resolve, 1000));
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
		await new Promise(resolve => setTimeout(resolve, 100));
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
