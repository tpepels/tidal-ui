/**
 * Track Conversion
 *
 * Converts SonglinkTrack references to TIDAL Track objects.
 * Kept outside stores/services to avoid cross-layer imports.
 */

import { losslessAPI } from '$lib/api';
import { extractTidalInfo, convertToTidal } from '$lib/utils/songlink';
import type { Track, SonglinkTrack } from '$lib/types';

/**
 * Structured error types for track conversion operations
 */
export type TrackConversionError =
	| { code: 'NO_TIDAL_ID'; retry: false; message: string; trackTitle: string }
	| { code: 'TRACK_NOT_FOUND'; retry: true; message: string; tidalId: number }
	| { code: 'SONGLINK_EXTRACTION_FAILED'; retry: false; message: string; originalError?: unknown }
	| { code: 'SONGLINK_API_ERROR'; retry: true; message: string; originalError?: unknown }
	| { code: 'NETWORK_ERROR'; retry: true; message: string; originalError?: unknown }
	| { code: 'ALL_STRATEGIES_FAILED'; retry: false; message: string; attemptedStrategies: string[] };

export interface ConversionResult {
	success: boolean;
	track?: Track;
	error?: TrackConversionError;
}

/**
 * Classifies an error into a structured TrackConversionError type
 */
function classifyConversionError(
	error: unknown,
	context: { tidalId?: number; trackTitle?: string }
): TrackConversionError {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();

		// Network-related errors
		if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
			return { code: 'NETWORK_ERROR', retry: true, message: error.message, originalError: error };
		}

		// Track not found errors
		if (message.includes('not found') && context.tidalId) {
			return {
				code: 'TRACK_NOT_FOUND',
				retry: true,
				message: error.message,
				tidalId: context.tidalId
			};
		}

		// Songlink API errors
		if (message.includes('songlink')) {
			return { code: 'SONGLINK_API_ERROR', retry: true, message: error.message, originalError: error };
		}

		// Extraction failures
		return {
			code: 'SONGLINK_EXTRACTION_FAILED',
			retry: false,
			message: error.message,
			originalError: error
		};
	}

	return {
		code: 'SONGLINK_EXTRACTION_FAILED',
		retry: false,
		message: typeof error === 'string' ? error : 'Unknown conversion error',
		originalError: error
	};
}

/**
 * Attempts to convert a SonglinkTrack to a TIDAL Track
 * Uses multiple fallback strategies:
 * 1. Direct TIDAL ID from Songlink data
 * 2. Extract TIDAL info from Songlink URL
 * 3. Fallback conversion using Songlink API
 * Returns structured result with detailed error tracking
 */
export async function convertSonglinkTrackToTidal(
	songlinkTrack: SonglinkTrack
): Promise<ConversionResult> {
	const attemptedStrategies: string[] = [];
	const errors: TrackConversionError[] = [];

	// Strategy 1: Direct TIDAL ID from Songlink track
	if (songlinkTrack.tidalId) {
		attemptedStrategies.push('direct_tidal_id');
		try {
			console.log('[TrackConversion] Using direct TIDAL ID:', songlinkTrack.tidalId);
			const trackLookup = await losslessAPI.getTrack(songlinkTrack.tidalId);
			return { success: true, track: trackLookup.track };
		} catch (err) {
			console.warn('[TrackConversion] Direct ID fetch failed:', err);
			errors.push(classifyConversionError(err, { tidalId: songlinkTrack.tidalId }));
		}
	}

	// Strategy 2: Extract TIDAL info from Songlink data
	if (songlinkTrack.songlinkData) {
		attemptedStrategies.push('songlink_data_extraction');
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
			errors.push(classifyConversionError(err, { trackTitle: songlinkTrack.title }));
		}
	}

	// Strategy 3: Fallback conversion using Songlink service
	const sourceUrl = songlinkTrack.sourceUrl;
	if (sourceUrl) {
		attemptedStrategies.push('songlink_api_fallback');
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
			errors.push(classifyConversionError(err, { trackTitle: songlinkTrack.title }));
		}
	}

	// All strategies failed - aggregate errors
	const errorMessage = `Failed to convert Songlink track: ${songlinkTrack.title} by ${songlinkTrack.artistName}`;
	console.error('[TrackConversion] All strategies failed:', {
		track: songlinkTrack.title,
		attemptedStrategies,
		errors: errors.map((e) => e.code)
	});

	return {
		success: false,
		error: {
			code: 'ALL_STRATEGIES_FAILED',
			retry: false,
			message: errorMessage,
			attemptedStrategies
		}
	};
}

/**
 * Validates if a track needs conversion (is SonglinkTrack)
 */
export function needsConversion(track: Track | SonglinkTrack | null): track is SonglinkTrack {
	if (!track) return false;
	return 'isSonglinkTrack' in track && track.isSonglinkTrack === true;
}
