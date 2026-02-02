import { get, type Readable } from 'svelte/store';
import type { PlaybackMachineState } from '$lib/machines/playbackMachine';
import { isSonglinkTrack } from '$lib/types';
import { playerStore } from '$lib/stores/player';
import { validateInvariant } from '$lib/core/invariants';

type PlayerState = ReturnType<typeof playerStore.getSnapshot>;

export type PlaybackSyncStore = {
	setLoading: (value: boolean) => void;
	play: () => void;
	pause: () => void;
	setCurrentTime: (time: number) => void;
	setDuration: (duration: number) => void;
	setVolume: (volume: number) => void;
} & Readable<PlayerState>;

export const syncPlayerStoreFromMachine = (
	next: PlaybackMachineState,
	store: PlaybackSyncStore = playerStore
): void => {
	const playerState = get(store);
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
	// Determine if we should show "playing" state in UI
	// Key insight: During error recovery (fallback), we're loading but NOT playing yet
	// The audio element is errored/stopped - don't show "playing" until we're actually playing
	const isPlaying =
		next.state === 'playing' ||
		next.state === 'buffering' ||
		// Only show "playing" during loading if autoPlay is set AND we're not recovering from error
		(next.state === 'loading' && next.context.autoPlay && !next.context.isRecovering);

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
	if (playerState.currentTime !== next.context.currentTime) {
		store.setCurrentTime(next.context.currentTime);
	}
	if (playerState.duration !== next.context.duration) {
		store.setDuration(next.context.duration);
	}
	if (playerState.volume !== next.context.volume) {
		store.setVolume(next.context.volume);
	}
};
