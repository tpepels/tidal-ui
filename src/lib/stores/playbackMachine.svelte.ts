/**
 * Playback Machine Store
 *
 * Svelte 5 runes-based store that wraps the playback state machine.
 * This provides reactive state management with explicit state transitions.
 */

import {
	type PlaybackMachineState,
	type PlaybackEvent,
	transition,
	createInitialState,
	deriveSideEffects
} from '$lib/machines/playbackMachine';
import type { PlayableTrack, AudioQuality } from '$lib/types';
import { isSonglinkTrack } from '$lib/types';
import { playerStore } from '$lib/stores/player';
import { areTestHooksEnabled } from '$lib/utils/testHooks';
import { syncPlayerStoreFromMachine } from '$lib/stores/playbackMachineSync';
import { PlaybackMachineSideEffectHandler } from '$lib/stores/playbackMachineEffects';
import { get } from 'svelte/store';

/**
 * Side effect handlers
 * These execute the actual side effects derived from state transitions
 */
/**
 * Creates a playback machine store
 */
export function createPlaybackMachineStore(initialQuality: AudioQuality = 'HIGH') {
	const initialSnapshot = playerStore.getSnapshot();
	let machineState = $state<PlaybackMachineState>(
		createInitialState(initialSnapshot.quality ?? initialQuality)
	);
	machineState = {
		...machineState,
		context: {
			...machineState.context,
			currentTrack: initialSnapshot.currentTrack,
			queue: initialSnapshot.queue,
			queueIndex: initialSnapshot.queueIndex,
			currentTime: initialSnapshot.currentTime,
			duration: initialSnapshot.duration,
			volume: initialSnapshot.volume,
			isMuted: initialSnapshot.volume === 0
		}
	};
	const subscribers = new Set<(state: PlaybackMachineState) => void>();
	let pendingSyncState: PlaybackMachineState | null = null;
	let syncScheduled = false;
	const qualitySyncEnabled = import.meta.env.VITE_PLAYBACK_MACHINE_QUALITY_SOT === 'true';
	const effectHandler = new PlaybackMachineSideEffectHandler({
		syncPlayerTrack: (track) => {
			const state = get(playerStore);
			const current = state.currentTrack;
			if (!current || current.id !== track.id || isSonglinkTrack(current)) {
				playerStore.setTrack(track);
			}
		}
	});

	/**
	 * Dispatch an event to the state machine
	 * This is the primary API for interacting with the machine
	 */
	function dispatch(event: PlaybackEvent) {
		const prevState = machineState;
		const nextState = transition(machineState, event);

		// Update state
		machineState = nextState;
		schedulePlayerSync(nextState);
		for (const subscriber of subscribers) {
			subscriber(nextState);
		}

		// Execute side effects
		const effects = deriveSideEffects(prevState, nextState, event);
		for (const effect of effects) {
			effectHandler.execute(effect, dispatch).catch((error) => {
				console.error('[PlaybackMachine] Side effect error:', error);
			});
		}

		// Log transition for debugging
		if (import.meta.env.DEV) {
			console.log('[PlaybackMachine] Transition:', {
				from: prevState.state,
				to: nextState.state,
				event: event.type,
				effects: effects.map((e) => e.type)
			});
		}
	}

	if (qualitySyncEnabled) {
		let lastQuality = playerStore.getSnapshot().quality;
		playerStore.subscribe((state) => {
			if (state.quality === lastQuality) {
				return;
			}
			lastQuality = state.quality;
			if (state.quality !== machineState.context.quality) {
				dispatch({ type: 'CHANGE_QUALITY', quality: state.quality });
			}
		});
	}

	/**
	 * Set the audio element reference for side effects
	 */
	function setAudioElement(element: HTMLAudioElement | null) {
		effectHandler.setAudioElement(element);
	}

	function setLoadUiCallbacks(callbacks: {
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
	}) {
		effectHandler.setLoadUiCallbacks(callbacks);
	}

	function maybePreloadNextTrack(remainingSeconds: number) {
		effectHandler.maybePreloadNextTrack(remainingSeconds);
	}

	/**
	 * High-level actions (convenience methods)
	 */
	function schedulePlayerSync(next: PlaybackMachineState) {
		pendingSyncState = next;
		if (syncScheduled) {
			return;
		}
		syncScheduled = true;
		queueMicrotask(() => {
			syncScheduled = false;
			if (pendingSyncState) {
				syncPlayerStore(pendingSyncState);
			}
		});
	}

	const actions = {
		loadTrack(track: PlayableTrack) {
			dispatch({ type: 'LOAD_TRACK', track });
		},
		setQueue(queue: PlayableTrack[], queueIndex: number) {
			dispatch({ type: 'SET_QUEUE', queue, queueIndex });
		},

		play() {
			dispatch({ type: 'PLAY' });
		},

		pause() {
			dispatch({ type: 'PAUSE' });
		},

		seek(position: number) {
			dispatch({ type: 'SEEK', position });
		},
		updateTime(position: number) {
			dispatch({ type: 'TIME_UPDATE', position });
		},
		updateDuration(duration: number) {
			dispatch({ type: 'DURATION_UPDATE', duration });
		},
		updateVolume(volume: number) {
			dispatch({ type: 'VOLUME_UPDATE', volume });
		},
		updateMuted(isMuted: boolean) {
			dispatch({ type: 'MUTE_UPDATE', isMuted });
		},

		changeQuality(quality: AudioQuality) {
			dispatch({ type: 'CHANGE_QUALITY', quality });
		},

		// Audio element event handlers
		onAudioReady() {
			dispatch({ type: 'AUDIO_READY' });
		},

		onAudioPlaying() {
			dispatch({ type: 'AUDIO_PLAYING' });
		},

		onAudioPaused() {
			dispatch({ type: 'AUDIO_PAUSED' });
		},

		onAudioWaiting() {
			dispatch({ type: 'AUDIO_WAITING' });
		},

		onAudioError(error: Event) {
			dispatch({ type: 'AUDIO_ERROR', error });
		},

		onTrackEnd() {
			dispatch({ type: 'TRACK_END' });
		}
	};

	function syncPlayerStore(next: PlaybackMachineState) {
		syncPlayerStoreFromMachine(next);
	}

	return {
		// Reactive state
		get state() {
			return machineState.state;
		},
		get context() {
			return machineState.context;
		},
		get currentTrack() {
			return machineState.context.currentTrack;
		},
		get streamUrl() {
			return machineState.context.streamUrl;
		},
		get currentTime() {
			return machineState.context.currentTime;
		},
		get duration() {
			return machineState.context.duration;
		},
		get volume() {
			return machineState.context.volume;
		},
		get isMuted() {
			return machineState.context.isMuted;
		},
		/**
		 * User's requested/preferred quality setting.
		 */
		get quality() {
			return machineState.context.quality;
		},
		/**
		 * The actual quality currently being played.
		 * May differ from `quality` after fallback (e.g., LOSSLESS → HIGH).
		 * Null when not actively playing a stream.
		 */
		get effectiveQuality() {
			return machineState.context.effectiveQuality;
		},
		get isPlaying() {
			return machineState.state === 'playing';
		},
		get isPaused() {
			return machineState.state === 'paused';
		},
		get isLoading() {
			return machineState.state === 'loading' || machineState.state === 'converting';
		},
		get hasError() {
			return machineState.state === 'error';
		},

		// Methods
		dispatch,
		subscribe(
			run: (state: PlaybackMachineState) => void
		) {
			run(machineState);
			subscribers.add(run);
			return () => {
				subscribers.delete(run);
			};
		},
		setAudioElement,
		setLoadUiCallbacks,
		maybePreloadNextTrack,
		actions
	};
}

