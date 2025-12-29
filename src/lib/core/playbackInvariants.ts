import { assertInvariant, validateInvariant } from './invariants';

type TrackLike = { id: number | string };

export type PlaybackInvariantState = {
	currentTrack: TrackLike | null;
	isPlaying: boolean;
	isLoading: boolean;
	queue: TrackLike[];
	queueIndex: number;
};

export const assertPlaybackState = (state: PlaybackInvariantState): void => {
	assertInvariant(
		!state.isPlaying || state.currentTrack !== null,
		'Playback cannot be playing without a current track',
		{ isPlaying: state.isPlaying, currentTrack: state.currentTrack }
	);
	assertInvariant(
		state.queue.length === 0 ? state.queueIndex === -1 : true,
		'Queue index must be -1 when queue is empty',
		{ queueIndex: state.queueIndex, queueLength: state.queue.length }
	);
	assertInvariant(
		state.queueIndex === -1 ||
			(state.queueIndex >= 0 && state.queueIndex < state.queue.length),
		'Queue index must be -1 or within queue bounds',
		{ queueIndex: state.queueIndex, queueLength: state.queue.length }
	);
};

export const assertPlayableState = (state: PlaybackInvariantState): void => {
	assertPlaybackState(state);
	assertInvariant(
		!state.isLoading || state.currentTrack !== null,
		'Playback cannot be loading without a current track',
		{ isLoading: state.isLoading, currentTrack: state.currentTrack }
	);
};

export const validatePlaybackState = (state: PlaybackInvariantState): void => {
	validateInvariant(
		!state.isLoading || state.currentTrack !== null,
		'Player cannot be loading without a current track',
		{ isLoading: state.isLoading, currentTrack: state.currentTrack }
	);

	if (state.currentTrack && state.queue.length > 0) {
		validateInvariant(
			state.currentTrack.id === state.queue[state.queueIndex]?.id,
			'Current track should match queue item at current index',
			{
				currentTrackId: state.currentTrack.id,
				queueTrackId: state.queue[state.queueIndex]?.id,
				queueIndex: state.queueIndex
			}
		);
	}
};
