import { get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import type { PlayableTrack } from '$lib/types';
import { assertInvariant } from '$lib/core/invariants';

type PlaybackState = {
	currentTrack: PlayableTrack | null;
	isPlaying: boolean;
	isLoading: boolean;
	currentTime: number;
	duration: number;
	queue: PlayableTrack[];
	queueIndex: number;
};

type PlaybackStore = Readable<PlaybackState> & {
	setTrack: (track: PlayableTrack) => void;
	play: () => void;
	pause: () => void;
	togglePlay: () => void;
	setCurrentTime: (time: number) => void;
	setDuration: (duration: number) => void;
	setQueue: (queue: PlayableTrack[], startIndex?: number) => void;
	enqueue: (track: PlayableTrack) => void;
	enqueueNext: (track: PlayableTrack) => void;
	next: () => void;
	previous: () => void;
	playAtIndex: (index: number) => void;
	clearQueue: () => void;
};

type PlaybackTransitions = {
	play: () => void;
	pause: () => void;
	togglePlay: () => void;
	playFromQueueIndex: (index: number) => void;
	seekTo: (time: number) => void;
	next: () => void;
	previous: () => void;
	setTrack: (track: PlayableTrack) => void;
	setQueue: (queue: PlayableTrack[], startIndex?: number) => void;
	enqueue: (track: PlayableTrack) => void;
	enqueueNext: (track: PlayableTrack) => void;
	clearQueue: () => void;
};

const assertPlayable = (state: PlaybackState) => {
	assertInvariant(
		!state.isPlaying || state.currentTrack !== null,
		'Playback cannot be playing without a current track',
		{ isPlaying: state.isPlaying, currentTrack: state.currentTrack }
	);
	assertInvariant(
		!(state.isPlaying && state.isLoading),
		'Playback cannot be both playing and loading',
		{ isPlaying: state.isPlaying, isLoading: state.isLoading }
	);
	assertInvariant(
		!state.isLoading || state.currentTrack !== null,
		'Playback cannot be loading without a current track',
		{ isLoading: state.isLoading, currentTrack: state.currentTrack }
	);
	assertInvariant(
		state.queue.length === 0 ? state.queueIndex === -1 : true,
		'Queue index must be -1 when queue is empty',
		{ queueIndex: state.queueIndex, queueLength: state.queue.length }
	);
	assertInvariant(
		state.queueIndex === -1 ||
			(state.queueIndex >= 0 && state.queueIndex < state.queue.length),
		'Queue index must be -1 or within queue bounds',
		{ queueIndex: state.queueIndex, queueLength: state.queue.length }
	);
};

export const createPlaybackTransitions = (playerStore: PlaybackStore): PlaybackTransitions => {
	const getState = () => get(playerStore);

	return {
		play() {
			const state = getState();
			assertInvariant(state.currentTrack !== null, 'Cannot play without a current track');
			playerStore.play();
			assertPlayable(getState());
		},
		pause() {
			playerStore.pause();
			assertPlayable(getState());
		},
		togglePlay() {
			const state = getState();
			if (!state.currentTrack) {
				return;
			}
			playerStore.togglePlay();
			assertPlayable(getState());
		},
		playFromQueueIndex(index: number) {
			const state = getState();
			assertInvariant(
				index >= 0 && index < state.queue.length,
				'Queue index must be within bounds',
				{ index, queueLength: state.queue.length }
			);
			playerStore.playAtIndex(index);
			assertPlayable(getState());
		},
		seekTo(time: number) {
			const state = getState();
			assertInvariant(state.duration >= 0, 'Duration must be non-negative', {
				duration: state.duration
			});
			const bounded = Math.max(0, Math.min(time, state.duration || time));
			playerStore.setCurrentTime(bounded);
		},
		next() {
			playerStore.next();
			assertPlayable(getState());
		},
		previous() {
			playerStore.previous();
			assertPlayable(getState());
		},
		setTrack(track: PlayableTrack) {
			playerStore.setTrack(track);
			assertPlayable(getState());
		},
		setQueue(queue: PlayableTrack[], startIndex = 0) {
			playerStore.setQueue(queue, startIndex);
			assertPlayable(getState());
		},
		enqueue(track: PlayableTrack) {
			playerStore.enqueue(track);
			assertPlayable(getState());
		},
		enqueueNext(track: PlayableTrack) {
			playerStore.enqueueNext(track);
			assertPlayable(getState());
		},
		clearQueue() {
			playerStore.clearQueue();
			assertPlayable(getState());
		}
	};
};
