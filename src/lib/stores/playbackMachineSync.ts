import { get } from 'svelte/store';
import type { PlaybackMachineState } from '$lib/machines/playbackMachine';
import { playerStore } from '$lib/stores/player';

export type PlaybackSyncStore = {
	setLoading: (value: boolean) => void;
	play: () => void;
	pause: () => void;
};

export const syncPlayerStoreFromMachine = (
	next: PlaybackMachineState,
	store: PlaybackSyncStore = playerStore
): void => {
	const playerState = get(playerStore);
	const isLoading = next.state === 'loading' || next.state === 'converting';
	const isPlaying =
		next.state === 'playing' ||
		next.state === 'buffering' ||
		(next.state === 'loading' && next.context.autoPlay);

	if (playerState.isLoading !== isLoading) {
		store.setLoading(isLoading);
	}
	if (playerState.isPlaying !== isPlaying) {
		if (isPlaying) {
			store.play();
		} else {
			store.pause();
		}
	}
};
