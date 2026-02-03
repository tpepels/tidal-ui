import type { PlayableTrack } from '$lib/types';
import { playbackMachine } from '$lib/stores/playbackMachine.svelte';

type QueueSnapshot = {
	queue: PlayableTrack[];
	queueIndex: number;
	currentTrack: PlayableTrack | null;
};

const getSnapshot = (): QueueSnapshot => ({
	queue: playbackMachine.context.queue,
	queueIndex: playbackMachine.context.queueIndex,
	currentTrack: playbackMachine.context.currentTrack
});

const clampIndex = (queue: PlayableTrack[], index: number): number => {
	if (queue.length === 0) return -1;
	const bounded = Number.isFinite(index) ? index : 0;
	return Math.min(Math.max(bounded, 0), queue.length - 1);
};

const commitQueue = (queue: PlayableTrack[], queueIndex: number): QueueSnapshot => {
	playbackMachine.actions.setQueue(queue, queueIndex);
	return {
		queue,
		queueIndex,
		currentTrack: queueIndex >= 0 ? (queue[queueIndex] ?? null) : null
	};
};

export const playbackQueueCoordinator = {
	setQueue(tracks: PlayableTrack[], startIndex = 0) {
		const queue = Array.isArray(tracks) ? tracks.slice() : [];
		const queueIndex = clampIndex(queue, startIndex);
		return commitQueue(queue, queueIndex);
	},
	enqueue(track: PlayableTrack) {
		const { queue, queueIndex, currentTrack } = getSnapshot();
		if (queue.length === 0) {
			if (currentTrack) {
				return commitQueue([currentTrack, track], 0);
			}
			return commitQueue([track], 0);
		}
		return commitQueue([...queue, track], queueIndex);
	},
	enqueueNext(track: PlayableTrack) {
		const { queue, queueIndex, currentTrack } = getSnapshot();
		if (queue.length === 0 || queueIndex === -1) {
			if (currentTrack) {
				return commitQueue([currentTrack, track], 0);
			}
			return commitQueue([track], 0);
		}
		const insertIndex = Math.min(queueIndex + 1, queue.length);
		const nextQueue = queue.slice();
		nextQueue.splice(insertIndex, 0, track);
		return commitQueue(nextQueue, queueIndex);
	},
	removeFromQueue(index: number) {
		const { queue, queueIndex } = getSnapshot();
		if (index < 0 || index >= queue.length) {
			return { queue, queueIndex, currentTrack: playbackMachine.context.currentTrack };
		}
		const nextQueue = queue.slice();
		nextQueue.splice(index, 1);
		if (nextQueue.length === 0) {
			return commitQueue([], -1);
		}
		let nextIndex = queueIndex;
		if (index < nextIndex) {
			nextIndex -= 1;
		} else if (index === nextIndex) {
			nextIndex = Math.min(nextIndex, nextQueue.length - 1);
		}
		return commitQueue(nextQueue, nextIndex);
	},
	clearQueue() {
		return commitQueue([], -1);
	},
	shuffleQueue() {
		const { queue: originalQueue, queueIndex: originalIndex, currentTrack: originalCurrent } =
			getSnapshot();
		if (originalQueue.length <= 1) {
			return {
				queue: originalQueue,
				queueIndex: originalIndex,
				currentTrack: originalCurrent
			};
		}

		const queue = originalQueue.slice();
		let pinnedTrack: PlayableTrack | null = null;

		if (originalCurrent) {
			const locatedIndex = queue.findIndex((track) => track.id === originalCurrent.id);
			if (locatedIndex >= 0) {
				pinnedTrack = queue.splice(locatedIndex, 1)[0] ?? null;
			}
		}

		if (!pinnedTrack && originalIndex >= 0 && originalIndex < queue.length) {
			pinnedTrack = queue.splice(originalIndex, 1)[0] ?? null;
		}

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
		return commitQueue(queue, nextQueueIndex);
	},
	next() {
		const { queue, queueIndex } = getSnapshot();
		if (queueIndex < queue.length - 1) {
			return commitQueue(queue, queueIndex + 1);
		}
		return { queue, queueIndex, currentTrack: playbackMachine.context.currentTrack };
	},
	previous() {
		const { queue, queueIndex } = getSnapshot();
		if (queueIndex > 0) {
			return commitQueue(queue, queueIndex - 1);
		}
		return { queue, queueIndex, currentTrack: playbackMachine.context.currentTrack };
	}
};
