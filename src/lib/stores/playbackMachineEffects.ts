import { losslessAPI } from '$lib/api';
import { toasts } from '$lib/stores/toasts';
import { API_CONFIG } from '$lib/config';
import { convertSonglinkTrackToTidal } from '$lib/utils/trackConversion';
import { isSonglinkTrack } from '$lib/types';
import type { PlaybackEvent, SideEffect } from '$lib/machines/playbackMachine';
import type { Track } from '$lib/types';

export class PlaybackMachineSideEffectHandler {
	private audioElement: HTMLAudioElement | null = null;
	private pendingLoadRequestId: number | null = null;
	private useExternalStreamLoader = false;
	private syncPlayerTrack: ((track: Track) => void) | null = null;

	constructor(options?: { syncPlayerTrack?: (track: Track) => void }) {
		this.syncPlayerTrack = options?.syncPlayerTrack ?? null;
	}

	setAudioElement(element: HTMLAudioElement | null) {
		this.audioElement = element;
	}

	setUseExternalStreamLoader(enabled: boolean) {
		this.useExternalStreamLoader = enabled;
	}

	async execute(
		effect: SideEffect,
		dispatch: (event: PlaybackEvent) => void
	): Promise<void> {
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
				if (this.useExternalStreamLoader) {
					return;
				}
				// Store the request ID to check for stale requests
				const requestId = effect.requestId;
				this.pendingLoadRequestId = requestId;

				try {
					const data = await losslessAPI.getStreamData(effect.track.id, effect.quality);
					const url =
						API_CONFIG.useProxy && API_CONFIG.proxyUrl
							? `${API_CONFIG.proxyUrl}?url=${encodeURIComponent(data.url)}`
							: data.url;

					// Check if this request is still current
					if (this.pendingLoadRequestId === requestId) {
						dispatch({
							type: 'LOAD_COMPLETE',
							streamUrl: url,
							quality: effect.quality
						});
					} else {
						console.log('[PlaybackMachine] Ignoring stale stream load', {
							requestId,
							current: this.pendingLoadRequestId
						});
					}
				} catch (error) {
					// Only dispatch error if this request is still current
					if (this.pendingLoadRequestId === requestId) {
						dispatch({
							type: 'LOAD_ERROR',
							error: error instanceof Error ? error : new Error('Failed to load stream')
						});
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

			case 'SYNC_PLAYER_TRACK': {
				this.syncPlayerTrack?.(effect.track);
				break;
			}
		}
	}
}
