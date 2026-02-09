/**
 * Background worker for processing server-side download queue
 * Runs independently of browser sessions
 */

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

let isRunning = false;
let stopRequested = false;
const MAX_CONCURRENT = 4;
const POLL_INTERVAL_MS = 2000;
const PROCESSING_TIMEOUT_MS = 300000; // 5 minute max time in 'processing' state
const activeSemaphore = new Map<string, Promise<void>>();

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
	coverUrl?: string
): Promise<{ success: boolean; error?: string; filepath?: string; retryable?: boolean }> {
	try {
		console.log(`[Worker] Downloading track ${trackId} (${quality})`);
		
		const apiTarget = API_CONFIG.baseUrl || API_CONFIG.targets[0]?.baseUrl || 'unknown';
		
		// Call the server adapter directly (NO HTTP)
		const result = await downloadTrackServerSide({
			trackId,
			quality,
			albumTitle,
			artistName,
			trackTitle,
			trackNumber,
			coverUrl,
			conflictResolution: 'overwrite_if_different',
			apiClient: losslessAPI,
			fetch: globalThis.fetch
		});

		if (result.success) {
			// Record success for rate limiter
			rateLimiter.recordSuccess(apiTarget);
			console.log(`[Worker] Completed: ${result.filename || trackId}`);
			return { 
				success: true, 
				filepath: result.filepath
			};
		} else {
			// Categorize error to determine retry strategy
			const errorMsg = result.error || 'Download failed';
			const errorCategory = categorizeError(errorMsg, undefined);
			
			// Record rate limit errors
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
		// Fetch album tracks from the upstream Tidal proxy API
		const apiBaseUrl = API_CONFIG.baseUrl || API_CONFIG.targets[0]?.baseUrl;
		if (!apiBaseUrl) {
			throw new Error('No upstream API configured');
		}
		
		const albumUrl = `${apiBaseUrl}/album/?id=${albumJob.albumId}`;
		console.log(`[Worker] Album ${albumJob.albumId}: Fetching album data from ${apiBaseUrl}`);
		
		const albumResponse = await fetchWithTimeout(albumUrl, {});
		
		if (!albumResponse.ok) {
			let errorText = '';
			try {
				const contentType = albumResponse.headers.get('content-type');
				if (contentType?.includes('application/json')) {
					const errorData = await albumResponse.json();
					errorText = errorData.error || JSON.stringify(errorData);
				} else {
					errorText = await albumResponse.text();
				}
			} catch {
				errorText = 'Could not parse error response';
			}
			throw new Error(`Failed to fetch album: HTTP ${albumResponse.status}: ${errorText}`);
		}
		
		let responseData: unknown;
		try {
			responseData = await albumResponse.json();
		} catch (parseError) {
			throw new Error('Failed to parse album response as JSON: ' + (parseError instanceof Error ? parseError.message : 'Unknown error'));
		}
		
		const { album, tracks } = parseAlbumResponse(responseData);
		const totalTracks = tracks.length;
		
		if (totalTracks === 0) {
			throw new Error('Album has no tracks');
		}

		await updateJobStatus(job.id, {
			trackCount: totalTracks,
			completedTracks: 0
		});

		const artistName = albumJob.artistName || 
			(album.artist && typeof album.artist === 'object' && 'name' in album.artist 
				? String((album.artist as { name: unknown }).name) 
				: undefined) || 
			'Unknown Artist';
		const albumTitle = (typeof album.title === 'string' ? album.title : undefined) || 'Unknown Album';
		
		// Extract cover art URL
		let coverUrl: string | undefined;
		if (album.cover && typeof album.cover === 'string') {
			// Build cover URL from cover ID (format: uuid)
			const coverId = album.cover;
			coverUrl = `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/1280x1280.jpg`;
			console.log(`[Worker] Found cover art: ${coverId}`);
		}

		let completedTracks = 0;
		let failedTracks = 0;
		const startTime = Date.now();

		// Initialize per-track progress
		const trackProgress = tracks.map((track, idx) => ({
			trackId: typeof track.id === 'number' ? track.id : 0,
			trackTitle: (typeof track.title === 'string' ? track.title : undefined) || `Track ${idx + 1}`,
			status: 'pending' as const
		}));

		// Update job with initial track progress
		await updateJobStatus(job.id, {
			trackProgress
		});

		// Download tracks sequentially to avoid overwhelming the server
		for (let i = 0; i < tracks.length; i++) {
			const track = tracks[i];
			const trackId = typeof track.id === 'number' ? track.id : 0;
			const trackTitle = (typeof track.title === 'string' ? track.title : undefined) || 'Unknown Track';
			const trackNumber = typeof track.trackNumber === 'number' ? track.trackNumber : (i + 1);
			
			if (!trackId) {
				console.warn(`[Worker] Skipping track ${i} - invalid ID`);
				failedTracks++;
				trackProgress[i].status = 'failed';
				trackProgress[i].error = 'Invalid track ID';
				continue;
			}
			
			// Mark track as downloading
			trackProgress[i].status = 'downloading';
			
			const result = await downloadTrack(
				trackId,
				albumJob.quality,
				albumTitle,
				artistName,
				trackTitle,
				trackNumber,
				coverUrl
			);

			if (result.success) {
				completedTracks++;
				trackProgress[i].status = 'completed';
			} else {
				failedTracks++;
				trackProgress[i].status = 'failed';
				trackProgress[i].error = result.error;
			}

			// Update progress with per-track details
			await updateJobStatus(job.id, {
				progress: (i + 1) / totalTracks,
				completedTracks: completedTracks,
				trackProgress
			});
		}

		// Mark as completed or failed
		const duration = Date.now() - startTime;
		if (failedTracks === totalTracks) {
			await updateJobStatus(job.id, {
				status: 'failed',
				error: 'All tracks failed',
				completedAt: Date.now(),
				downloadTimeMs: duration
			});
		} else if (failedTracks > 0) {
			await updateJobStatus(job.id, {
				status: 'completed',
				error: `${failedTracks} of ${totalTracks} tracks failed`,
				completedAt: Date.now(),
				downloadTimeMs: duration,
				progress: 1
			});
		} else {
			await updateJobStatus(job.id, {
				status: 'completed',
				completedAt: Date.now(),
				downloadTimeMs: duration,
				progress: 1
			});
		}

		console.log(`[Worker] Album ${albumJob.albumId} completed: ${completedTracks}/${totalTracks} tracks`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		let errorMsg = message;
		
		if (message.includes('abort') || message.includes('AbortError')) {
			errorMsg = 'Timeout fetching album data (30s)';
		} else if (message.includes('ECONNREFUSED')) {
			errorMsg = 'Connection refused - API not reachable at ' + getInternalApiUrl();
		} else if (message.includes('ENOTFOUND')) {
			errorMsg = 'Host not found - DNS resolution failed for ' + getInternalApiUrl();
		} else if (message.includes('ETIMEDOUT')) {
			errorMsg = 'Connection timeout reaching ' + getInternalApiUrl();
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
