/**
 * Streaming URL Conversion Service
 *
 * Handles conversion of streaming platform URLs (Spotify, Apple Music, etc.) to TIDAL content.
 * Extracted from SearchInterface component to separate URL conversion business logic
 * from UI presentation.
 */

import { losslessAPI } from '$lib/api';
import { convertToTidal, getPlatformName } from '$lib/utils/songlink';
import type { Track, Album, Playlist, AudioQuality } from '$lib/types';

export type ConversionResultType = 'track' | 'album' | 'playlist';

export interface StreamingUrlConversionResult {
	type: ConversionResultType;
	track?: Track;
	album?: Album;
	playlist?: Playlist;
	platformName?: string;
}

/**
 * Structured error types for URL conversion operations
 */
export type ConversionError =
	| { code: 'INVALID_URL'; retry: false; message: string }
	| { code: 'PLATFORM_NOT_SUPPORTED'; retry: false; message: string; platformName?: string }
	| { code: 'NOT_FOUND_ON_TIDAL'; retry: false; message: string; platformName?: string }
	| { code: 'SONGLINK_API_ERROR'; retry: true; message: string; originalError?: unknown }
	| { code: 'NETWORK_ERROR'; retry: true; message: string; originalError?: unknown }
	| { code: 'UNKNOWN_ERROR'; retry: false; message: string; originalError?: unknown };

export type ConversionResult =
	| { success: true; data: StreamingUrlConversionResult }
	| { success: false; error: ConversionError };

/**
 * Classifies an error into a structured ConversionError type
 */
function classifyConversionError(error: unknown, platformName?: string): ConversionError {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();

		// Network-related errors
		if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
			return { code: 'NETWORK_ERROR', retry: true, message: error.message, originalError: error };
		}

		// Songlink API errors
		if (message.includes('songlink') || message.includes('song.link')) {
			return { code: 'SONGLINK_API_ERROR', retry: true, message: error.message, originalError: error };
		}

		// Not found errors
		if (message.includes('not found') || message.includes('could not find')) {
			return {
				code: 'NOT_FOUND_ON_TIDAL',
				retry: false,
				message: error.message,
				platformName
			};
		}

		return { code: 'UNKNOWN_ERROR', retry: false, message: error.message, originalError: error };
	}

	return {
		code: 'UNKNOWN_ERROR',
		retry: false,
		message: typeof error === 'string' ? error : 'An unknown error occurred',
		originalError: error
	};
}

/**
 * Converts a streaming platform URL to TIDAL content
 * Handles tracks, albums, and playlists
 * Returns a structured result with type-safe error handling
 */
export async function convertStreamingUrl(url: string): Promise<ConversionResult> {
	const trimmedUrl = url.trim();
	if (!trimmedUrl) {
		return {
			success: false,
			error: { code: 'INVALID_URL', retry: false, message: 'URL cannot be empty' }
		};
	}

	const platformName = getPlatformName(trimmedUrl) ?? undefined;

	try {
		// Convert URL to TIDAL info via Songlink
		const tidalInfo = await convertToTidal(trimmedUrl, {
			userCountry: 'US',
			songIfSingle: true
		});

		if (!tidalInfo) {
			return {
				success: false,
				error: {
					code: 'NOT_FOUND_ON_TIDAL',
					retry: false,
					message: `Could not find TIDAL equivalent for this ${platformName || 'streaming platform'} link. The content might not be available on TIDAL.`,
					platformName: platformName || undefined
				}
			};
		}

		// Load the TIDAL content based on type
		switch (tidalInfo.type) {
			case 'track': {
				const trackLookup = await losslessAPI.getTrack(Number(tidalInfo.id));
				if (!trackLookup?.track) {
					return {
						success: false,
						error: {
							code: 'NOT_FOUND_ON_TIDAL',
							retry: false,
							message: 'Track not found on TIDAL',
							platformName
						}
					};
				}
				return {
					success: true,
					data: {
						type: 'track',
						track: trackLookup.track,
						platformName
					}
				};
			}

			case 'album': {
				const albumData = await losslessAPI.getAlbum(Number(tidalInfo.id));
				if (!albumData?.album) {
					return {
						success: false,
						error: {
							code: 'NOT_FOUND_ON_TIDAL',
							retry: false,
							message: 'Album not found on TIDAL',
							platformName
						}
					};
				}
				return {
					success: true,
					data: {
						type: 'album',
						album: albumData.album,
						platformName
					}
				};
			}

			case 'playlist': {
				const playlistData = await losslessAPI.getPlaylist(tidalInfo.id);
				if (!playlistData?.playlist) {
					return {
						success: false,
						error: {
							code: 'NOT_FOUND_ON_TIDAL',
							retry: false,
							message: 'Playlist not found on TIDAL',
							platformName
						}
					};
				}
				return {
					success: true,
					data: {
						type: 'playlist',
						playlist: playlistData.playlist,
						platformName
					}
				};
			}

			default:
				return {
					success: false,
					error: {
						code: 'PLATFORM_NOT_SUPPORTED',
						retry: false,
						message: `Unsupported content type: ${tidalInfo.type}`,
						platformName
					}
				};
		}
	} catch (error) {
		return { success: false, error: classifyConversionError(error, platformName) };
	}
}

/**
 * Pre-caches the stream URL for a track to improve playback start time
 * This is called after a track conversion to warm up the cache
 */
export async function precacheTrackStream(
	trackId: number,
	quality: AudioQuality = 'LOSSLESS'
): Promise<void> {
	try {
		await losslessAPI.getStreamUrl(trackId, quality);
		console.log(`[StreamingUrlConversion] Pre-cached stream for track ${trackId}`);
	} catch (err) {
		console.warn(`[StreamingUrlConversion] Failed to cache stream for track ${trackId}:`, err);
		// Don't throw - caching is optional optimization
	}
}
