// Audio player store for managing playback state
import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import type { Track, AudioQuality, PlayableTrack } from '../types';
import { deriveTrackQuality } from '../utils/audioQuality';
import { userPreferencesStore } from './userPreferences';
import { loadFromStorage, debouncedSave } from '../utils/persistence';
import { assertInvariant, validateInvariant } from '../core/invariants';

interface PlayerState {
	currentTrack: PlayableTrack | null;
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	quality: AudioQuality;
	qualitySource: 'auto' | 'manual';
	isLoading: boolean;
	queue: PlayableTrack[];
	queueIndex: number;
	sampleRate: number | null;
	bitDepth: number | null;
	replayGain: number | null;
}

const initialState: PlayerState = {
	currentTrack: null,
	isPlaying: false,
	currentTime: 0,
	duration: 0,
	volume: 0.8,
	quality: 'LOSSLESS',
	qualitySource: 'manual',
	isLoading: false,
	queue: [],
	queueIndex: -1,
	sampleRate: null,
	bitDepth: null,
	replayGain: null
};

function createPlayerStore() {
	let startState = initialState;
	if (browser) {
		// Load persisted state
		const persisted = loadFromStorage('player', {}) as Partial<PlayerState>;
		startState = {
			...initialState,
			...persisted,
			isPlaying: false, // Don't persist playing state
			isLoading: false
		};

		// Invariants
		console.assert(Array.isArray(startState.queue), 'Player queue must be an array');
		console.assert(
			typeof startState.volume === 'number' && startState.volume >= 0 && startState.volume <= 1,
			'Volume must be between 0 and 1'
		);
		console.assert(startState.queueIndex >= -1, 'Queue index must be valid');
	}

	const { subscribe, set, update } = writable<PlayerState>(startState);

	if (browser) {
		subscribe((state) => {
			try {
				const toSave = {
					currentTrack: state.currentTrack,
					queue: state.queue,
					queueIndex: state.queueIndex,
					volume: state.volume,
					quality: state.quality,
					qualitySource: state.qualitySource,
					currentTime: state.currentTime,
					duration: state.duration,
					sampleRate: state.sampleRate,
					bitDepth: state.bitDepth,
					replayGain: state.replayGain
				};
				debouncedSave('player', toSave);
			} catch (e) {
				console.warn('Failed to save player state', e);
			}
		});
	}

	const applyAutoQuality = (state: PlayerState, track: PlayableTrack | null): PlayerState => {
		// IMPORTANT: This should ONLY affect playback quality, not the UI setting.
		// The UI quality setting (shown in top-right menu) should remain as manually set by user
		// and never change due to track-play-based fallback. Quality adjustments here are for
		// internal playback optimization only and should not update the persisted user preference.
		if (state.qualitySource === 'manual') {
			return state;
		}
		// SonglinkTrack will be converted to Track before playing, so use LOSSLESS for now
		if (track && 'isSonglinkTrack' in track && track.isSonglinkTrack) {
			const nextQuality: AudioQuality = 'LOSSLESS';
			if (state.quality === nextQuality) {
				return state;
			}
			return { ...state, quality: nextQuality };
		}
		const derived = deriveTrackQuality(track as Track | null);
		const nextQuality: AudioQuality = derived ?? 'LOSSLESS';
		if (state.quality === nextQuality) {
			return state;
		}
		return { ...state, quality: nextQuality };
	};

	const resolveSampleRate = (state: PlayerState, track: PlayableTrack | null): number | null => {
		// SonglinkTrack doesn't have sampleRate, return null
		if (track && 'isSonglinkTrack' in track && track.isSonglinkTrack) {
			return null;
		}
		if (
			state.currentTrack &&
			track &&
			'id' in state.currentTrack &&
			'id' in track &&
			state.currentTrack.id === track.id
		) {
			return state.sampleRate;
		}
		return null;
	};

	return {
		subscribe,
		setTrack: (track: PlayableTrack) =>
			update((state) => {
				const next: PlayerState = {
					...state,
					currentTrack: track,
					duration: track.duration,
					currentTime: 0,
					isLoading: true,
					sampleRate: resolveSampleRate(state, track),
					bitDepth: null,
					replayGain: null
				};
				return applyAutoQuality(next, track);
			}),
		play: () => update((state) => ({ ...state, isPlaying: true })),
		pause: () => update((state) => ({ ...state, isPlaying: false })),
		togglePlay: () => update((state) => ({ ...state, isPlaying: !state.isPlaying })),
		setCurrentTime: (time: number) => update((state) => ({ ...state, currentTime: time })),
		setDuration: (duration: number) => update((state) => ({ ...state, duration })),
		setSampleRate: (sampleRate: number | null) => update((state) => ({ ...state, sampleRate })),
		setBitDepth: (bitDepth: number | null) => update((state) => ({ ...state, bitDepth })),
		setReplayGain: (replayGain: number | null) => update((state) => ({ ...state, replayGain })),
		setVolume: (volume: number) => update((state) => ({ ...state, volume })),
		setQuality: (quality: AudioQuality) =>
			update((state) => {
				userPreferencesStore.setPlaybackQuality(quality);
				return { ...state, quality, qualitySource: 'manual' };
			}),
		setLoading: (isLoading: boolean) => update((state) => ({ ...state, isLoading })),
		setQueue: (queue: PlayableTrack[], startIndex: number = 0) =>
			update((state) => {
				// Input validation
				if (!Array.isArray(queue)) {
					console.error('setQueue called with invalid queue:', queue);
					return state;
				}

				const hasTracks = queue.length > 0;
				const clampedIndex = hasTracks ? Math.min(Math.max(startIndex, 0), queue.length - 1) : -1;
				const nextTrack = hasTracks ? queue[clampedIndex]! : null;
				let next: PlayerState = {
					...state,
					queue,
					queueIndex: clampedIndex,
					currentTrack: nextTrack,
					isPlaying: hasTracks ? state.isPlaying : false,
					isLoading: hasTracks,
					currentTime: 0,
					duration: nextTrack?.duration ?? 0,
					sampleRate: resolveSampleRate(state, nextTrack),
					bitDepth: null,
					replayGain: null
				};

				if (!hasTracks) {
					next = {
						...next,
						queueIndex: -1,
						currentTrack: null,
						isPlaying: false,
						isLoading: false,
						currentTime: 0,
						duration: 0,
						sampleRate: null,
						bitDepth: null,
						replayGain: null
					};
				}

				return applyAutoQuality(next, next.currentTrack);
			}),
		enqueue: (track: PlayableTrack) =>
			update((state) => {
				const queue = state.queue.slice();
				if (queue.length === 0) {
					const next: PlayerState = {
						...state,
						queue: [track],
						queueIndex: 0,
						currentTrack: track,
						isPlaying: true,
						isLoading: true,
						currentTime: 0,
						duration: track.duration,
						sampleRate: resolveSampleRate(state, track),
						bitDepth: null,
						replayGain: null
					};
					return applyAutoQuality(next, track);
				}

				queue.push(track);
				return {
					...state,
					queue
				};
			}),
		enqueueNext: (track: PlayableTrack) =>
			update((state) => {
				const queue = state.queue.slice();
				let queueIndex = state.queueIndex;
				if (queue.length === 0 || queueIndex === -1) {
					const next: PlayerState = {
						...state,
						queue: [track],
						queueIndex: 0,
						currentTrack: track,
						isPlaying: true,
						isLoading: true,
						currentTime: 0,
						duration: track.duration,
						sampleRate: resolveSampleRate(state, track),
						bitDepth: null,
						replayGain: null
					};
					return applyAutoQuality(next, track);
				}

				const insertIndex = Math.min(queueIndex + 1, queue.length);
				queue.splice(insertIndex, 0, track);
				if (insertIndex <= queueIndex) {
					queueIndex += 1;
				}
				return {
					...state,
					queue,
					queueIndex
				};
			}),
		next: () =>
			update((state) => {
				if (state.queueIndex < state.queue.length - 1) {
					const newIndex = state.queueIndex + 1;
					const nextTrack = state.queue[newIndex] ?? null;
					const nextState: PlayerState = {
						...state,
						queueIndex: newIndex,
						currentTrack: nextTrack,
						currentTime: 0,
						duration: nextTrack?.duration ?? 0,
						sampleRate: resolveSampleRate(state, nextTrack),
						bitDepth: null,
						replayGain: null
					};
					return applyAutoQuality(nextState, nextTrack);
				}
				return state;
			}),
		previous: () =>
			update((state) => {
				if (state.queueIndex > 0) {
					const newIndex = state.queueIndex - 1;
					const nextTrack = state.queue[newIndex] ?? null;
					const nextState: PlayerState = {
						...state,
						queueIndex: newIndex,
						currentTrack: nextTrack,
						currentTime: 0,
						duration: nextTrack?.duration ?? 0,
						sampleRate: resolveSampleRate(state, nextTrack),
						bitDepth: null,
						replayGain: null
					};
					return applyAutoQuality(nextState, nextTrack);
				}
				return state;
			}),
		shuffleQueue: () =>
			update((state) => {
				const {
					queue: originalQueue,
					queueIndex: originalIndex,
					currentTrack: originalCurrent
				} = state;

				if (originalQueue.length <= 1) {
					return state;
				}

				const queue = originalQueue.slice();
				let pinnedTrack: PlayableTrack | null = null;

				// Try to pin the current track first
				if (originalCurrent) {
					const locatedIndex = queue.findIndex((track) => track.id === originalCurrent.id);
					if (locatedIndex >= 0) {
						pinnedTrack = queue.splice(locatedIndex, 1)[0] ?? null;
					}
				}

				// Fallback to queue index if no current track found
				if (!pinnedTrack && originalIndex >= 0 && originalIndex < queue.length) {
					pinnedTrack = queue.splice(originalIndex, 1)[0] ?? null;
				}

				// Final fallback to original current track
				if (!pinnedTrack && originalCurrent) {
					pinnedTrack = originalCurrent;
				}

				for (let i = queue.length - 1; i > 0; i -= 1) {
					const j = Math.floor(Math.random() * (i + 1));
					[queue[i], queue[j]] = [queue[j]!, queue[i]!];
				}

				if (pinnedTrack) {
					queue.unshift(pinnedTrack);
				}

				const nextQueueIndex = queue.length > 0 ? 0 : -1;
				const nextCurrentTrack = queue.length > 0 ? (queue[0] ?? null) : null;

				let nextState: PlayerState = {
					...state,
					queue,
					queueIndex: nextQueueIndex,
					currentTrack: nextCurrentTrack,
					currentTime: 0,
					duration: nextCurrentTrack?.duration ?? 0,
					sampleRate: resolveSampleRate(state, nextCurrentTrack),
					bitDepth: null,
					replayGain: null
				};

				if (nextQueueIndex === -1) {
					nextState = {
						...nextState,
						currentTrack: null,
						currentTime: 0,
						duration: 0,
						sampleRate: null,
						bitDepth: null,
						replayGain: null
					};
				}

				return applyAutoQuality(nextState, nextState.currentTrack);
			}),
		playAtIndex: (index: number) =>
			update((state) => {
				if (index < 0 || index >= state.queue.length) {
					return state;
				}

				const nextTrack = state.queue[index] ?? null;
				const nextState: PlayerState = {
					...state,
					queueIndex: index,
					currentTrack: nextTrack,
					currentTime: 0,
					isPlaying: true,
					isLoading: true,
					duration: nextTrack?.duration ?? 0,
					sampleRate: resolveSampleRate(state, nextTrack),
					bitDepth: null,
					replayGain: null
				};
				return applyAutoQuality(nextState, nextTrack);
			}),
		removeFromQueue: (index: number) =>
			update((state) => {
				if (index < 0 || index >= state.queue.length) {
					return state;
				}

				const queue = state.queue.slice();
				queue.splice(index, 1);
				let queueIndex = state.queueIndex;
				let currentTrack = state.currentTrack;
				let isPlaying = state.isPlaying;
				let currentTime = state.currentTime;
				let duration = state.duration;
				let isLoading = state.isLoading;

				if (queue.length === 0) {
					const nextState: PlayerState = {
						...state,
						queue,
						queueIndex: -1,
						currentTrack: null,
						isPlaying: false,
						isLoading: false,
						currentTime: 0,
						duration: 0,
						sampleRate: null,
						bitDepth: null,
						replayGain: null
					};
					return applyAutoQuality(nextState, null);
				}

				if (index < queueIndex) {
					queueIndex -= 1;
				} else if (index === queueIndex) {
					if (queueIndex >= queue.length) {
						queueIndex = queue.length - 1;
					}
					currentTrack = queue[queueIndex] ?? null;
					currentTime = 0;
					duration = currentTrack?.duration ?? 0;
					if (!currentTrack) {
						isPlaying = false;
						isLoading = false;
					} else {
						isLoading = true;
					}
				}
				const nextSampleRate =
					state.currentTrack && currentTrack && state.currentTrack.id === currentTrack.id
						? state.sampleRate
						: null;

				const nextState: PlayerState = {
					...state,
					queue,
					queueIndex,
					currentTrack,
					isPlaying,
					isLoading,
					currentTime,
					duration,
					sampleRate: nextSampleRate,
					replayGain: state.replayGain
				};
				return applyAutoQuality(nextState, currentTrack);
			}),
		clearQueue: () =>
			update((state) => {
				const nextState: PlayerState = {
					...state,
					queue: [],
					queueIndex: -1,
					currentTrack: null,
					isPlaying: false,
					isLoading: false,
					currentTime: 0,
					duration: 0,
					sampleRate: null,
					bitDepth: null,
					replayGain: null
				};
				return applyAutoQuality(nextState, null);
			}),
		reset: () => set(initialState)
	};
}

