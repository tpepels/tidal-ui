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

export interface PlaylistConversionResult {
	successful: SonglinkTrack[];
	failed: string[];
	total: number;
}

/**
 * Converts a Spotify playlist URL to an array of SonglinkTracks
 * Uses batch conversion with progress tracking
 */
export async function convertSpotifyPlaylistToTracks(
	playlistUrl: string,
	onProgress?: (progress: PlaylistConversionProgress) => void
): Promise<PlaylistConversionResult> {
	const trimmedUrl = playlistUrl.trim();
	if (!trimmedUrl) {
		throw new Error('Playlist URL cannot be empty');
	}

	// Step 1: Extract all Spotify track URLs from the playlist
	const spotifyTrackUrls = await convertSpotifyPlaylist(trimmedUrl);

	if (!spotifyTrackUrls || spotifyTrackUrls.length === 0) {
		throw new Error('Could not fetch tracks from Spotify playlist. The playlist might be empty or private.');
	}

	const total = spotifyTrackUrls.length;
	const successful: SonglinkTrack[] = [];
	const failed: string[] = [];

	// Report initial progress
	if (onProgress) {
		onProgress({ loaded: 0, total, successful, failed });
	}

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

	// Process results and update progress
	results.forEach((result, index) => {
		if (result.status === 'fulfilled' && result.value.success && result.value.track) {
			successful.push(result.value.track);
		} else {
			failed.push(spotifyTrackUrls[index]);
		}

		// Report progress after each track
		if (onProgress) {
			onProgress({
				loaded: index + 1,
				total,
				successful: [...successful],
				failed: [...failed]
			});
		}
	});

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
