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
	loadStandardTrack: (track: Track, quality: AudioQuality, attemptId: string) => Promise<void>;
	getAttemptId: () => string | null;
	isAttemptCurrent: (attemptId: string) => boolean;
	setResumeAfterFallback: (value: boolean) => void;
	onFallbackRequested?: (quality: AudioQuality, reason: string) => void;
};

export type PlaybackFallbackPlan = {
	track: Track;
	quality: AudioQuality;
	reason: string;
	kind: 'dash' | 'lossless';
};

export type PlaybackFallbackController = {
	resetForTrack: (trackId: number | string) => void;
	planFallback: (event: Event) => PlaybackFallbackPlan | null;
	executeFallback: (plan: PlaybackFallbackPlan, attemptId: string) => Promise<void>;
};

export const createPlaybackFallbackController = (
	options: ControllerOptions
): PlaybackFallbackController => {
	let dashFallbackAttemptedTrackId: number | string | null = null;
	let dashFallbackInFlight = false;
	let losslessFallbackAttemptedTrackId: number | string | null = null;
	let losslessFallbackInFlight = false;
	let streamingFallbackAttemptedTrackId: number | string | null = null;
	let streamingFallbackAttemptedQuality: AudioQuality | null = null;

	const resetForTrack = (trackId: number | string) => {
		if (dashFallbackAttemptedTrackId && dashFallbackAttemptedTrackId !== trackId) {
			dashFallbackAttemptedTrackId = null;
		}
		dashFallbackInFlight = false;
		losslessFallbackAttemptedTrackId = null;
		losslessFallbackInFlight = false;
		streamingFallbackAttemptedTrackId = null;
		streamingFallbackAttemptedQuality = null;
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

	const canStartStreamingFallback = (quality: AudioQuality): boolean => {
		if (streamingFallbackAttemptedTrackId === null) {
			return true;
		}
		if (streamingFallbackAttemptedTrackId !== options.getCurrentTrack()?.id) {
			return true;
		}
		return streamingFallbackAttemptedQuality !== quality;
	};

	const executeFallback = async (plan: PlaybackFallbackPlan, attemptId: string) => {
		const track = plan.track;
		const opLogger = getCurrentPlaybackOperation();
		const originalTrackId = track.id;

		options.setResumeAfterFallback(true);
		try {
			if (plan.kind === 'dash') {
				options.setDashPlaybackActive(false);
				opLogger?.warn(`Attempting lossless fallback after DASH playback error (${plan.reason})`, {
					trackId: track.id,
					fallbackQuality: plan.quality,
					fallbackReason: plan.reason,
					phase: 'fallback_start'
				});
				playbackLogger.warn(`Attempting lossless fallback after DASH playback error (${plan.reason})`, {
					trackId: track.id,
					fallbackQuality: plan.quality,
					fallbackReason: plan.reason
				});
			} else {
				opLogger?.warn('Attempting streaming fallback after lossless error', {
					trackId: track.id,
					fallbackQuality: plan.quality,
					fallbackReason: plan.reason,
					phase: 'fallback_start'
				});
			}

			options.setLoading(true);
			options.onFallbackRequested?.(plan.quality, plan.reason);

			if (!options.isAttemptCurrent(attemptId)) {
				opLogger?.info('Aborting fallback - attempt changed before fallback load', {
					phase: 'fallback_loading',
					attemptId
				});
				return;
			}

			await options.loadStandardTrack(track, plan.quality, attemptId);

			const currentTrack = options.getCurrentTrack();
			if (currentTrack?.id !== originalTrackId) {
				opLogger?.info('Fallback completed but track changed, ignoring result', {
					phase: 'fallback_complete'
				});
			} else if (plan.kind === 'lossless') {
				opLogger?.info(`Streaming fallback loaded successfully for track ${track.id}`, {
					phase: 'fallback_complete',
					actualQuality: plan.quality
				});
			}
		} catch (fallbackError) {
			if (plan.kind === 'dash') {
				opLogger?.error(
					'Lossless fallback after DASH playback error failed',
					fallbackError instanceof Error ? fallbackError : undefined,
					{ phase: 'fallback_failed' }
				);
				playbackLogger.error(
					'Lossless fallback after DASH playback error failed',
					fallbackError instanceof Error ? fallbackError : undefined,
					{ trackId: track.id, fallbackQuality: plan.quality }
				);
			} else {
				opLogger?.error(
					'Streaming fallback after lossless playback error failed',
					fallbackError instanceof Error ? fallbackError : undefined,
					{ phase: 'fallback_failed' }
				);
				playbackLogger.error(
					'Streaming fallback after lossless playback error failed',
					fallbackError instanceof Error ? fallbackError : undefined,
					{ trackId: track.id, fallbackQuality: plan.quality }
				);
				options.setResumeAfterFallback(false);
			}
		} finally {
			options.setLoading(false);
			if (plan.kind === 'dash') {
				dashFallbackInFlight = false;
			} else {
				losslessFallbackInFlight = false;
			}
		}
	};

	const planFallback = (event: Event): PlaybackFallbackPlan | null => {
		let fallbackPlan: PlaybackFallbackPlan | null = null;
		const opLogger = getCurrentPlaybackOperation();
		const element = event.currentTarget as HTMLAudioElement | null;
		const mediaError = element?.error ?? null;
		const code = mediaError?.code;
		const track = options.getCurrentTrack();
		if (!track) {
			return null;
		}

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
			dashFallbackInFlight = true;
			dashFallbackAttemptedTrackId = track.id;
			fallbackPlan = {
				track: track as Track,
				quality: fallbackQuality,
				reason: `dash-playback-${reason}`,
				kind: 'dash'
			};
			return fallbackPlan;
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
			losslessFallbackAttemptedTrackId = track.id;
			losslessFallbackInFlight = true;
			fallbackPlan = {
				track: track as Track,
				quality: fallbackQuality,
				reason: 'lossless-playback',
				kind: 'lossless'
			};
			streamingFallbackAttemptedTrackId = track.id;
			streamingFallbackAttemptedQuality = fallbackQuality;
		}
		if (!fallbackPlan && currentPlayback === 'HIGH') {
			const shouldFallbackLower =
				codeNumber !== null &&
				codeNumber !== abortedCode &&
				((typeof decodeConstant === 'number' && codeNumber === decodeConstant) ||
					(typeof srcUnsupported === 'number' && codeNumber === srcUnsupported));
			if (shouldFallbackLower && canStartStreamingFallback('LOW')) {
				opLogger?.warn(
					'Streaming playback error detected; attempting lower quality fallback',
					{
						phase: 'error',
						errorCode: codeNumber ?? undefined
					}
				);
				streamingFallbackAttemptedTrackId = track.id;
				streamingFallbackAttemptedQuality = 'LOW';
				fallbackPlan = {
					track: track as Track,
					quality: 'LOW',
					reason: 'streaming-playback',
					kind: 'lossless'
				};
			}
		}
		return fallbackPlan;
	};

	return {
		resetForTrack,
		planFallback,
		executeFallback
	};
};
