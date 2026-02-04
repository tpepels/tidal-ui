import { toasts } from '$lib/stores/toasts';
import { convertSonglinkTrackToTidal } from '$lib/utils/trackConversion';
import { isSonglinkTrack } from '$lib/types';
import type { PlaybackEvent, SideEffect } from '$lib/machines/playbackMachine';
import type { AudioQuality, Track, PlayableTrack } from '$lib/types';
import { trackError } from '$lib/core/errorTracker';
import type { TrackLoadController } from '$lib/controllers/trackLoadController';
import {
	createPlaybackFallbackController,
	type PlaybackFallbackController
} from '$lib/controllers/playbackFallbackController';
import {
	startPlaybackOperation,
	type PlaybackOperationLogger
} from '$lib/core/playbackObservability';
import { areTestHooksEnabled } from '$lib/utils/testHooks';

const QUALITY_LABELS: Record<AudioQuality, string> = {
	HI_RES_LOSSLESS: 'Hi-Res',
	LOSSLESS: 'CD',
	HIGH: 'High',
	LOW: 'Low'
};

const testHooksEnabled = typeof window !== 'undefined' && areTestHooksEnabled();

/**
 * Check if an error is an AbortError from play() being interrupted by a new load.
 * This is expected behavior during fallback and should not be treated as a real error.
 */
const isPlayAbortError = (error: unknown): boolean => {
	if (!(error instanceof Error)) return false;
	if (error.name !== 'AbortError') return false;
	const message = error.message.toLowerCase();
	return (
		message.includes('interrupted by a new load request') ||
		message.includes('interrupted by a call to pause')
	);
};

const isNotAllowedPlayError = (error: unknown): boolean => {
	if (!(error instanceof Error)) return false;
	return (
		error.name === 'NotAllowedError' ||
		error.message.toLowerCase().includes('not allowed') ||
		error.message.toLowerCase().includes('user didn\'t interact')
	);
};

const formatQualityLabel = (quality: AudioQuality): string => QUALITY_LABELS[quality] ?? quality;

const formatFallbackToast = (
	quality: AudioQuality,
	reason: string,
	requestedQuality: AudioQuality | null
): { type: 'info' | 'warning'; message: string } => {
	const fallbackLabel = formatQualityLabel(quality);
	const requestedLabel =
		requestedQuality && requestedQuality !== quality
			? formatQualityLabel(requestedQuality)
			: null;

	if (reason === 'lossless-unsupported') {
		return {
			type: 'info',
			message: `Lossless playback isn't supported in this browser. Playing ${fallbackLabel}.`
		};
	}
	if (reason === 'track-quality') {
		const detail = requestedLabel ? ` in ${requestedLabel}` : '';
		return {
			type: 'info',
			message: `Track not available${detail}. Playing ${fallbackLabel}.`
		};
	}
	if (reason.startsWith('dash')) {
		return {
			type: 'warning',
			message: `Hi-Res playback failed. Playing ${fallbackLabel}.`
		};
	}
	if (reason === 'retry-lossless') {
		return {
			type: 'warning',
			message: `Playback issue detected. Switching to ${fallbackLabel}.`
		};
	}
	if (reason.startsWith('lossless')) {
		return {
			type: 'warning',
			message: `Lossless playback failed. Playing ${fallbackLabel}.`
		};
	}
	return {
		type: 'info',
		message: `Playback switched to ${fallbackLabel}.`
	};
};

type PlaybackLoadUiCallbacks = {
	setStreamUrl?: (url: string) => void;
	setBufferedPercent?: (value: number) => void;
	setCurrentPlaybackQuality?: (quality: AudioQuality | null) => void;
	setDashPlaybackActive?: (value: boolean) => void;
	setSampleRate?: (value: number | null) => void;
	setBitDepth?: (value: number | null) => void;
	setReplayGain?: (value: number | null) => void;
	getSupportsLosslessPlayback?: () => boolean;
	getStreamingFallbackQuality?: () => AudioQuality;
	isHiResQuality?: (quality: AudioQuality | undefined) => boolean;
	isFirefox?: () => boolean;
	preloadThresholdSeconds?: number;
};

