/**
 * Download Service
 *
 * Handles track download orchestration, progress tracking, and error handling.
 * Extracted from AudioPlayer component to separate download business logic
 * from UI presentation.
 */

import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
import { downloadUiStore } from '$lib/stores/downloadUi';
import { userPreferencesStore } from '$lib/stores/userPreferences';
import { buildTrackFilename } from '$lib/downloads';
import { formatArtists } from '$lib/utils/formatters';
import { get } from 'svelte/store';
import type { Track, PlayableTrack, AudioQuality } from '$lib/types';
import { isSonglinkTrack } from '$lib/types';

export interface DownloadOptions {
	quality?: AudioQuality;
	convertAacToMp3?: boolean;
	downloadCoversSeperately?: boolean;
}

/**
 * Initiates a track download with progress tracking and error handling
 */
export async function downloadTrack(
	track: PlayableTrack,
	options?: DownloadOptions
): Promise<void> {
	// Only support regular Track downloads, not Songlink tracks
	if (isSonglinkTrack(track)) {
		throw new Error('Cannot download Songlink tracks directly');
	}

	// Get user preferences
	const prefs = get(userPreferencesStore);
	const quality: AudioQuality = options?.quality || 'LOSSLESS';
	const convertAacToMp3 = options?.convertAacToMp3 ?? prefs.convertAacToMp3;
	const downloadCoversSeperately =
		options?.downloadCoversSeperately ?? prefs.downloadCoversSeperately;

	// Build filename
	const filename = buildTrackFilename(
		track.album,
		track,
		quality,
		formatArtists(track.artists),
		convertAacToMp3
	);

	// Initialize download task
	const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename, {
		subtitle: track.album?.title ?? track.artist?.name
	});

	try {
		// Execute download with progress callbacks
		await losslessAPI.downloadTrack(track.id, quality, filename, {
			convertAacToMp3,
			downloadCoverSeperately: downloadCoversSeperately,
			signal: controller.signal,
			onProgress: (progress: TrackDownloadProgress) => {
				if (progress.stage === 'downloading') {
					downloadUiStore.updateTrackProgress(taskId, progress.receivedBytes, progress.totalBytes);
				} else if (progress.stage === 'embedding') {
					downloadUiStore.updateTrackStage(taskId, progress.progress);
				}
			}
		});

		// Mark download as complete
		downloadUiStore.completeTrackDownload(taskId);

		console.log('[DownloadService] Download completed:', filename);
	} catch (error) {
		// Handle cancellation vs actual errors
		if (error instanceof DOMException && error.name === 'AbortError') {
			console.log('[DownloadService] Download cancelled:', filename);
			downloadUiStore.completeTrackDownload(taskId);
		} else {
			console.error('[DownloadService] Download failed:', error);
			const fallbackMessage = 'Failed to download track. Please try again.';
			const message = error instanceof Error && error.message ? error.message : fallbackMessage;
			downloadUiStore.errorTrackDownload(taskId, message);
		}

		throw error;
	}
}

/**
 * Checks if a track is currently being downloaded
 */
export function isTrackDownloading(trackId: number | string): boolean {
	const tasks = get(downloadUiStore).tasks;
	return tasks.some(
		(task) => task.trackId === trackId && (task.status === 'running' || task.status === 'pending')
	);
}

/**
 * Cancels an active download for a track
 */
export function cancelDownload(taskId: string): void {
	downloadUiStore.cancelTrackDownload(taskId);
}
