/**
 * Background worker for processing server-side download queue
 * Runs independently of browser sessions
 */

import {
	dequeueJob,
	updateJobStatus,
	cleanupOldJobs,
	type QueuedJob,
	type TrackJob,
	type AlbumJob
} from './downloadQueueManager';
import type { AudioQuality } from '$lib/types';

let isRunning = false;
let stopRequested = false;
const MAX_CONCURRENT = 4;
const POLL_INTERVAL_MS = 2000;
const JOB_TIMEOUT_MS = 30000; // 30 second timeout per network call
const PROCESSING_TIMEOUT_MS = 300000; // 5 minute max time in 'processing' state
let activeDownloads = 0;
const activeSemaphore = new Map<string, Promise<void>>();

/**
 * Build internal API URL - use HTTPS with self-signed cert handling
 */
function getInternalApiUrl(): string {
	if (process.env.INTERNAL_API_URL) {
		console.log('[Worker] Using INTERNAL_API_URL:', process.env.INTERNAL_API_URL);
		return process.env.INTERNAL_API_URL;
	}
	
	const port = process.env.PORT || 5000;
	const url = `https://localhost:${port}`;
	console.log('[Worker] Using default internal API URL:', url, '(HTTPS with self-signed cert)');
	return url;
}

/**
 * Get Node.js HTTPS agent for self-signed certificates
 */
async function getHttpsAgent() {
	const https = await import('https');
	return new https.Agent({ 
		rejectUnauthorized: false // Allow self-signed certs on localhost
	});
}

/**
 * Wrapper for fetch with timeout and detailed error logging
 */
