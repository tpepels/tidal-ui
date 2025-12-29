import { get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import type { PlayableTrack } from '$lib/types';
import { assertInvariant } from '$lib/core/invariants';
import { assertPlayableState } from '$lib/core/playbackInvariants';

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

export const createPlaybackTransitions = (playerStore: PlaybackStore): PlaybackTransitions => {
	const getState = () => get(playerStore);

	return {
		play() {
			const state = getState();
			assertInvariant(state.currentTrack !== null, 'Cannot play without a current track');
			playerStore.play();
			assertPlayableState(getState());
		},
		pause() {
			playerStore.pause();
			assertPlayableState(getState());
		},
		togglePlay() {
			const state = getState();
			if (!state.currentTrack) {
				return;
			}
			playerStore.togglePlay();
			assertPlayableState(getState());
		},
		playFromQueueIndex(index: number) {
			const state = getState();
			assertInvariant(
				index >= 0 && index < state.queue.length,
				'Queue index must be within bounds',
				{ index, queueLength: state.queue.length }
			);
			playerStore.playAtIndex(index);
			assertPlayableState(getState());
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
			assertPlayableState(getState());
		},
		previous() {
			playerStore.previous();
			assertPlayableState(getState());
		},
		setTrack(track: PlayableTrack) {
			playerStore.setTrack(track);
			assertPlayableState(getState());
		},
		setQueue(queue: PlayableTrack[], startIndex = 0) {
			playerStore.setQueue(queue, startIndex);
			assertPlayableState(getState());
		},
		enqueue(track: PlayableTrack) {
			playerStore.enqueue(track);
			assertPlayableState(getState());
		},
		enqueueNext(track: PlayableTrack) {
			playerStore.enqueueNext(track);
			assertPlayableState(getState());
		},
		clearQueue() {
			playerStore.clearQueue();
			assertPlayableState(getState());
		}
	};
};
