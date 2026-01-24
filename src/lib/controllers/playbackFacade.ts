import type { PlayableTrack } from '$lib/types';
import { playbackMachine } from '$lib/stores/playbackMachine.svelte';
import { playerStore } from '$lib/stores/player';
import { playbackQueueCoordinator } from '$lib/controllers/playbackQueueCoordinator';

type PlaybackFacade = {
	loadQueue: (tracks: PlayableTrack[], startIndex?: number) => void;
	play: () => void;
	pause: () => void;
	toggle: () => void;
	seek: (time: number) => void;
	next: () => void;
	previous: () => void;
	enqueue: (track: PlayableTrack) => void;
	enqueueNext: (track: PlayableTrack) => void;
	removeFromQueue: (index: number) => void;
	clearQueue: () => void;
	shuffleQueue: () => void;
};

const loadQueue = (tracks: PlayableTrack[], startIndex = 0) => {
	const snapshot = playbackQueueCoordinator.setQueue(tracks, startIndex);
	const nextTrack = snapshot.currentTrack ?? null;
	if (nextTrack) {
		playbackMachine.actions.changeQuality(playerStore.getSnapshot().quality);
		playbackMachine.actions.loadTrack(nextTrack);
	}
};

const play = () => {
	if (!playerStore.getSnapshot().currentTrack) {
		return;
	}
	playerStore.play();
	playbackMachine.actions.play();
};

const pause = () => {
	playerStore.pause();
	playbackMachine.actions.pause();
};

const toggle = () => {
	if (playerStore.getSnapshot().isPlaying) {
		pause();
	} else {
		play();
	}
};

const seek = (time: number) => {
	playbackMachine.actions.seek(time);
};

const next = () => {
	const snapshot = playbackQueueCoordinator.next();
	const nextTrack = snapshot.currentTrack;
	if (nextTrack) {
		playbackMachine.actions.loadTrack(nextTrack);
	}
};

const previous = () => {
	const snapshot = playbackQueueCoordinator.previous();
	const nextTrack = snapshot.currentTrack;
	if (nextTrack) {
		playbackMachine.actions.loadTrack(nextTrack);
	}
};

const enqueue = (track: PlayableTrack) => {
	playbackQueueCoordinator.enqueue(track);
};

const enqueueNext = (track: PlayableTrack) => {
	playbackQueueCoordinator.enqueueNext(track);
};

const removeFromQueue = (index: number) => {
	playbackQueueCoordinator.removeFromQueue(index);
};

const clearQueue = () => {
	playbackQueueCoordinator.clearQueue();
};

const shuffleQueue = () => {
	const snapshot = playbackQueueCoordinator.shuffleQueue();
	const nextTrack = snapshot.currentTrack;
	if (nextTrack) {
		playbackMachine.actions.loadTrack(nextTrack);
	}
};

export const playbackFacade: PlaybackFacade = {
	loadQueue,
	play,
	pause,
	toggle,
	seek,
	next,
	previous,
	enqueue,
	enqueueNext,
	removeFromQueue,
	clearQueue,
	shuffleQueue
};

const isTestHookEnabled = import.meta.env.DEV || import.meta.env.VITE_E2E === 'true';
if (typeof window !== 'undefined' && isTestHookEnabled) {
	(
		window as typeof window & {
			__tidalSetQueue?: (tracks: PlayableTrack[], startIndex?: number) => void;
			__tidalShuffleQueue?: () => void;
		}
	).__tidalSetQueue = (tracks: PlayableTrack[], startIndex = 0) => {
		playbackFacade.loadQueue(tracks, startIndex);
	};
	(
		window as typeof window & {
			__tidalSetQueue?: (tracks: PlayableTrack[], startIndex?: number) => void;
			__tidalShuffleQueue?: () => void;
		}
	).__tidalShuffleQueue = () => {
		playbackFacade.shuffleQueue();
	};
}