export class PlaybackMachineSideEffectHandler {
	private audioElement: HTMLAudioElement | null = null;
	private getCurrentTrack: (() => PlayableTrack | null) | null = null;
	private getQueue: (() => PlayableTrack[]) | null = null;
	private getQueueIndex: (() => number) | null = null;
	private getPlaybackQuality: (() => AudioQuality) | null = null;
	private getIsPlaying: (() => boolean) | null = null;
	private loadUiCallbacks: PlaybackLoadUiCallbacks = {};
	private trackLoadController: TrackLoadController | null = null;
	private trackLoadControllerInit: Promise<void> | null = null;
	private playbackFallbackController: PlaybackFallbackController | null = null;
	private dispatch: ((event: PlaybackEvent) => void) | null = null;
	private currentTrackId: number | null = null;
	private currentPlaybackQuality: AudioQuality | null = null;
	private dashPlaybackActive = false;
	private requestedQuality: AudioQuality | null = null;
	private resumeAfterFallback = false;
	private lastFallbackToastKey: string | null = null;
	private lastFallbackToastAt = 0;
	private pendingLoad: { track: Track; quality: AudioQuality; attemptId: string } | null = null;
	private playbackOpLogger: PlaybackOperationLogger | null = null;
	/**
	 * Current attemptId for stale event detection.
	 * Async callbacks should check this before mutating state.
	 */
	private currentAttemptId: string | null = null;
	private losslessPlaybackDisabled = false;
	private pendingPlay = false;

	constructor(options?: {
		getCurrentTrack?: () => PlayableTrack | null;
		getQueue?: () => PlayableTrack[];
		getQueueIndex?: () => number;
		getPlaybackQuality?: () => AudioQuality;
		getIsPlaying?: () => boolean;
	}) {
		this.getCurrentTrack = options?.getCurrentTrack ?? null;
		this.getQueue = options?.getQueue ?? null;
		this.getQueueIndex = options?.getQueueIndex ?? null;
		this.getPlaybackQuality = options?.getPlaybackQuality ?? null;
		this.getIsPlaying = options?.getIsPlaying ?? null;
	}

	private getPlaybackStateSnapshot(): {
		currentTrack: PlayableTrack | null;
		queue: PlayableTrack[];
		queueIndex: number;
		quality: AudioQuality;
	} {
		const fallbackQuality: AudioQuality = this.getPlaybackQuality?.() ?? this.requestedQuality ?? 'HIGH';
		return {
			currentTrack: this.getCurrentTrack?.() ?? null,
			queue: this.getQueue?.() ?? [],
			queueIndex: this.getQueueIndex?.() ?? -1,
			quality: fallbackQuality
		};
	}

	/**
	 * Check if an attemptId is stale (no longer the current attempt).
	 * Used to ignore async callbacks from previous playback attempts.
	 */
	private isStaleAttempt(attemptId: string): boolean {
		const isStale = this.currentAttemptId !== null && this.currentAttemptId !== attemptId;
		if (isStale) {
			this.playbackOpLogger?.debug(`Ignoring stale attempt [${attemptId}], current is [${this.currentAttemptId}]`, {
				phase: 'load_start'
			});
		}
		return isStale;
	}

	/**
	 * Get the current attemptId for passing to async operations.
	 */
	getCurrentAttemptId(): string | null {
		return this.currentAttemptId;
	}

	/**
	 * Sync the current attemptId with the playback machine context.
	 * Ensures fallback/retry attemptIds are treated as current.
	 */
	setCurrentAttemptId(attemptId: string | null) {
		if (attemptId) {
			this.currentAttemptId = attemptId;
		}
	}

	setAudioElement(element: HTMLAudioElement | null) {
		if (!element && this.trackLoadController) {
			void this.trackLoadController.destroy().catch((error) => {
				console.debug('Shaka cleanup failed', error);
			});
			this.trackLoadController = null;
			this.playbackFallbackController = null;
		}
		this.audioElement = element;
		if (element && this.pendingLoad) {
			const pending = this.pendingLoad;
			this.pendingLoad = null;
			void this.ensureLoadControllers()
				.then(async () => {
					// Validate attemptId before processing queued load
					if (this.isStaleAttempt(pending.attemptId)) {
						return;
					}
					this.playbackFallbackController?.resetForTrack(pending.track.id);
					await this.trackLoadController?.loadTrack(pending.track, pending.attemptId);
				})
				.catch((error) => {
					// Validate attemptId before dispatching error
					if (this.isStaleAttempt(pending.attemptId)) {
						return;
					}
					const failure = error instanceof Error ? error : new Error('Failed to load track');
					trackError(failure, {
						component: 'playback-effects',
						domain: 'playback',
						source: 'pending-load',
						trackId: pending.track.id,
						quality: pending.quality,
						attemptId: pending.attemptId
					});
					this.dispatch?.({ type: 'LOAD_ERROR', error: failure });
				});
		}
	}

