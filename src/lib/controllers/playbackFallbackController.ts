import type { AudioQuality, PlayableTrack, Track } from '$lib/types';

type ControllerOptions = {
	getCurrentTrack: () => PlayableTrack | null;
	getPlayerQuality: () => AudioQuality;
	getCurrentPlaybackQuality: () => AudioQuality | null;
	getIsPlaying: () => boolean;
	getSupportsLosslessPlayback?: () => boolean;
	getStreamingFallbackQuality?: () => AudioQuality;
	isFirefox: () => boolean;
	getDashPlaybackActive: () => boolean;
	setDashPlaybackActive: (value: boolean) => void;
	setLoading: (value: boolean) => void;
	loadStandardTrack: (track: Track, quality: AudioQuality, sequence: number) => Promise<void>;
	createSequence: () => number;
	setResumeAfterFallback: (value: boolean) => void;
	onFallbackRequested?: (quality: AudioQuality, reason: string) => void;
};

export type PlaybackFallbackController = {
	resetForTrack: (trackId: number | string) => void;
	handleAudioError: (event: Event) => { quality: AudioQuality; reason: string } | null;
};

export const createPlaybackFallbackController = (
	options: ControllerOptions
): PlaybackFallbackController => {
	let dashFallbackAttemptedTrackId: number | string | null = null;
	let dashFallbackInFlight = false;
	let losslessFallbackAttemptedTrackId: number | string | null = null;
	let losslessFallbackInFlight = false;

	const resetForTrack = (trackId: number | string) => {
		if (dashFallbackAttemptedTrackId && dashFallbackAttemptedTrackId !== trackId) {
			dashFallbackAttemptedTrackId = null;
		}
		dashFallbackInFlight = false;
		losslessFallbackAttemptedTrackId = null;
		losslessFallbackInFlight = false;
		options.setResumeAfterFallback(false);
	};

	/**
	 * Check if a DASH fallback can be started for the current track.
	 * Returns false if a fallback is already in progress or has been attempted.
	 */
	const canStartDashFallback = (): boolean => {
		if (dashFallbackInFlight) {
			return false;
		}
		const track = options.getCurrentTrack();
		if (!track) {
			return false;
		}
		if (dashFallbackAttemptedTrackId === track.id) {
			return false;
		}
		return true;
	};

	const fallbackToLosslessAfterDashError = async (
		reason: string,
		fallbackQuality: AudioQuality
	) => {
		if (!canStartDashFallback()) {
			return;
		}
		const track = options.getCurrentTrack();
		if (!track) {
			return;
		}
		options.setResumeAfterFallback(true);
		dashFallbackInFlight = true;
		dashFallbackAttemptedTrackId = track.id;
		const sequence = options.createSequence();
		console.warn(`Attempting lossless fallback after DASH playback error (${reason}).`);
		options.onFallbackRequested?.(fallbackQuality, `dash-playback-${reason}`);
		try {
			options.setDashPlaybackActive(false);
			options.setLoading(true);
			await options.loadStandardTrack(track as Track, fallbackQuality, sequence);
		} catch (fallbackError) {
			console.error('Lossless fallback after DASH playback error failed', fallbackError);
		} finally {
			dashFallbackInFlight = false;
			options.setLoading(false);
		}
	};

	/**
	 * Check if a lossless fallback can be started for the current track.
	 * Returns false if a fallback is already in progress or has been attempted.
	 */
	const canStartLosslessFallback = (): boolean => {
		if (losslessFallbackInFlight) {
			return false;
		}
		const track = options.getCurrentTrack();
		if (!track) {
			return false;
		}
		if (losslessFallbackAttemptedTrackId === track.id) {
			return false;
		}
		return true;
	};

	const fallbackToStreamingAfterLosslessError = async (
		fallbackQuality: AudioQuality
	) => {
		if (!canStartLosslessFallback()) {
			return;
		}
		const track = options.getCurrentTrack();
		if (!track) {
			return;
		}
		losslessFallbackAttemptedTrackId = track.id;
		losslessFallbackInFlight = true;
		options.setResumeAfterFallback(true);
		const sequence = options.createSequence();
		try {
			options.setLoading(true);
			options.onFallbackRequested?.(fallbackQuality, 'lossless-playback');
			await options.loadStandardTrack(track as Track, fallbackQuality, sequence);
			console.info('[AudioPlayer] Streaming fallback loaded for track', track.id);
		} catch (fallbackError) {
			console.error('Streaming fallback after lossless playback error failed', fallbackError);
			options.setResumeAfterFallback(false);
		} finally {
			options.setLoading(false);
			losslessFallbackInFlight = false;
		}
	};

	const handleAudioError = (event: Event) => {
		let fallbackResult: { quality: AudioQuality; reason: string } | null = null;
		console.warn('[AudioPlayer] Audio element reported an error state:', event);
		const element = event.currentTarget as HTMLAudioElement | null;
		const mediaError = element?.error ?? null;
		const code = mediaError?.code;
		const decodeConstant =
			mediaError && 'MEDIA_ERR_DECODE' in mediaError ? mediaError.MEDIA_ERR_DECODE : undefined;
		const isDecodeError =
			typeof code === 'number' && typeof decodeConstant === 'number' ? code === decodeConstant : false;
		if (options.getDashPlaybackActive()) {
			if (!isDecodeError && !code) {
				return null;
			}
			// Only return a fallback result if we can actually start a fallback
			if (!canStartDashFallback()) {
				console.debug('[AudioPlayer] DASH fallback already in progress or attempted, ignoring error');
				return null;
			}
			const reason = isDecodeError ? 'decode error' : code ? `code ${code}` : 'unknown error';
			console.warn('[AudioPlayer] DASH playback error detected; attempting lossless fallback:', reason);
			const supportsLossless = options.getSupportsLosslessPlayback?.() ?? true;
			const streamingFallback =
				options.getStreamingFallbackQuality?.() ?? (options.isFirefox() ? 'LOW' : 'HIGH');
			const fallbackQuality: AudioQuality = supportsLossless ? 'LOSSLESS' : streamingFallback;
			void fallbackToLosslessAfterDashError(reason, fallbackQuality);
			fallbackResult = { quality: fallbackQuality, reason: `dash-playback-${reason}` };
			return fallbackResult;
		}
		const codeNumber = typeof code === 'number' ? code : null;
		const abortedCode =
			typeof mediaError?.MEDIA_ERR_ABORTED === 'number' ? mediaError.MEDIA_ERR_ABORTED : null;
		const srcUnsupported = mediaError?.MEDIA_ERR_SRC_NOT_SUPPORTED;
		const currentPlayback = options.getCurrentPlaybackQuality();
		const playerQuality = options.getPlayerQuality();
		const losslessActive =
			currentPlayback === 'LOSSLESS' ||
			currentPlayback === 'HI_RES_LOSSLESS' ||
			playerQuality === 'LOSSLESS' ||
			playerQuality === 'HI_RES_LOSSLESS';
		const shouldFallbackToStreaming =
			losslessActive &&
			codeNumber !== null &&
			codeNumber !== abortedCode &&
			((typeof decodeConstant === 'number' && codeNumber === decodeConstant) ||
				(typeof srcUnsupported === 'number' && codeNumber === srcUnsupported));
		if (shouldFallbackToStreaming) {
			// Only return a fallback result if we can actually start a fallback
			// This prevents multiple FALLBACK_REQUESTED events and state transitions
			if (!canStartLosslessFallback()) {
				console.debug('[AudioPlayer] Lossless fallback already in progress or attempted, ignoring error');
				return null;
			}
			const reason =
				codeNumber === srcUnsupported
					? 'source not supported'
					: isDecodeError
						? 'decode error'
						: 'unknown';
			console.warn(
				`[AudioPlayer] Lossless playback error (${reason}). Falling back to streaming quality for current track.`
			);
			const fallbackQuality: AudioQuality =
				options.getStreamingFallbackQuality?.() ?? (options.isFirefox() ? 'LOW' : 'HIGH');
			void fallbackToStreamingAfterLosslessError(fallbackQuality);
			fallbackResult = { quality: fallbackQuality, reason: 'lossless-playback' };
		}
		return fallbackResult;
	};

	return {
		resetForTrack,
		handleAudioError
	};
};