export const playerStore = createPlayerStore();

// Invariant checking for critical state consistency
playerStore.subscribe(($state) => {
	// Invariant: Cannot be playing while loading
	validateInvariant(
		!($state.isPlaying && $state.isLoading),
		'Player cannot be both playing and loading simultaneously',
		{ isPlaying: $state.isPlaying, isLoading: $state.isLoading }
	);

	// Invariant: If playing, must have a current track
	assertInvariant(
		!$state.isPlaying || $state.currentTrack !== null,
		'Player cannot be playing without a current track',
		{ isPlaying: $state.isPlaying, currentTrack: $state.currentTrack }
	);

	// Invariant: Queue index must be valid
	assertInvariant(
		$state.queueIndex >= 0 && $state.queueIndex < $state.queue.length,
		'Queue index must be within valid range',
		{ queueIndex: $state.queueIndex, queueLength: $state.queue.length }
	);

	// Invariant: Current track should match queue item
	if ($state.currentTrack && $state.queue.length > 0) {
		validateInvariant(
			$state.currentTrack.id === $state.queue[$state.queueIndex]?.id,
			'Current track should match queue item at current index',
			{
				currentTrackId: $state.currentTrack.id,
				queueTrackId: $state.queue[$state.queueIndex]?.id,
				queueIndex: $state.queueIndex
			}
		);
	}
});

// Derived stores for convenience
export const currentTrack = derived(playerStore, ($store) => $store.currentTrack);
export const isPlaying = derived(playerStore, ($store) => $store.isPlaying);
export const currentTime = derived(playerStore, ($store) => $store.currentTime);
export const duration = derived(playerStore, ($store) => $store.duration);
export const volume = derived(playerStore, ($store) => $store.volume);
export const progress = derived(playerStore, ($store) =>
	$store.duration > 0 ? ($store.currentTime / $store.duration) * 100 : 0
);