	setLoadUiCallbacks(callbacks: PlaybackLoadUiCallbacks) {
		this.loadUiCallbacks = callbacks;
	}

	maybePreloadNextTrack(remainingSeconds: number) {
		this.trackLoadController?.maybePreloadNextTrack(remainingSeconds);
	}

	private async ensureLoadControllers() {
		if (!this.audioElement || this.trackLoadController) {
			return;
		}
		if (this.trackLoadControllerInit) {
			await this.trackLoadControllerInit;
			return;
		}
		this.trackLoadControllerInit = this.initializeLoadControllers();
		try {
			await this.trackLoadControllerInit;
		} finally {
			this.trackLoadControllerInit = null;
		}
	}

	private async initializeLoadControllers() {
		if (!this.audioElement || this.trackLoadController) {
			return;
		}
		const { createTrackLoadController } = await import('$lib/controllers/trackLoadController');
		const hiResCheck =
			this.loadUiCallbacks.isHiResQuality ??
			((quality?: AudioQuality) => (quality ? quality === 'HI_RES_LOSSLESS' : false));
		const preloadThreshold = this.loadUiCallbacks.preloadThresholdSeconds ?? 12;

		this.trackLoadController = createTrackLoadController({
			getPlaybackState: () => this.getPlaybackStateSnapshot(),
			getAudioElement: () => this.audioElement,
			getCurrentTrackId: () => this.currentTrackId,
			getSupportsLosslessPlayback: () =>
				this.losslessPlaybackDisabled
					? false
					: this.loadUiCallbacks.getSupportsLosslessPlayback?.() ?? true,
			setStreamUrl: (value) => this.loadUiCallbacks.setStreamUrl?.(value),
			setBufferedPercent: (value) => this.loadUiCallbacks.setBufferedPercent?.(value),
			setCurrentPlaybackQuality: (value) => {
				this.currentPlaybackQuality = value;
				this.loadUiCallbacks.setCurrentPlaybackQuality?.(value);
			},
			setDashPlaybackActive: (value) => {
				this.dashPlaybackActive = value;
				this.loadUiCallbacks.setDashPlaybackActive?.(value);
			},
			setLoading: () => {},
			setSampleRate: (value) => this.loadUiCallbacks.setSampleRate?.(value),
			setBitDepth: (value) => this.loadUiCallbacks.setBitDepth?.(value),
			setReplayGain: (value) => this.loadUiCallbacks.setReplayGain?.(value),
			isAttemptCurrent: (attemptId: string) => !this.isStaleAttempt(attemptId),
			isHiResQuality: hiResCheck,
			preloadThresholdSeconds: preloadThreshold,
			getPlaybackQuality: () =>
				this.requestedQuality ?? this.getPlaybackQuality?.() ?? 'HIGH',
			getStreamingFallbackQuality: () =>
				this.loadUiCallbacks.getStreamingFallbackQuality?.() ??
				(this.loadUiCallbacks.isFirefox?.() ? 'LOW' : 'HIGH'),
			onLoadComplete: (url, quality) => {
				const wasFallback = this.resumeAfterFallback;
				if (this.resumeAfterFallback) {
					this.resumeAfterFallback = false;
				}

				// Log load completion
				if (wasFallback) {
					this.playbackOpLogger?.fallbackComplete(quality, true);
				} else {
					this.playbackOpLogger?.loadComplete(quality, url ?? undefined);
				}

				this.dispatch?.({ type: 'LOAD_COMPLETE', streamUrl: url ?? null, quality });
			},
			onLoadError: (error) => {
				const err = error instanceof Error ? error : new Error('Failed to load track');
				this.playbackOpLogger?.error('Track load error', err, { phase: 'error' });
				this.dispatch?.({
					type: 'LOAD_ERROR',
					error: err
				});
			},
			onFallbackRequested: (quality, reason) => {
				// Use currentPlaybackQuality if available, otherwise fall back to requestedQuality
				const fromQuality = this.currentPlaybackQuality || this.requestedQuality || 'unknown';
				this.playbackOpLogger?.fallbackStarted(
					fromQuality,
					quality,
					reason
				);
				this.notifyFallback(quality, reason);
				this.dispatch?.({ type: 'FALLBACK_REQUESTED', quality, reason });
			}
		});

		this.playbackFallbackController = createPlaybackFallbackController({
			getCurrentTrack: () => this.getCurrentTrack?.() ?? null,
			getPlayerQuality: () => this.getPlaybackQuality?.() ?? 'HIGH',
			getCurrentPlaybackQuality: () => this.currentPlaybackQuality,
			getIsPlaying: () => this.getIsPlaying?.() ?? false,
			getSupportsLosslessPlayback: () =>
				this.losslessPlaybackDisabled
					? false
					: this.loadUiCallbacks.getSupportsLosslessPlayback?.() ?? true,
			getStreamingFallbackQuality: () =>
				this.loadUiCallbacks.getStreamingFallbackQuality?.() ??
				(this.loadUiCallbacks.isFirefox?.() ? 'LOW' : 'HIGH'),
			isFirefox: () => this.loadUiCallbacks.isFirefox?.() ?? false,
			getDashPlaybackActive: () => this.dashPlaybackActive,
			setDashPlaybackActive: (value) => {
				this.dashPlaybackActive = value;
				this.loadUiCallbacks.setDashPlaybackActive?.(value);
			},
			setLoading: () => {},
			loadStandardTrack: async (track, quality, attemptId) => {
				await this.trackLoadController?.loadStandardTrack(track, quality, attemptId);
			},
			getAttemptId: () => this.currentAttemptId,
			isAttemptCurrent: (attemptId: string) => !this.isStaleAttempt(attemptId),
			setResumeAfterFallback: (value) => {
				this.resumeAfterFallback = value;
			},
			onFallbackRequested: (quality, reason) => {
				// Use currentPlaybackQuality if available for accurate logging
				const fromQuality = this.currentPlaybackQuality || this.requestedQuality || 'unknown';
				this.playbackOpLogger?.fallbackStarted(fromQuality, quality, reason);
				this.notifyFallback(quality, reason);
			}
		});
	}

