/**
 * Playlist Conversion Service
 *
 * Handles Spotify playlist batch conversion to TIDAL SonglinkTracks.
 * Extracted from SearchInterface component to separate playlist conversion
 * business logic from UI presentation.
 */

import { convertSpotifyPlaylist, fetchSonglinkData, extractTidalSongEntity } from '$lib/utils/songlink';
import type { SonglinkTrack } from '$lib/types';

export interface PlaylistConversionProgress {
	loaded: number;
	total: number;
	successful: SonglinkTrack[];
	failed: string[];
}

export interface PlaylistConversionOptions {
	/**
	 * Callback invoked periodically with conversion progress
	 * To optimize performance, progress is batched and not called for every single track
	 */
	onProgress?: (progress: PlaylistConversionProgress) => void;

	/**
	 * Number of tracks to process before calling onProgress
	 * Higher values = fewer UI updates but less responsive progress
	 * Default: 5
	 */
	progressBatchSize?: number;

	/**
	 * Minimum time (ms) between progress callbacks
	 * Prevents excessive UI updates for fast conversions
	 * Default: 100ms
	 */
	progressThrottleMs?: number;
}

export interface PlaylistConversionResult {
	successful: SonglinkTrack[];
	failed: string[];
	total: number;
}

/**
 * Converts a Spotify playlist URL to an array of SonglinkTracks
 * Uses batch conversion with optimized progress tracking
 */
export async function convertSpotifyPlaylistToTracks(
	playlistUrl: string,
	options?: PlaylistConversionOptions
): Promise<PlaylistConversionResult> {
	const trimmedUrl = playlistUrl.trim();
	if (!trimmedUrl) {
		throw new Error('Playlist URL cannot be empty');
	}

	const batchSize = options?.progressBatchSize ?? 5;
	const throttleMs = options?.progressThrottleMs ?? 100;
	const onProgress = options?.onProgress;

	// Step 1: Extract all Spotify track URLs from the playlist
	const spotifyTrackUrls = await convertSpotifyPlaylist(trimmedUrl);

	if (!spotifyTrackUrls || spotifyTrackUrls.length === 0) {
		throw new Error('Could not fetch tracks from Spotify playlist. The playlist might be empty or private.');
	}

	const total = spotifyTrackUrls.length;
	const successful: SonglinkTrack[] = [];
	const failed: string[] = [];

	// Progress throttling state
	let lastProgressTime = 0;
	let progressUpdatesPending = false;

	const reportProgress = (loaded: number, force: boolean = false) => {
		if (!onProgress) return;

		const now = Date.now();
		const shouldThrottle = now - lastProgressTime < throttleMs;
		const shouldBatch = loaded % batchSize !== 0;

		// Only report if: forced, or (not batched AND not throttled)
		if (force || (!shouldBatch && !shouldThrottle)) {
			onProgress({
				loaded,
				total,
				// Only copy arrays when actually reporting (not on every track!)
				successful: [...successful],
				failed: [...failed]
			});
			lastProgressTime = now;
			progressUpdatesPending = false;
		} else {
			progressUpdatesPending = true;
		}
	};

	// Report initial progress
	reportProgress(0, true);

	// Step 2: Fetch Songlink data for all tracks in parallel
	const conversionPromises = spotifyTrackUrls.map(async (trackUrl, index) => {
		try {
			const songlinkData = await fetchSonglinkData(trackUrl, {
				userCountry: 'US',
				songIfSingle: true
			});

			// Extract TIDAL entity for display
			const tidalEntity = extractTidalSongEntity(songlinkData);

			if (tidalEntity) {
				// Create a SonglinkTrack object (without immediate TIDAL API call)
				const songlinkTrack: SonglinkTrack = {
					id: songlinkData.entityUniqueId,
					title: tidalEntity.title || 'Unknown Track',
					artistName: tidalEntity.artistName || 'Unknown Artist',
					duration: 180, // Placeholder duration (3 minutes)
					thumbnailUrl: tidalEntity.thumbnailUrl || '',
					sourceUrl: trackUrl,
					songlinkData,
					isSonglinkTrack: true,
					tidalId: tidalEntity.id ? Number(tidalEntity.id) : undefined,
					audioQuality: 'LOSSLESS'
				};

				return { success: true, track: songlinkTrack, url: trackUrl };
			}

			return { success: false, url: trackUrl };
		} catch (err) {
			console.warn(`[PlaylistConversion] Failed to fetch Songlink data for track ${index + 1}:`, err);
			return { success: false, url: trackUrl };
		}
	});

	// Wait for all conversions to complete
	const results = await Promise.allSettled(conversionPromises);

	// Process results with batched progress updates
	results.forEach((result, index) => {
		if (result.status === 'fulfilled' && result.value.success && result.value.track) {
			successful.push(result.value.track);
		} else {
			failed.push(spotifyTrackUrls[index]);
		}

		// Report progress with batching and throttling
		reportProgress(index + 1, false);
	});

	// Always report final progress (even if batched)
	if (progressUpdatesPending) {
		reportProgress(total, true);
	}

	console.log(`[PlaylistConversion] Completed: ${successful.length} successful, ${failed.length} failed`);

	return {
		successful,
		failed,
		total
	};
}

/**
 * Validates if a URL is a Spotify playlist URL
 */
export function isSpotifyPlaylistUrl(url: string): boolean {
	const trimmed = url.trim();
	return trimmed.includes('spotify.com/playlist/') || trimmed.includes('spotify:playlist:');
}
