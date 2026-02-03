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
import { get } from 'svelte/store';
import { browser } from '$app/environment';
import { userPreferencesStore } from '$lib/stores/userPreferences';
import { areTestHooksEnabled } from '$lib/utils/testHooks';
import { PlaybackMachineSideEffectHandler } from '$lib/stores/playbackMachineEffects';
import { debouncedSave, loadFromStorage } from '$lib/utils/persistence';

type PersistedPlaybackState = {
	currentTrack?: PlayableTrack | null;
	queue?: PlayableTrack[];
	queueIndex?: number;
	currentTime?: number;
	duration?: number;
	volume?: number;
	isMuted?: boolean;
};

const hydratePersistedPlaybackState = (
	persisted: Partial<PersistedPlaybackState>
): {
	currentTrack: PlayableTrack | null;
	queue: PlayableTrack[];
	queueIndex: number;
	currentTime: number;
	duration: number;
	volume: number;
	isMuted: boolean;
} => {
	const queue = Array.isArray(persisted.queue) ? persisted.queue.filter(Boolean) : [];
	const rawQueueIndex =
		typeof persisted.queueIndex === 'number' && Number.isFinite(persisted.queueIndex)
			? persisted.queueIndex
			: -1;
	const queueIndex = queue.length === 0 ? -1 : Math.min(Math.max(rawQueueIndex, 0), queue.length - 1);
	const currentTrack =
		queueIndex >= 0
			? (queue[queueIndex] ?? null)
			: (persisted.currentTrack ?? null);
	const duration =
		typeof persisted.duration === 'number' && Number.isFinite(persisted.duration)
			? Math.max(0, persisted.duration)
			: currentTrack?.duration ?? 0;
	const currentTime =
		typeof persisted.currentTime === 'number' && Number.isFinite(persisted.currentTime)
			? Math.max(0, Math.min(persisted.currentTime, duration || persisted.currentTime))
			: 0;
	const volume =
		typeof persisted.volume === 'number' && Number.isFinite(persisted.volume)
			? Math.min(Math.max(persisted.volume, 0), 1)
			: 0.8;
	const isMuted = typeof persisted.isMuted === 'boolean' ? persisted.isMuted : volume === 0;

	return {
		currentTrack,
		queue,
		queueIndex,
		currentTime,
		duration,
		volume,
		isMuted
	};
};

/**
 * Side effect handlers
 * These execute the actual side effects derived from state transitions
 */
/**
 * Creates a playback machine store
 */
export function createPlaybackMachineStore(initialQuality: AudioQuality = 'HIGH') {
	const preferenceQuality = get(userPreferencesStore).playbackQuality ?? initialQuality;
	const persisted = loadFromStorage('player', {}) as Partial<PersistedPlaybackState>;
	const hydrated = hydratePersistedPlaybackState(persisted);
	const baseState = createInitialState(preferenceQuality ?? initialQuality);
	const hydratedState: PlaybackMachineState = {
		...baseState,
		context: {
			...baseState.context,
			...hydrated
		}
	};
	let machineState = $state<PlaybackMachineState>(hydratedState);
	const subscribers = new Set<(state: PlaybackMachineState) => void>();
	const qualitySyncEnabled = import.meta.env.VITE_PLAYBACK_MACHINE_QUALITY_SOT !== 'false';
	const effectHandler = new PlaybackMachineSideEffectHandler({
		getCurrentTrack: () => machineState.context.currentTrack,
		getQueue: () => machineState.context.queue,
		getQueueIndex: () => machineState.context.queueIndex,
		getPlaybackQuality: () => machineState.context.quality,
		getIsPlaying: () => machineState.state === 'playing' || machineState.state === 'buffering'
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
		if (
			prevState.context.queue !== nextState.context.queue ||
			prevState.context.queueIndex !== nextState.context.queueIndex ||
			prevState.context.currentTrack !== nextState.context.currentTrack ||
			prevState.context.currentTime !== nextState.context.currentTime ||
			prevState.context.duration !== nextState.context.duration ||
			prevState.context.volume !== nextState.context.volume ||
			prevState.context.isMuted !== nextState.context.isMuted
		) {
			debouncedSave('player', {
				currentTrack: nextState.context.currentTrack,
				queue: nextState.context.queue,
				queueIndex: nextState.context.queueIndex,
				currentTime: nextState.context.currentTime,
				duration: nextState.context.duration,
				volume: nextState.context.volume,
				isMuted: nextState.context.isMuted
			});
		}
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
		let lastQuality = get(userPreferencesStore).playbackQuality;
		userPreferencesStore.subscribe((state) => {
			if (state.playbackQuality === lastQuality) {
				return;
			}
			lastQuality = state.playbackQuality;
			if (state.playbackQuality !== machineState.context.quality) {
				dispatch({ type: 'CHANGE_QUALITY', quality: state.playbackQuality });
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
		updateSampleRate(sampleRate: number | null) {
			dispatch({ type: 'SAMPLE_RATE_UPDATE', sampleRate });
		},
		updateBitDepth(bitDepth: number | null) {
			dispatch({ type: 'BIT_DEPTH_UPDATE', bitDepth });
		},
		updateReplayGain(replayGain: number | null) {
			dispatch({ type: 'REPLAY_GAIN_UPDATE', replayGain });
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
		get sampleRate() {
			return machineState.context.sampleRate;
		},
		get bitDepth() {
			return machineState.context.bitDepth;
		},
		get replayGain() {
			return machineState.context.replayGain;
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

const createPlaybackMachineStub = (initialQuality: AudioQuality = 'HIGH') => {
	const initial = createInitialState(initialQuality);
	const context = initial.context;
	const noop = () => {};
	return {
		subscribe: () => () => {},
		get state() {
			return initial.state;
		},
		get context() {
			return context;
		},
		get currentTrack() {
			return context.currentTrack;
		},
		get streamUrl() {
			return context.streamUrl;
		},
		get currentTime() {
			return context.currentTime;
		},
		get duration() {
			return context.duration;
		},
		get volume() {
			return context.volume;
		},
		get isMuted() {
			return context.isMuted;
		},
		get sampleRate() {
			return context.sampleRate;
		},
		get bitDepth() {
			return context.bitDepth;
		},
		get replayGain() {
			return context.replayGain;
		},
		get quality() {
			return context.quality;
		},
		get effectiveQuality() {
			return context.effectiveQuality;
		},
		get isPlaying() {
			return false;
		},
		get isPaused() {
			return true;
		},
		get isLoading() {
			return false;
		},
		get hasError() {
			return false;
		},
		setAudioElement: noop,
		setLoadUiCallbacks: noop,
		maybePreloadNextTrack: noop,
		actions: {
			loadTrack: noop,
			setQueue: noop,
			play: noop,
			pause: noop,
			seek: noop,
			updateTime: noop,
			updateDuration: noop,
			updateVolume: noop,
			updateMuted: noop,
			updateSampleRate: noop,
			updateBitDepth: noop,
			updateReplayGain: noop,
			changeQuality: noop,
			onAudioReady: noop,
			onAudioPlaying: noop,
			onAudioPaused: noop,
			onAudioWaiting: noop,
			onAudioError: noop,
			onTrackEnd: noop
		}
	};
};

/**
 * Singleton instance for the application
 */
export const playbackMachine = browser
	? createPlaybackMachineStore()
	: createPlaybackMachineStub();

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
		userPreferencesStore.setPlaybackQuality(quality);
		playbackMachine.actions.changeQuality(quality);
	};
}
