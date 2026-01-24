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
	handleAudioError: (event: Event) => boolean;
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

	const fallbackToLosslessAfterDashError = async (reason: string) => {
		if (dashFallbackInFlight) {
			return;
		}
		const track = options.getCurrentTrack();
		if (!track) {
			return;
		}
		if (dashFallbackAttemptedTrackId === track.id) {
			return;
		}
		dashFallbackInFlight = true;
		dashFallbackAttemptedTrackId = track.id;
		const sequence = options.createSequence();
		console.warn(`Attempting lossless fallback after DASH playback error (${reason}).`);
		const supportsLossless = options.getSupportsLosslessPlayback?.() ?? true;
		const streamingFallback =
			options.getStreamingFallbackQuality?.() ?? (options.isFirefox() ? 'LOW' : 'HIGH');
		const fallbackQuality: AudioQuality = supportsLossless ? 'LOSSLESS' : streamingFallback;
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

	const fallbackToStreamingAfterLosslessError = async () => {
		if (losslessFallbackInFlight) {
			return;
		}
		const track = options.getCurrentTrack();
		if (!track) {
			return;
		}
		if (losslessFallbackAttemptedTrackId === track.id) {
			return;
		}
		losslessFallbackAttemptedTrackId = track.id;
		losslessFallbackInFlight = true;
		options.setResumeAfterFallback(options.getIsPlaying());
		const sequence = options.createSequence();
		try {
			options.setLoading(true);
			const fallbackQuality: AudioQuality =
				options.getStreamingFallbackQuality?.() ?? (options.isFirefox() ? 'LOW' : 'HIGH');
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
		let didFallback = false;
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
				return false;
			}
			const reason = isDecodeError ? 'decode error' : code ? `code ${code}` : 'unknown error';
			console.warn('[AudioPlayer] DASH playback error detected; attempting lossless fallback:', reason);
			void fallbackToLosslessAfterDashError(reason);
			didFallback = true;
			return didFallback;
		}
		const codeNumber = typeof code === 'number' ? code : null;
		const abortedCode =
			typeof mediaError?.MEDIA_ERR_ABORTED === 'number' ? mediaError.MEDIA_ERR_ABORTED : null;
		const srcUnsupported = mediaError?.MEDIA_ERR_SRC_NOT_SUPPORTED;
		const losslessActive =
			options.getCurrentPlaybackQuality() === 'LOSSLESS' || options.getPlayerQuality() === 'LOSSLESS';
		const shouldFallbackToStreaming =
			losslessActive &&
			codeNumber !== null &&
			codeNumber !== abortedCode &&
			((typeof decodeConstant === 'number' && codeNumber === decodeConstant) ||
				(typeof srcUnsupported === 'number' && codeNumber === srcUnsupported));
		if (shouldFallbackToStreaming) {
			const reason =
				codeNumber === srcUnsupported
					? 'source not supported'
					: isDecodeError
						? 'decode error'
						: 'unknown';
			console.warn(
				`[AudioPlayer] Lossless playback error (${reason}). Falling back to streaming quality for current track.`
			);
			void fallbackToStreamingAfterLosslessError();
			didFallback = true;
		}
		return didFallback;
	};

	return {
		resetForTrack,
		handleAudioError
	};
};
