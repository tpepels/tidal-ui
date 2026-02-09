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
let activeDownloads = 0;

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
		
		const baseUrl = `http://localhost:${process.env.PORT || 5173}`;
		const url = `${baseUrl}/api/internal/download-track`;
		
		const body = {
			trackId,
			quality,
			albumTitle,
			artistName,
			trackTitle,
			conflictResolution: 'overwrite_if_different' as const
		};

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
			return { 
				success: false, 
				error: errorData.error || `HTTP ${response.status}` 
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
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error(`[Worker] Track ${trackId} failed:`, message);
		return { success: false, error: message };
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
		const baseUrl = `http://localhost:${process.env.PORT || 5173}`;
		const albumResponse = await fetch(`${baseUrl}/api/tidal?endpoint=/albums/${albumJob.albumId}`);
		
		if (!albumResponse.ok) {
			throw new Error(`Failed to fetch album: HTTP ${albumResponse.status}`);
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
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error(`[Worker] Album ${albumJob.albumId} failed:`, message);
		await updateJobStatus(job.id, {
			status: 'failed',
			error: message,
			completedAt: Date.now()
		});
	}
}

/**
 * Process a single job
 */
async function processJob(job: QueuedJob): Promise<void> {
	activeDownloads++;
	try {
		if (job.job.type === 'track') {
					await processTrackJob(job);
				} else if (job.job.type === 'album') {
					await processAlbumJob(job);
		}
	} finally {
		activeDownloads--;
	}
}

/**
 * Main worker loop
 */
async function workerLoop(): Promise<void> {
	while (!stopRequested) {
		try {
			// Check if we can process more jobs
			if (activeDownloads < MAX_CONCURRENT) {
				const job = await dequeueJob();
				
				if (job) {
					// Process job without awaiting (allows concurrent processing)
					processJob(job).catch(err => {
						console.error('[Worker] Job processing error:', err);
					});
				} else {
					// No jobs, wait before polling again
					await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
				}
			} else {
				// Max concurrent reached, wait
				await new Promise(resolve => setTimeout(resolve, 500));
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
	while (activeDownloads > 0) {
		console.log(`[Worker] Waiting for ${activeDownloads} active downloads to finish...`);
		await new Promise(resolve => setTimeout(resolve, 1000));
	}

	console.log('[Worker] Stopped');
	isRunning = false;
}

/**
 * Start the background worker
 */
export function startWorker(): void {
	if (isRunning) {
		console.log('[Worker] Already running');
		return;
	}

	console.log('[Worker] Starting...');
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
		activeDownloads,
		maxConcurrent: MAX_CONCURRENT
	};
}
