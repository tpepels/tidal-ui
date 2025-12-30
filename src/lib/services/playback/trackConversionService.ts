/**
 * Track Conversion Service
 *
 * Handles conversion of SonglinkTrack references to TIDAL Track objects.
 * This service encapsulates the complex multi-step conversion logic that was
 * previously scattered across the AudioPlayer component.
 */

import { losslessAPI } from '$lib/api';
import { extractTidalInfo, convertToTidal } from '$lib/utils/songlink';
import type { Track, SonglinkTrack } from '$lib/types';

export interface ConversionResult {
	success: boolean;
	track?: Track;
	error?: string;
}

/**
 * Attempts to convert a SonglinkTrack to a TIDAL Track
 * Uses multiple fallback strategies:
 * 1. Direct TIDAL ID from Songlink data
 * 2. Extract TIDAL info from Songlink URL
 * 3. Fallback conversion using Songlink API
 */
export async function convertSonglinkTrackToTidal(
	songlinkTrack: SonglinkTrack
): Promise<ConversionResult> {
	// Strategy 1: Direct TIDAL ID from Songlink track
	if (songlinkTrack.tidalId) {
		try {
			console.log('[TrackConversion] Using direct TIDAL ID:', songlinkTrack.tidalId);
			const trackLookup = await losslessAPI.getTrack(songlinkTrack.tidalId);
			return { success: true, track: trackLookup.track };
		} catch (err) {
			console.warn('[TrackConversion] Direct ID fetch failed:', err);
		}
	}

	// Strategy 2: Extract TIDAL info from Songlink data
	if (songlinkTrack.songlinkData) {
		try {
			console.log('[TrackConversion] Extracting TIDAL info from Songlink data');
			const tidalInfo = extractTidalInfo(songlinkTrack.songlinkData);

			if (tidalInfo?.type === 'track' && tidalInfo.id) {
				const trackId = typeof tidalInfo.id === 'string' ? parseInt(tidalInfo.id, 10) : tidalInfo.id;

				if (!isNaN(trackId)) {
					const trackLookup = await losslessAPI.getTrack(trackId);
					return { success: true, track: trackLookup.track };
				}
			}
		} catch (err) {
			console.warn('[TrackConversion] Songlink data extraction failed:', err);
		}
	}

	// Strategy 3: Fallback conversion using Songlink service
	const sourceUrl = songlinkTrack.sourceUrl;
	if (sourceUrl) {
		try {
			console.log('[TrackConversion] Attempting fallback conversion via Songlink');
			const convertedTrack = await convertToTidal(sourceUrl, {
				userCountry: 'US',
				songIfSingle: true
			});

			if (convertedTrack && 'id' in convertedTrack && typeof convertedTrack.id === 'number') {
				const trackLookup = await losslessAPI.getTrack(convertedTrack.id);
				return { success: true, track: trackLookup.track };
			}
		} catch (err) {
			console.warn('[TrackConversion] Fallback conversion failed:', err);
		}
	}

	// All strategies failed
	return {
		success: false,
		error: `Failed to convert Songlink track: ${songlinkTrack.title} by ${songlinkTrack.artistName}`
	};
}

/**
 * Validates if a track needs conversion (is SonglinkTrack)
 */
export function needsConversion(track: Track | SonglinkTrack | null): track is SonglinkTrack {
	if (!track) return false;
	return 'isSonglinkTrack' in track && track.isSonglinkTrack === true;
}
