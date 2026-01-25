import type { PlayableTrack, Track } from '$lib/types';
import { isSonglinkTrack } from '$lib/types';
import {
	convertSonglinkTrackToTidal,
	type TrackConversionError
} from '$lib/services/playback/trackConversionService';

export type TrackResolutionError =
	| { code: 'SONGLINK_NOT_SUPPORTED'; retry: false; message: string; canConvert: true }
	| { code: 'CONVERSION_FAILED'; retry: false; message: string; conversionError: TrackConversionError };

export type TrackResolutionResult =
	| { success: true; track: Track; converted: boolean }
	| { success: false; error: TrackResolutionError };

export interface TrackResolver {
	resolve: (
		track: PlayableTrack,
		options: { autoConvertSonglink: boolean }
	) => Promise<TrackResolutionResult>;
}

export const createTrackResolver = (
	convert = convertSonglinkTrackToTidal
): TrackResolver => ({
	async resolve(track, options) {
		if (!isSonglinkTrack(track)) {
			return { success: true, track, converted: false };
		}

		if (!options.autoConvertSonglink) {
			return {
				success: false,
				error: {
					code: 'SONGLINK_NOT_SUPPORTED',
					retry: false,
					message:
						'Songlink tracks must be converted to TIDAL first. Enable auto-conversion or convert manually.',
					canConvert: true
				}
			};
		}

		const conversionResult = await convert(track);

		if (!conversionResult.success || !conversionResult.track) {
			return {
				success: false,
				error: {
					code: 'CONVERSION_FAILED',
					retry: false,
					message: `Auto-conversion failed: ${conversionResult.error?.message || 'Unknown error'}`,
					conversionError: conversionResult.error ?? {
						code: 'ALL_STRATEGIES_FAILED',
						retry: false,
						message: 'Unknown conversion error',
						attemptedStrategies: []
					}
				}
			};
		}

		return { success: true, track: conversionResult.track, converted: true };
	}
});