	private notifyFallback(quality: AudioQuality, reason: string) {
		const trackKey = this.currentTrackId ?? 'unknown';
		const key = `${trackKey}:${quality}:${reason}`;
		const now = Date.now();
		if (this.lastFallbackToastKey === key && now - this.lastFallbackToastAt < 8000) {
			return;
		}
		this.lastFallbackToastKey = key;
		this.lastFallbackToastAt = now;

		const { type, message } = formatFallbackToast(quality, reason, this.requestedQuality);
		if (type === 'warning') {
			toasts.warning(message, { duration: 4500 });
		} else {
			toasts.info(message, { duration: 3500 });
		}
	}

	private requestPlay() {
		if (!this.audioElement) {
			return;
		}
		this.playbackOpLogger?.playing();
		const promise = this.audioElement.play();
		if (promise) {
			promise.catch((error) => {
				// AbortError is expected when a new load interrupts play() during fallback
				if (isPlayAbortError(error)) {
					this.playbackOpLogger?.debug('Play interrupted by new load (expected during fallback)', {
						phase: 'playing'
					});
					return;
				}
				if (isNotAllowedPlayError(error)) {
					this.playbackOpLogger?.warn('Play blocked by browser autoplay policy', {
						phase: 'error'
					});
					this.dispatch?.({ type: 'AUDIO_PAUSED' });
					return;
				}
				this.playbackOpLogger?.error('Play failed', error instanceof Error ? error : undefined, {
					phase: 'error'
				});
				trackError(error instanceof Error ? error : new Error('Play failed'), {
					component: 'playback-effects',
					domain: 'playback',
					source: 'play-audio'
				});
				this.dispatch?.({ type: 'AUDIO_WAITING' });
			});
		}
	}