async function fetchWithTimeout(
	url: string,
	options: RequestInit,
	timeoutMs: number = JOB_TIMEOUT_MS
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	console.log(`[Worker] Fetch ${options.method || 'GET'} ${url}`);
	
	try {
		// For HTTPS URLs with self-signed certs, use https module directly
		if (url.startsWith('https://')) {
			const https = await import('https');
			const agent = new https.Agent({ rejectUnauthorized: false });
			
			return new Promise((resolve, reject) => {
				const urlObj = new URL(url);
				const reqOptions = {
					method: options.method || 'GET',
					agent,
					signal: controller.signal,
					headers: options.headers || {}
				};
				
				const req = https.request(urlObj, reqOptions, (res) => {
					let data = '';
					res.on('data', chunk => data += chunk);
					res.on('end', () => {
						console.log(`[Worker] Response ${res.statusCode} from ${url}`);
						
						// Create a Response-like object
						const response = new Response(data, {
							status: res.statusCode,
							headers: res.headers
						});
						resolve(response);
					});
				});
				
				req.on('error', reject);
				
				if (options.body) {
					req.write(options.body);
				}
				req.end();
			});
		} else {
			// HTTP URLs work normally
			const response = await fetch(url, {
				...options,
				signal: controller.signal
			});
			
			console.log(`[Worker] Response ${response.status} from ${url}`);
			return response;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[Worker] Fetch error for ${url}: ${message}`);
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Download a single track by calling the internal API
 * This reuses all the proven download logic from the API endpoint
 */
async function downloadTrack(
	trackId: number,
	quality: AudioQuality,
	albumTitle?: string,
	artistName?: string,
	trackTitle?: string
): Promise<{ success: boolean; error?: string; filepath?: string }> {
	try {
		console.log(`[Worker] Downloading track ${trackId} (${quality})`);
		
		// Call the internal /api/internal/download-track endpoint which:
		// - Fetches from TIDAL via the proxy
		// - Saves to server downloads directory
		// - Embeds metadata
		// - Downloads cover art
		
		const baseUrl = getInternalApiUrl();
		const url = `${baseUrl}/api/internal/download-track`;
		
		const body = {
			trackId,
			quality,
			albumTitle,
			artistName,
			trackTitle,
			conflictResolution: 'overwrite_if_different' as const
		};

		const response = await fetchWithTimeout(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			let errorText = '';
			try {
				const contentType = response.headers.get('content-type');
				if (contentType?.includes('application/json')) {
					const errorData = await response.json();
					errorText = errorData.error || JSON.stringify(errorData);
				} else {
					errorText = await response.text();
				}
			} catch (e) {
				errorText = 'Could not parse error response';
			}
			const errorMsg = `HTTP ${response.status}: ${errorText || 'No details'}`;
			console.error(`[Worker] Track ${trackId} failed: ${errorMsg}`);
			return { 
				success: false, 
				error: errorMsg
			};
		}

		const result = await response.json();
		
		if (result.success) {
			console.log(`[Worker] Completed: ${result.filename || trackId}`);
			return { 
				success: true, 
				filepath: result.filepath 
			};
		} else {
			return { 
				success: false, 
				error: result.error || 'Download failed' 
			};
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		let errorMsg = message;
		
		if (message.includes('abort') || message.includes('AbortError')) {
			errorMsg = 'Timeout (30s)';
		} else if (message.includes('ECONNREFUSED')) {
			errorMsg = 'Connection refused - API not reachable';
		} else if (message.includes('ENOTFOUND')) {
			errorMsg = 'Host not found - DNS resolution failed';
		} else if (message.includes('ETIMEDOUT')) {
			errorMsg = 'Connection timeout';
		}
		
		console.error(`[Worker] Track ${trackId} failed: ${errorMsg}`);
		return { success: false, error: errorMsg };
	}
}

/**
 * Process a track job
 */
async function processTrackJob(job: QueuedJob): Promise<void> {
	const trackJob = job.job as TrackJob;
	await updateJobStatus(job.id, { 
		status: 'processing', 
		startedAt: Date.now(),
		progress: 0
	});

	const result = await downloadTrack(
		trackJob.trackId,
		trackJob.quality,
		trackJob.albumTitle,
		trackJob.artistName,
		trackJob.trackTitle
	);

	if (result.success) {
		await updateJobStatus(job.id, {
			status: 'completed',
			progress: 1,
			completedAt: Date.now()
		});
	} else {
		await updateJobStatus(job.id, {
			status: 'failed',
			error: result.error,
			completedAt: Date.now()
		});
	}
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
		// Fetch album tracks via the API
		const baseUrl = getInternalApiUrl();
		const albumUrl = `${baseUrl}/api/tidal?endpoint=/albums/${albumJob.albumId}`;
		
		console.log(`[Worker] Album ${albumJob.albumId}: Fetching album data from ${albumUrl}`);
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
			} catch (e) {
				errorText = 'Could not parse error response';
			}
			throw new Error(`Failed to fetch album: HTTP ${albumResponse.status}: ${errorText}`);
		}
		
		const { album, tracks } = await albumResponse.json();
		const totalTracks = tracks.length;

		await updateJobStatus(job.id, {
			trackCount: totalTracks,
			completedTracks: 0
		});

		const artistName = albumJob.artistName || album.artist?.name || 'Unknown Artist';
		const albumTitle = album.title || 'Unknown Album';

		let completedTracks = 0;
		let failedTracks = 0;

		// Download tracks sequentially to avoid overwhelming the server
		for (let i = 0; i < tracks.length; i++) {
			const track = tracks[i];
			
			const result = await downloadTrack(
				track.id,
				albumJob.quality,
				albumTitle,
				artistName,
				track.title
			);

			if (result.success) {
				completedTracks++;
			} else {
				failedTracks++;
			}

			// Update progress
			await updateJobStatus(job.id, {
				progress: (i + 1) / totalTracks,
				completedTracks: completedTracks
			});
		}

		// Mark as completed or failed
		if (failedTracks === totalTracks) {
			await updateJobStatus(job.id, {
				status: 'failed',
				error: 'All tracks failed',
				completedAt: Date.now()
			});
		} else if (failedTracks > 0) {
			await updateJobStatus(job.id, {
				status: 'completed',
				error: `${failedTracks} of ${totalTracks} tracks failed`,
				completedAt: Date.now(),
				progress: 1
			});
		} else {
			await updateJobStatus(job.id, {
				status: 'completed',
				completedAt: Date.now(),
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
			// Check if we can process more jobs
			if (activeSemaphore.size < MAX_CONCURRENT) {
				const job = await dequeueJob();
				
				if (job) {
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

			// Check for jobs stuck in processing (timeout)
			const allJobs = await import('./downloadQueueManager').then(m => m.getAllJobs());
			const now = Date.now();
			for (const j of allJobs) {
				if (j.status === 'processing' && j.startedAt) {
					const duration = now - j.startedAt;
					if (duration > PROCESSING_TIMEOUT_MS) {
						console.warn(`[Worker] Job ${j.id} exceeded processing timeout (${duration}ms)`);
						await updateJobStatus(j.id, {
							status: 'failed',
							error: `Processing timeout (${Math.round(duration / 1000)}s exceeded)`,
							completedAt: now
						});
					}
				}
			}

			// Clean up jobs marked for deletion (error === 'Deleted by user')
			for (const j of allJobs) {
				if (j.status === 'failed' && j.error === 'Deleted by user' && j.completedAt) {
					const { deleteJob } = await import('./downloadQueueManager');
					await deleteJob(j.id);
				}
			}

			// Periodic cleanup (every 100 iterations ≈ 200 seconds)
			if (Math.random() < 0.01) {
				await cleanupOldJobs();
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
