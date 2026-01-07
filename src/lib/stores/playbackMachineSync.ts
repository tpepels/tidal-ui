import { get } from 'svelte/store';
import type { PlaybackMachineState } from '$lib/machines/playbackMachine';
import { isSonglinkTrack } from '$lib/types';
import { playerStore } from '$lib/stores/player';
import { validateInvariant } from '$lib/core/invariants';

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
	const machineTrack = next.context.currentTrack;
	const storeTrack = playerState.currentTrack;
	if (machineTrack && storeTrack) {
		const machineIsSonglink = isSonglinkTrack(machineTrack);
		const storeIsSonglink = isSonglinkTrack(storeTrack);
		if (!machineIsSonglink && !storeIsSonglink) {
			validateInvariant(
				machineTrack.id === storeTrack.id,
				'Playback machine and player store track mismatch',
				{
					machineTrackId: machineTrack.id,
					storeTrackId: storeTrack.id,
					machineState: next.state
				}
			);
		}
	}
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
