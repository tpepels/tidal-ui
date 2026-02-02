import type { AudioQuality, PlayableTrack, Track } from '$lib/types';
import { getCurrentPlaybackOperation, playbackLogger } from '$lib/core/playbackObservability';

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
	getSequence: () => number;
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
		// Capture the track ID and current sequence BEFORE any async work.
		// If a new track starts loading, the sequence will change and we should abort.
		const originalTrackId = track.id;
		const sequenceAtStart = options.getSequence();

		options.setResumeAfterFallback(true);
		dashFallbackInFlight = true;
		dashFallbackAttemptedTrackId = track.id;
		// IMPORTANT: Use the existing sequence instead of creating a new one.
		// Creating a new sequence would make this fallback supersede the load of a new track
		// that was requested while the old track was erroring out.
		const sequence = sequenceAtStart;
		const opLogger = getCurrentPlaybackOperation();
		opLogger?.warn(`Attempting lossless fallback after DASH playback error (${reason})`, {
			trackId: track.id,
			fallbackQuality,
			fallbackReason: `dash-playback-${reason}`,
			phase: 'fallback_start'
		});
		playbackLogger.warn(`Attempting lossless fallback after DASH playback error (${reason})`, {
			trackId: track.id,
			fallbackQuality,
			fallbackReason: `dash-playback-${reason}`
		});
		options.onFallbackRequested?.(fallbackQuality, `dash-playback-${reason}`);
		try {
			options.setDashPlaybackActive(false);
			options.setLoading(true);

			// Check if track changed before proceeding - a new track load would have changed the sequence
			if (options.getSequence() !== sequence) {
				opLogger?.info('Aborting DASH fallback - track changed during fallback setup', {
					phase: 'fallback_loading'
				});
				return;
			}

			await options.loadStandardTrack(track as Track, fallbackQuality, sequence);

			// Verify track didn't change during async load
			const currentTrack = options.getCurrentTrack();
			if (currentTrack?.id !== originalTrackId) {
				opLogger?.info('Fallback completed but track changed, ignoring result', {
					phase: 'fallback_complete'
				});
			}
		} catch (fallbackError) {
			opLogger?.error('Lossless fallback after DASH playback error failed',
				fallbackError instanceof Error ? fallbackError : undefined,
				{ phase: 'fallback_failed' }
			);
			playbackLogger.error('Lossless fallback after DASH playback error failed',
				fallbackError instanceof Error ? fallbackError : undefined,
				{ trackId: track.id, fallbackQuality }
			);
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
		// Capture the track ID and current sequence BEFORE any async work.
		// If a new track starts loading, the sequence will change and we should abort.
		const originalTrackId = track.id;
		const sequenceAtStart = options.getSequence();

		losslessFallbackAttemptedTrackId = track.id;
		losslessFallbackInFlight = true;
		options.setResumeAfterFallback(true);
		// IMPORTANT: Use the existing sequence instead of creating a new one.
		// Creating a new sequence would make this fallback supersede the load of a new track
		// that was requested while the old track was erroring out.
		const sequence = sequenceAtStart;
		const opLogger = getCurrentPlaybackOperation();

		opLogger?.warn('Attempting streaming fallback after lossless error', {
			trackId: track.id,
			fallbackQuality,
			fallbackReason: 'lossless-playback',
			phase: 'fallback_start'
		});

		try {
			options.setLoading(true);
			options.onFallbackRequested?.(fallbackQuality, 'lossless-playback');

			// Check if track changed before proceeding - a new track load would have changed the sequence
			if (options.getSequence() !== sequence) {
				opLogger?.info('Aborting lossless fallback - track changed during fallback setup', {
					phase: 'fallback_loading'
				});
				return;
			}

			await options.loadStandardTrack(track as Track, fallbackQuality, sequence);

			// Verify track didn't change during async load
			const currentTrack = options.getCurrentTrack();
			if (currentTrack?.id !== originalTrackId) {
				opLogger?.info('Fallback completed but track changed, ignoring result', {
					phase: 'fallback_complete'
				});
			} else {
				opLogger?.info(`Streaming fallback loaded successfully for track ${track.id}`, {
					phase: 'fallback_complete',
					actualQuality: fallbackQuality
				});
			}
		} catch (fallbackError) {
			opLogger?.error('Streaming fallback after lossless playback error failed',
				fallbackError instanceof Error ? fallbackError : undefined,
				{ phase: 'fallback_failed' }
			);
			playbackLogger.error('Streaming fallback after lossless playback error failed',
				fallbackError instanceof Error ? fallbackError : undefined,
				{ trackId: track.id, fallbackQuality }
			);
			options.setResumeAfterFallback(false);
		} finally {
			options.setLoading(false);
			losslessFallbackInFlight = false;
		}
	};

	const handleAudioError = (event: Event) => {
		let fallbackResult: { quality: AudioQuality; reason: string } | null = null;
		const opLogger = getCurrentPlaybackOperation();
		const element = event.currentTarget as HTMLAudioElement | null;
		const mediaError = element?.error ?? null;
		const code = mediaError?.code;

		opLogger?.warn('Audio element reported an error state', {
			phase: 'error',
			errorCode: typeof code === 'number' ? code : undefined,
			errorMessage: mediaError?.message
		});

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
				opLogger?.debug('DASH fallback already in progress or attempted, ignoring error', {
					phase: 'error'
				});
				return null;
			}
			const reason = isDecodeError ? 'decode error' : code ? `code ${code}` : 'unknown error';
			opLogger?.warn(`DASH playback error detected; attempting lossless fallback: ${reason}`, {
				phase: 'error',
				isDashPlayback: true,
				errorCode: typeof code === 'number' ? code : undefined
			});
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
		// Only check what's actually playing, not user preference
		// If currentPlayback is unknown (null), fall back to checking playerQuality
		// but only for lossless qualities - this prevents "HIGH to HIGH" fallbacks
		const losslessActive =
			currentPlayback === 'LOSSLESS' ||
			currentPlayback === 'HI_RES_LOSSLESS' ||
			(currentPlayback === null && (
				playerQuality === 'LOSSLESS' ||
				playerQuality === 'HI_RES_LOSSLESS'
			));
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
				opLogger?.debug('Lossless fallback already in progress or attempted, ignoring error', {
					phase: 'error'
				});
				return null;
			}
			const fallbackQuality: AudioQuality =
				options.getStreamingFallbackQuality?.() ?? (options.isFirefox() ? 'LOW' : 'HIGH');
			// Prevent same-quality fallback (e.g., HIGH to HIGH)
			if (currentPlayback === fallbackQuality) {
				opLogger?.debug(`Skipping fallback - already playing at ${fallbackQuality}`, {
					phase: 'error'
				});
				return null;
			}
			const reason =
				codeNumber === srcUnsupported
					? 'source not supported'
					: isDecodeError
						? 'decode error'
						: 'unknown';
			opLogger?.warn(`Lossless playback error (${reason}). Falling back to streaming quality.`, {
				phase: 'error',
				errorCode: codeNumber ?? undefined,
				fallbackReason: reason
			});
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
