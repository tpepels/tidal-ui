/**
 * Track Conversion Service
 *
 * Re-exports conversion logic from the shared utilities layer.
 */

export {
	convertSonglinkTrackToTidal,
	needsConversion,
	type ConversionResult,
	type TrackConversionError
} from '$lib/utils/trackConversion';
