/**
 * Player Derived Stores
 *
 * Derived stores that source playback state from the playbackMachine (single source of truth).
 * These provide a Svelte store interface for components while the machine owns the state.
 *
 * Migration path:
 * 1. Components can gradually switch from playerStore to these derived stores
 * 2. playerStore sync can be removed once all components migrate
 * 3. Persistence can be added directly to machine context
 */

import { derived, readable, type Readable } from 'svelte/store';
import { playbackMachine } from './playbackMachine.svelte';
import type { AudioQuality, PlayableTrack } from '$lib/types';

/**
 * Create a readable store that tracks a getter from playbackMachine.
 * Uses playbackMachine subscriptions to avoid polling.
 */
function createMachineStore<T>(getter: () => T): Readable<T> {
	return readable(getter(), (set) => {
		let current = getter();
		return playbackMachine.subscribe(() => {
			const next = getter();
			if (Object.is(current, next)) {
				return;
			}
			current = next;
			set(next);
		});
	});
}

/**
 * Current track being played (from machine context)
 */
export const machineCurrentTrack: Readable<PlayableTrack | null> = createMachineStore(
	() => playbackMachine.currentTrack
);

/**
 * Whether playback is active (machine state is 'playing')
 */
export const machineIsPlaying: Readable<boolean> = createMachineStore(
	() => playbackMachine.isPlaying
);

/**
 * Whether content is loading (machine state is 'loading' or 'converting')
 */
export const machineIsLoading: Readable<boolean> = createMachineStore(
	() => playbackMachine.isLoading
);

/**
 * Whether playback is paused
 */
export const machineIsPaused: Readable<boolean> = createMachineStore(
	() => playbackMachine.isPaused
);

/**
 * Whether there's an error
 */
export const machineHasError: Readable<boolean> = createMachineStore(
	() => playbackMachine.hasError
);

/**
 * User's requested quality preference
 */
export const machineQuality: Readable<AudioQuality> = createMachineStore(
	() => playbackMachine.quality
);

/**
 * Actual playback quality (may differ after fallback)
 */
export const machineEffectiveQuality: Readable<AudioQuality | null> = createMachineStore(
	() => playbackMachine.effectiveQuality
);

/**
 * Current playback state string
 */
export const machineState: Readable<string> = createMachineStore(() => playbackMachine.state);

/**
 * Stream URL for current track
 */
export const machineStreamUrl: Readable<string | null> = createMachineStore(
	() => playbackMachine.streamUrl
);

/**
 * Current playback position (seconds)
 */
export const machineCurrentTime: Readable<number> = createMachineStore(
	() => playbackMachine.currentTime
);

/**
 * Current track duration (seconds)
 */
export const machineDuration: Readable<number> = createMachineStore(
	() => playbackMachine.duration
);

/**
 * Current output volume (0-1)
 */
export const machineVolume: Readable<number> = createMachineStore(
	() => playbackMachine.volume
);

/**
 * Whether audio is muted
 */
export const machineIsMuted: Readable<boolean> = createMachineStore(
	() => playbackMachine.isMuted
);

/**
 * Queue of tracks
 */
export const machineQueue: Readable<PlayableTrack[]> = createMachineStore(
	() => playbackMachine.context.queue
);

/**
 * Current index in queue
 */
export const machineQueueIndex: Readable<number> = createMachineStore(
	() => playbackMachine.context.queueIndex
);

/**
 * Combined playback info for UI components
 */
export const machinePlaybackInfo = derived(
	[machineCurrentTrack, machineIsPlaying, machineIsLoading, machineEffectiveQuality],
	([$track, $isPlaying, $isLoading, $effectiveQuality]) => ({
		currentTrack: $track,
		isPlaying: $isPlaying,
		isLoading: $isLoading,
		effectiveQuality: $effectiveQuality
	})
);

/**
 * Queue info for queue panel
 */
export const machineQueueInfo = derived(
	[machineQueue, machineQueueIndex, machineCurrentTrack],
	([$queue, $index, $currentTrack]) => ({
		queue: $queue,
		queueIndex: $index,
		currentTrack: $currentTrack,
		hasNext: $index < $queue.length - 1,
		hasPrevious: $index > 0
	})
);
