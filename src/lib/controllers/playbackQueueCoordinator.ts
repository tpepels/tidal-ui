import type { PlayableTrack } from '$lib/types';
import { playerStore } from '$lib/stores/player';
import { playbackMachine } from '$lib/stores/playbackMachine.svelte';

const syncQueue = () => {
	const snapshot = playerStore.getSnapshot();
	playbackMachine.actions.setQueue(snapshot.queue, snapshot.queueIndex);
	return snapshot;
};

export const playbackQueueCoordinator = {
	setQueue(tracks: PlayableTrack[], startIndex = 0) {
		playerStore.setQueue(tracks, startIndex);
		return syncQueue();
	},
	enqueue(track: PlayableTrack) {
		playerStore.enqueue(track);
		return syncQueue();
	},
	enqueueNext(track: PlayableTrack) {
		playerStore.enqueueNext(track);
		return syncQueue();
	},
	removeFromQueue(index: number) {
		playerStore.removeFromQueue(index);
		return syncQueue();
	},
	clearQueue() {
		playerStore.clearQueue();
		return syncQueue();
	},
	shuffleQueue() {
		playerStore.shuffleQueue();
		return syncQueue();
	},
	next() {
		playerStore.next();
		return syncQueue();
	},
	previous() {
		playerStore.previous();
		return syncQueue();
	}
};
