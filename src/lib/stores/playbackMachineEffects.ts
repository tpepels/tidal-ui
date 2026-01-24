import { toasts } from '$lib/stores/toasts';
import { convertSonglinkTrackToTidal } from '$lib/utils/trackConversion';
import { isSonglinkTrack } from '$lib/types';
import type { PlaybackEvent, SideEffect } from '$lib/machines/playbackMachine';
import type { AudioQuality, Track } from '$lib/types';
import { playerStore } from '$lib/stores/player';
import { trackError } from '$lib/core/errorTracker';
import type { TrackLoadController } from '$lib/controllers/trackLoadController';
import {
	createPlaybackFallbackController,
	type PlaybackFallbackController
} from '$lib/controllers/playbackFallbackController';

const QUALITY_LABELS: Record<AudioQuality, string> = {
	HI_RES_LOSSLESS: 'Hi-Res',
	LOSSLESS: 'CD',
	HIGH: 'High',
	LOW: 'Low'
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
	private syncPlayerTrack: ((track: Track) => void) | null = null;
	private loadUiCallbacks: PlaybackLoadUiCallbacks = {};
	private trackLoadController: TrackLoadController | null = null;
	private trackLoadControllerInit: Promise<void> | null = null;
	private playbackFallbackController: PlaybackFallbackController | null = null;
	private dispatch: ((event: PlaybackEvent) => void) | null = null;
	private loadSequence = 0;
	private currentTrackId: number | null = null;
	private currentPlaybackQuality: AudioQuality | null = null;
	private dashPlaybackActive = false;
	private requestedQuality: AudioQuality | null = null;
	private resumeAfterFallback = false;
	private lastFallbackToastKey: string | null = null;
	private lastFallbackToastAt = 0;

	constructor(options?: { syncPlayerTrack?: (track: Track) => void }) {
		this.syncPlayerTrack = options?.syncPlayerTrack ?? null;
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
			playerStore,
			getAudioElement: () => this.audioElement,
			getCurrentTrackId: () => this.currentTrackId,
			getSupportsLosslessPlayback: () =>
				this.loadUiCallbacks.getSupportsLosslessPlayback?.() ?? true,
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
			createSequence: () => ++this.loadSequence,
			getSequence: () => this.loadSequence,
			isHiResQuality: hiResCheck,
			preloadThresholdSeconds: preloadThreshold,
			getPlaybackQuality: () => this.requestedQuality ?? playerStore.getSnapshot().quality,
			getStreamingFallbackQuality: () =>
				this.loadUiCallbacks.getStreamingFallbackQuality?.() ??
				(this.loadUiCallbacks.isFirefox?.() ? 'LOW' : 'HIGH'),
			onLoadComplete: (url, quality) => {
				if (this.resumeAfterFallback) {
					this.resumeAfterFallback = false;
				}
				this.dispatch?.({ type: 'LOAD_COMPLETE', streamUrl: url ?? null, quality });
			},
			onLoadError: (error) => {
				this.dispatch?.({
					type: 'LOAD_ERROR',
					error: error instanceof Error ? error : new Error('Failed to load track')
				});
			},
			onFallbackRequested: (quality, reason) => {
				this.notifyFallback(quality, reason);
				this.dispatch?.({ type: 'FALLBACK_REQUESTED', quality, reason });
			}
		});

		this.playbackFallbackController = createPlaybackFallbackController({
			getCurrentTrack: () => playerStore.getSnapshot().currentTrack,
			getPlayerQuality: () => playerStore.getSnapshot().quality,
			getCurrentPlaybackQuality: () => this.currentPlaybackQuality,
			getIsPlaying: () => playerStore.getSnapshot().isPlaying,
			getSupportsLosslessPlayback: () =>
				this.loadUiCallbacks.getSupportsLosslessPlayback?.() ?? true,
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
			loadStandardTrack: async (track, quality, sequence) => {
				await this.trackLoadController?.loadStandardTrack(track, quality, sequence);
			},
			createSequence: () => ++this.loadSequence,
			setResumeAfterFallback: (value) => {
				this.resumeAfterFallback = value;
			},
			onFallbackRequested: (quality, reason) => {
				this.notifyFallback(quality, reason);
				this.dispatch?.({ type: 'FALLBACK_REQUESTED', quality, reason });
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

	async execute(
		effect: SideEffect,
		dispatch: (event: PlaybackEvent) => void
	): Promise<void> {
		this.dispatch = dispatch;
		switch (effect.type) {
			case 'CONVERT_SONGLINK': {
				if (!isSonglinkTrack(effect.track)) {
					dispatch({
						type: 'CONVERSION_ERROR',
						error: new Error('Conversion requested for non-Songlink track')
					});
					break;
				}
				const conversion = await convertSonglinkTrackToTidal(effect.track);
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
				await this.ensureLoadControllers();
				this.requestedQuality = effect.quality;
				this.currentTrackId = effect.track.id;
				this.playbackFallbackController?.resetForTrack(effect.track.id);
				if (this.trackLoadController) {
					try {
						await this.trackLoadController.loadTrack(effect.track);
					} catch (error) {
						const failure =
							error instanceof Error ? error : new Error('Failed to load track');
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
				if (this.audioElement) {
					this.audioElement.src = effect.url;
					this.audioElement.load();
				}
				break;
			}

			case 'PLAY_AUDIO': {
				if (this.audioElement) {
					const promise = this.audioElement.play();
					if (promise) {
						promise.catch((error) => {
							console.error('[PlaybackMachine] Play failed:', error);
							trackError(error instanceof Error ? error : new Error('Play failed'), {
								component: 'playback-effects',
								domain: 'playback',
								source: 'play-audio'
							});
							dispatch({ type: 'AUDIO_ERROR', error });
						});
					}
				}
				break;
			}

			case 'PAUSE_AUDIO': {
				if (this.audioElement) {
					this.audioElement.pause();
				}
				break;
			}

			case 'SEEK_AUDIO': {
				if (this.audioElement) {
					this.audioElement.currentTime = effect.position;
				}
				break;
			}

			case 'SHOW_ERROR': {
				toasts.error(effect.error.message);
				break;
			}

			case 'HANDLE_AUDIO_ERROR': {
				const didFallback =
					this.playbackFallbackController?.handleAudioError(effect.error) ?? false;
				if (!didFallback) {
					const element = (effect.error as Event)?.currentTarget as HTMLMediaElement | null;
					const mediaError = element?.error ?? null;
					const code = mediaError?.code;
					const details =
						typeof code === 'number' ? ` (code ${code})` : '';
					dispatch({
						type: 'LOAD_ERROR',
						error: new Error(`Audio playback error${details}`)
					});
				}
				break;
			}

			case 'SYNC_PLAYER_TRACK': {
				this.syncPlayerTrack?.(effect.track);
				break;
			}
		}
	}
}