	async execute(
		effect: SideEffect,
		dispatch: (event: PlaybackEvent) => void
	): Promise<void> {
		this.dispatch = dispatch;
		switch (effect.type) {
			case 'CONVERT_SONGLINK': {
				const conversionAttemptId = effect.attemptId;

				if (!isSonglinkTrack(effect.track)) {
					dispatch({
						type: 'CONVERSION_ERROR',
						error: new Error('Conversion requested for non-Songlink track')
					});
					break;
				}
				const conversion = await convertSonglinkTrackToTidal(effect.track);
				// Validate attemptId before dispatching result
				if (this.isStaleAttempt(conversionAttemptId)) {
					break;
				}
				if (conversion.success && conversion.track) {
					dispatch({ type: 'CONVERSION_COMPLETE', track: conversion.track });
				} else {
					dispatch({
						type: 'CONVERSION_ERROR',
						error: new Error(conversion.error?.message ?? 'Conversion failed')
					});
				}
				break;
			}

			case 'LOAD_STREAM': {
				this.requestedQuality = effect.quality;
				this.currentTrackId = effect.track.id;
				this.currentPlaybackQuality = null;
				this.dashPlaybackActive = false;
				this.loadUiCallbacks.setDashPlaybackActive?.(false);
				this.pendingPlay = false;

				// Start new playback operation for observability
				this.playbackOpLogger = startPlaybackOperation(effect.track.id, {
					trackTitle: effect.track.title,
					artistName: effect.track.artist?.name,
					requestedQuality: effect.quality,
					quality: effect.quality,
					attemptId: effect.attemptId
				});

				if (!this.audioElement) {
					this.playbackOpLogger.debug('Audio element not ready, queuing load', {
						phase: 'load_start',
						attemptId: effect.attemptId
					});
					this.pendingLoad = { track: effect.track, quality: effect.quality, attemptId: effect.attemptId };
					break;
				}
				await this.ensureLoadControllers();
				this.playbackFallbackController?.resetForTrack(effect.track.id);
				if (this.trackLoadController) {
					try {
						await this.trackLoadController.loadTrack(effect.track, effect.attemptId);
					} catch (error) {
						const failure =
							error instanceof Error ? error : new Error('Failed to load track');
						this.playbackOpLogger.error('Track load failed', failure, {
							phase: 'error'
						});
						trackError(failure, {
							component: 'playback-effects',
							domain: 'playback',
							source: 'load-stream',
							trackId: effect.track.id,
							quality: effect.quality
						});
						this.dispatch?.({ type: 'LOAD_ERROR', error: failure });
					}
				}
				break;
			}

			case 'SET_AUDIO_SRC': {
				// Validate attemptId before setting audio source
				if (this.isStaleAttempt(effect.attemptId)) {
					this.playbackOpLogger?.debug('Ignoring SET_AUDIO_SRC from stale attempt', {
						phase: 'load_start',
						attemptId: effect.attemptId
					});
					break;
				}
				if (this.audioElement) {
					// Reset any prior error state before swapping sources.
					if (this.audioElement.error || this.audioElement.src) {
						this.audioElement.pause();
						this.audioElement.removeAttribute('src');
						this.audioElement.load();
					}
					this.audioElement.dataset.playbackAttemptId = effect.attemptId;
					this.audioElement.crossOrigin = 'anonymous';
					this.audioElement.src = effect.url;
					this.audioElement.load();
					const shouldPlay =
						this.pendingPlay || (this.getIsPlaying?.() ?? false);
					if (shouldPlay) {
						this.pendingPlay = false;
						queueMicrotask(() => this.requestPlay());
					}
				}
				if (testHooksEnabled && typeof window !== 'undefined') {
					const testWindow = window as typeof window & { __playSrcs?: string[] };
					if (Array.isArray(testWindow.__playSrcs) && effect.url) {
						testWindow.__playSrcs.push(effect.url);
					}
				}
				break;
			}

			case 'PLAY_AUDIO': {
				if (this.audioElement) {
					if (!this.audioElement.src) {
						this.pendingPlay = true;
						this.playbackOpLogger?.debug('Deferring play until audio src is set', {
							phase: 'playing'
						});
						break;
					}
					this.requestPlay();
				}
				break;
			}

			case 'PAUSE_AUDIO': {
				if (this.audioElement) {
					this.playbackOpLogger?.paused();
					this.audioElement.pause();
				}
				break;
			}

			case 'RESET_AUDIO': {
				this.pendingPlay = false;
				this.pendingLoad = null;
				this.resumeAfterFallback = false;
				this.lastFallbackToastKey = null;
				this.lastFallbackToastAt = 0;
				this.currentTrackId = null;
				this.currentPlaybackQuality = null;
				this.dashPlaybackActive = false;
				this.requestedQuality = null;
				this.playbackOpLogger = null;
				this.losslessPlaybackDisabled = false;
				this.loadUiCallbacks.setDashPlaybackActive?.(false);
				this.loadUiCallbacks.setStreamUrl?.('');
				this.loadUiCallbacks.setBufferedPercent?.(0);
				this.loadUiCallbacks.setCurrentPlaybackQuality?.(null);
				this.loadUiCallbacks.setSampleRate?.(null);
				this.loadUiCallbacks.setBitDepth?.(null);
				this.loadUiCallbacks.setReplayGain?.(null);
				if (this.audioElement) {
					this.audioElement.pause();
					this.audioElement.removeAttribute('src');
					this.audioElement.load();
					delete this.audioElement.dataset.playbackAttemptId;
				}
				break;
			}

			case 'SEEK_AUDIO': {
				if (this.audioElement) {
					this.playbackOpLogger?.seeked(effect.position);
					this.audioElement.currentTime = effect.position;
				}
				break;
			}

			case 'SHOW_ERROR': {
				toasts.error(effect.error.message);
				break;
			}

			case 'HANDLE_AUDIO_ERROR': {
				// Validate attemptId before processing audio error
				if (this.isStaleAttempt(effect.attemptId)) {
					this.playbackOpLogger?.debug('Ignoring audio error from stale attempt', {
						phase: 'error',
						attemptId: effect.attemptId
					});
					break;
				}

				if (!this.playbackFallbackController && this.audioElement) {
					await this.ensureLoadControllers();
				}
				const fallbackPlan =
					this.playbackFallbackController?.planFallback(effect.error) ?? null;
				const element = (effect.error as Event)?.currentTarget as HTMLMediaElement | null;
				const mediaError = element?.error ?? null;
				const code = mediaError?.code;
				const srcUnsupported =
					typeof mediaError?.MEDIA_ERR_SRC_NOT_SUPPORTED === 'number'
						? mediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
						: null;
				const decodeConstant =
					typeof mediaError?.MEDIA_ERR_DECODE === 'number'
						? mediaError.MEDIA_ERR_DECODE
						: null;
				const isLosslessUnsupported =
					typeof code === 'number' &&
					(code === srcUnsupported || code === decodeConstant);
				if (fallbackPlan?.reason === 'lossless-playback' && isLosslessUnsupported) {
					this.losslessPlaybackDisabled = true;
					this.playbackOpLogger?.warn(
						'Disabling lossless playback for this session after unsupported stream error',
						{ phase: 'error' }
					);
				}
				const isSyntheticError =
					testHooksEnabled && !((effect.error as Event | undefined)?.isTrusted ?? true);
				const requestedQuality = this.requestedQuality ?? this.getPlaybackQuality?.() ?? null;
				const shouldForceFallback =
					isSyntheticError &&
					(requestedQuality === 'LOSSLESS' || requestedQuality === 'HI_RES_LOSSLESS');
				if (!fallbackPlan && shouldForceFallback) {
					const fallbackQuality: AudioQuality =
						this.loadUiCallbacks.getStreamingFallbackQuality?.() ??
						(this.loadUiCallbacks.isFirefox?.() ? 'LOW' : 'HIGH');
					const currentTrack = this.getCurrentTrack?.() ?? null;
					if (currentTrack && !isSonglinkTrack(currentTrack)) {
						this.dispatch?.({
							type: 'FALLBACK_REQUESTED',
							quality: fallbackQuality,
							reason: 'lossless-playback'
						});
						dispatch({ type: 'AUDIO_WAITING' });
						const attemptId = this.currentAttemptId;
						if (attemptId && this.playbackFallbackController) {
							await this.playbackFallbackController.executeFallback(
								{
									track: currentTrack as Track,
									quality: fallbackQuality,
									reason: 'lossless-playback',
									kind: 'lossless'
								},
								attemptId
							);
						}
					} else {
						dispatch({
							type: 'LOAD_ERROR',
							error: new Error('Audio playback error')
						});
					}
					break;
				}
				if (!fallbackPlan) {
					const details =
						typeof code === 'number' ? ` (code ${code})` : '';

					// Log non-recoverable audio error
					this.playbackOpLogger?.audioError(
						typeof code === 'number' ? code : -1,
						`Audio playback error${details}`,
						false
					);

					dispatch({
						type: 'LOAD_ERROR',
						error: new Error(`Audio playback error${details}`)
					});
				} else {
					// Log recoverable audio error triggering fallback
					const element = (effect.error as Event)?.currentTarget as HTMLMediaElement | null;
					const mediaError = element?.error ?? null;
					const code = mediaError?.code;
					this.playbackOpLogger?.audioError(
						typeof code === 'number' ? code : -1,
						`Audio error triggering fallback: ${fallbackPlan.reason}`,
						true
					);
					this.dispatch?.({
						type: 'FALLBACK_REQUESTED',
						quality: fallbackPlan.quality,
						reason: fallbackPlan.reason
					});
					dispatch({ type: 'AUDIO_WAITING' });
					const attemptId = this.currentAttemptId;
					if (attemptId && this.playbackFallbackController) {
						await this.playbackFallbackController.executeFallback(fallbackPlan, attemptId);
					}
				}
				break;
			}

		}
	}
}