/**
 * Singleton instance for the application
 */
export const playbackMachine = createPlaybackMachineStore();

const testHooksEnabled = areTestHooksEnabled();
if (typeof window !== 'undefined' && testHooksEnabled) {
	(
		window as typeof window & {
			__tidalPlaybackMachineState?: () => {
				state: string;
				isPlaying: boolean;
				isLoading: boolean;
				currentTrackId: number | string | null;
				quality: AudioQuality;
				effectiveQuality: AudioQuality | null;
				loadRequestId: number;
				queueIndex: number;
				queueLength: number;
			};
			__tidalSetPlaybackQuality?: (quality: AudioQuality) => void;
		}
	).__tidalPlaybackMachineState = () => ({
		state: playbackMachine.state,
		isPlaying: playbackMachine.isPlaying,
		isLoading: playbackMachine.isLoading,
		currentTrackId: playbackMachine.currentTrack?.id ?? null,
		quality: playbackMachine.quality,
		effectiveQuality: playbackMachine.effectiveQuality,
		loadRequestId: playbackMachine.context.loadRequestId,
		queueIndex: playbackMachine.context.queueIndex,
		queueLength: playbackMachine.context.queue.length
	});
	(
		window as typeof window & {
			__tidalPlaybackMachineState?: () => {
				state: string;
				isPlaying: boolean;
				isLoading: boolean;
				currentTrackId: number | string | null;
			};
			__tidalSetPlaybackQuality?: (quality: AudioQuality) => void;
		}
	).__tidalSetPlaybackQuality = (quality: AudioQuality) => {
		playerStore.setQuality(quality);
		playbackMachine.actions.changeQuality(quality);
	};
}
