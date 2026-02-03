import type { PlayableTrack } from '$lib/types';
import { playbackMachine } from '$lib/stores/playbackMachine.svelte';
import { playbackQueueCoordinator } from '$lib/controllers/playbackQueueCoordinator';
import { areTestHooksEnabled } from '$lib/utils/testHooks';

type PlaybackFacade = {
	loadQueue: (
		tracks: PlayableTrack[],
		startIndex?: number,
		options?: { autoPlay?: boolean }
	) => void;
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

const loadQueue = (tracks: PlayableTrack[], startIndex = 0, options?: { autoPlay?: boolean }) => {
	const nextIndex = tracks.length > 0 ? Math.min(Math.max(startIndex, 0), tracks.length - 1) : -1;
	const snapshot = playbackQueueCoordinator.setQueue(tracks, nextIndex);
	const nextTrack = snapshot.currentTrack ?? null;
	if (nextTrack) {
		// NOTE: Do NOT call changeQuality here - it triggers reload of the CURRENT track,
		// not the new track. loadTrack will use the machine's requested quality.
		// Calling changeQuality before loadTrack caused a race condition where the old
		// track would continue loading/playing after switching to a new track.
		if (options?.autoPlay === undefined) {
			playbackMachine.actions.loadTrack(nextTrack);
		} else {
			playbackMachine.actions.loadTrack(nextTrack, { autoPlay: options.autoPlay });
		}
	}
};

const play = () => {
	const { currentTrack, queue, queueIndex } = playbackMachine.context;
	if (!currentTrack && queue.length > 0) {
		const fallbackTrack = queue[queueIndex] ?? queue[0];
		if (fallbackTrack) {
			playbackMachine.actions.loadTrack(fallbackTrack);
		}
	}
	playbackMachine.actions.play();
};

const pause = () => {
	playbackMachine.actions.pause();
};

const toggle = () => {
	if (playbackMachine.isPlaying) {
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
	const before = playbackMachine.context;
	const wasEmpty = before.queue.length === 0 && !before.currentTrack;
	const snapshot = playbackQueueCoordinator.enqueue(track);
	if (wasEmpty && snapshot.currentTrack) {
		playbackMachine.actions.loadTrack(snapshot.currentTrack);
		playbackMachine.actions.play();
	}
};

const enqueueNext = (track: PlayableTrack) => {
	const before = playbackMachine.context;
	const wasEmpty = before.queue.length === 0 && !before.currentTrack;
	const snapshot = playbackQueueCoordinator.enqueueNext(track);
	if (wasEmpty && snapshot.currentTrack) {
		playbackMachine.actions.loadTrack(snapshot.currentTrack);
		playbackMachine.actions.play();
	}
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

const testHooksEnabled = areTestHooksEnabled();
if (typeof window !== 'undefined' && testHooksEnabled) {
	(
		window as typeof window & {
			__tidalSetQueue?: (tracks: PlayableTrack[], startIndex?: number) => void;
			__tidalShuffleQueue?: () => void;
			__tidalNext?: () => void;
			__tidalPrevious?: () => void;
		}
	).__tidalSetQueue = (tracks: PlayableTrack[], startIndex = 0) => {
		playbackFacade.loadQueue(tracks, startIndex);
	};
	(
		window as typeof window & {
			__tidalSetQueue?: (tracks: PlayableTrack[], startIndex?: number) => void;
			__tidalShuffleQueue?: () => void;
			__tidalNext?: () => void;
			__tidalPrevious?: () => void;
		}
	).__tidalShuffleQueue = () => {
		playbackFacade.shuffleQueue();
	};
	(
		window as typeof window & {
			__tidalNext?: () => void;
			__tidalPrevious?: () => void;
		}
	).__tidalNext = () => {
		playbackFacade.next();
	};
	(
		window as typeof window & {
			__tidalNext?: () => void;
			__tidalPrevious?: () => void;
		}
	).__tidalPrevious = () => {
		playbackFacade.previous();
	};
}
