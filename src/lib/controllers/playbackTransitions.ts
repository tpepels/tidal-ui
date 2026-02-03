import { get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import type { PlayableTrack } from '$lib/types';
import { assertInvariant } from '$lib/core/invariants';
import { playbackFacade } from '$lib/controllers/playbackFacade';
import { playerUiProjection } from '$lib/controllers/playerUiProjection';

type PlaybackState = {
	currentTrack: PlayableTrack | null;
	isPlaying: boolean;
	isLoading: boolean;
	currentTime: number;
	duration: number;
	queue: PlayableTrack[];
	queueIndex: number;
};

type PlaybackStore = Readable<PlaybackState>;

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

export const createPlaybackTransitions = (playbackState: PlaybackStore): PlaybackTransitions => {
	const getState = () => get(playbackState);

	return {
		play() {
			const state = getState();
			assertInvariant(state.currentTrack !== null, 'Cannot play without a current track');
			playbackFacade.play();
		},
		pause() {
			playbackFacade.pause();
		},
		togglePlay() {
			const state = getState();
			if (!state.currentTrack) {
				return;
			}
			playbackFacade.toggle();
		},
		playFromQueueIndex(index: number) {
			const state = getState();
			assertInvariant(
				index >= 0 && index < state.queue.length,
				'Queue index must be within bounds',
				{ index, queueLength: state.queue.length }
			);
			playbackFacade.loadQueue(state.queue, index, { autoPlay: true });
		},
		seekTo(time: number) {
			const state = getState();
			assertInvariant(state.duration >= 0, 'Duration must be non-negative', {
				duration: state.duration
			});
			const bounded = Math.max(0, Math.min(time, state.duration || time));
			playerUiProjection.setCurrentTime(bounded);
		},
		next() {
			playbackFacade.next();
		},
		previous() {
			playbackFacade.previous();
		},
		setTrack(track: PlayableTrack) {
			playbackFacade.loadQueue([track], 0);
		},
		setQueue(queue: PlayableTrack[], startIndex = 0) {
			playbackFacade.loadQueue(queue, startIndex);
		},
		enqueue(track: PlayableTrack) {
			playbackFacade.enqueue(track);
		},
		enqueueNext(track: PlayableTrack) {
			playbackFacade.enqueueNext(track);
		},
		clearQueue() {
			playbackFacade.clearQueue();
		}
	};
};
