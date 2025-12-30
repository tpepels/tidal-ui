/**
 * Streaming URL Conversion Service
 *
 * Handles conversion of streaming platform URLs (Spotify, Apple Music, etc.) to TIDAL content.
 * Extracted from SearchInterface component to separate URL conversion business logic
 * from UI presentation.
 */

import { losslessAPI } from '$lib/api';
import { convertToTidal, getPlatformName } from '$lib/utils/songlink';
import type { Track, Album, Playlist } from '$lib/types';

export type ConversionResultType = 'track' | 'album' | 'playlist';

export interface StreamingUrlConversionResult {
	type: ConversionResultType;
	track?: Track;
	album?: Album;
	playlist?: Playlist;
	platformName?: string;
}

export interface ConversionError {
	message: string;
	platformName?: string;
}

/**
 * Converts a streaming platform URL to TIDAL content
 * Handles tracks, albums, and playlists
 */
export async function convertStreamingUrl(url: string): Promise<StreamingUrlConversionResult> {
	const trimmedUrl = url.trim();
	if (!trimmedUrl) {
		throw new Error('URL cannot be empty');
	}

	const platformName = getPlatformName(trimmedUrl);

	// Convert URL to TIDAL info via Songlink
	const tidalInfo = await convertToTidal(trimmedUrl, {
		userCountry: 'US',
		songIfSingle: true
	});

	if (!tidalInfo) {
		const error: ConversionError = {
			message: `Could not find TIDAL equivalent for this ${platformName || 'streaming platform'} link. The content might not be available on TIDAL.`,
			platformName: platformName || undefined
		};
		throw error;
	}

	// Load the TIDAL content based on type
	switch (tidalInfo.type) {
		case 'track': {
			const trackLookup = await losslessAPI.getTrack(Number(tidalInfo.id));
			if (!trackLookup?.track) {
				throw new Error('Track not found on TIDAL');
			}
			return {
				type: 'track',
				track: trackLookup.track,
				platformName
			};
		}

		case 'album': {
			const albumData = await losslessAPI.getAlbum(Number(tidalInfo.id));
			if (!albumData?.album) {
				throw new Error('Album not found on TIDAL');
			}
			return {
				type: 'album',
				album: albumData.album,
				platformName
			};
		}

		case 'playlist': {
			const playlistData = await losslessAPI.getPlaylist(tidalInfo.id);
			if (!playlistData?.playlist) {
				throw new Error('Playlist not found on TIDAL');
			}
			return {
				type: 'playlist',
				playlist: playlistData.playlist,
				platformName
			};
		}

		default:
			throw new Error(`Unsupported content type: ${tidalInfo.type}`);
	}
}

/**
 * Pre-caches the stream URL for a track to improve playback start time
 * This is called after a track conversion to warm up the cache
 */
export async function precacheTrackStream(
	trackId: number,
	quality: string = 'LOSSLESS'
): Promise<void> {
	try {
		await losslessAPI.getStreamUrl(trackId, quality);
		console.log(`[StreamingUrlConversion] Pre-cached stream for track ${trackId}`);
	} catch (err) {
		console.warn(`[StreamingUrlConversion] Failed to cache stream for track ${trackId}:`, err);
		// Don't throw - caching is optional optimization
	}
}
