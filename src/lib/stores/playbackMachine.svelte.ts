/**
 * Playback Machine Store
 *
 * Svelte 5 runes-based store that wraps the playback state machine.
 * This provides reactive state management with explicit state transitions.
 */

import {
	type PlaybackMachineState,
	type PlaybackEvent,
	type SideEffect,
	transition,
	createInitialState,
	deriveSideEffects
} from '$lib/machines/playbackMachine';
import type { PlayableTrack, Track, AudioQuality } from '$lib/types';
import { isSonglinkTrack } from '$lib/types';
import { playerStore } from '$lib/stores/player';
import { syncPlayerStoreFromMachine } from '$lib/stores/playbackMachineSync';
import { PlaybackMachineSideEffectHandler } from '$lib/stores/playbackMachineEffects';

/**
 * Side effect handlers
 * These execute the actual side effects derived from state transitions
 */
/**
 * Creates a playback machine store
 */
export function createPlaybackMachineStore(initialQuality: AudioQuality = 'HIGH') {
	let machineState = $state<PlaybackMachineState>(createInitialState(initialQuality));
	let pendingSyncState: PlaybackMachineState | null = null;
	let syncScheduled = false;
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

	/**
	 * Set the audio element reference for side effects
	 */
	function setAudioElement(element: HTMLAudioElement | null) {
		effectHandler.setAudioElement(element);
	}

	function setUseExternalStreamLoader(enabled: boolean) {
		effectHandler.setUseExternalStreamLoader(enabled);
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

		play() {
			dispatch({ type: 'PLAY' });
		},

		pause() {
			dispatch({ type: 'PAUSE' });
		},

		seek(position: number) {
			dispatch({ type: 'SEEK', position });
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
		get quality() {
			return machineState.context.quality;
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
		setAudioElement,
		setUseExternalStreamLoader,
		actions
	};
}

/**
 * Singleton instance for the application
 */
export const playbackMachine = createPlaybackMachineStore();

const isTestHookEnabled = import.meta.env.DEV || import.meta.env.VITE_E2E === 'true';
if (typeof window !== 'undefined' && isTestHookEnabled) {
	(
		window as typeof window & {
			__tidalPlaybackMachineState?: () => {
				state: string;
				isPlaying: boolean;
				isLoading: boolean;
				currentTrackId: number | string | null;
			};
		}
	).__tidalPlaybackMachineState = () => ({
		state: playbackMachine.state,
		isPlaying: playbackMachine.isPlaying,
		isLoading: playbackMachine.isLoading,
		currentTrackId: playbackMachine.currentTrack?.id ?? null
	});
}
