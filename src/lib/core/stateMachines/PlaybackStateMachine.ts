// These replace fragile reactive effects with explicit state transitions

import type { PlayableTrack } from '../../types';
import { logger } from '../logger';
import { performanceMonitor } from '../performance';

export type PlaybackState =
	| { status: 'idle' }
	| { status: 'loading'; track: PlayableTrack }
	| { status: 'playing'; track: PlayableTrack; position: number }
	| { status: 'paused'; track: PlayableTrack; position: number }
	| { status: 'error'; error: Error; canRetry: boolean };

export type PlaybackEvent =
	| { type: 'LOAD_TRACK'; track: PlayableTrack }
	| { type: 'PLAY' }
	| { type: 'PAUSE' }
	| { type: 'STOP' }
	| { type: 'SEEK'; position: number }
	| { type: 'ERROR'; error: Error }
	| { type: 'RESET' };

export interface PlaybackStateMachine {
	currentState: PlaybackState;
	subscribe(listener: (state: PlaybackState, previousState: PlaybackState) => void): () => void;
	transition(event: PlaybackEvent): boolean;
}

export function createPlaybackStateMachine(): PlaybackStateMachine {
	let state: PlaybackState = { status: 'idle' };
	const listeners = new Set<(state: PlaybackState, previousState: PlaybackState) => void>();

	const setState = (newState: PlaybackState): void => {
		const previousState = state;
		state = newState;
		listeners.forEach((listener) => listener(newState, previousState));
	};

	const transition = (event: PlaybackEvent): boolean => {
		const startTime = performance.now();
		const currentState = state;

		// logger.logStateTransition(currentState.status, 'transitioning', event.type, {
		// 	component: 'PlaybackStateMachine',
		// 	fromState: currentState.status,
		// 	event: event.type,
		// 	trackId: currentState.status !== 'idle' && currentState.status !== 'error' ? currentState.track.id : undefined,
		// 	position: currentState.status === 'playing' || currentState.status === 'paused' ? currentState.position : undefined
		// });

		let result: boolean;

		switch (currentState.status) {
			case 'idle':
				result = handleIdleState(event);
				break;

			case 'loading':
				result = handleLoadingState(event);
				break;

			case 'playing':
				result = handlePlayingState(event);
				break;

			case 'paused':
				result = handlePausedState(event);
				break;

			case 'error':
				result = handleErrorState(event);
				break;

			default:
				logger.error('Unknown playback state encountered', {
					component: 'PlaybackStateMachine',
					unknownState: currentState,
					event: event.type
				});
				result = false;
		}

		const duration = performance.now() - startTime;
		logger.logStateTransition(currentState.status, state.status, event.type, {
			component: 'PlaybackStateMachine',
			duration,
			trackId: state.status !== 'idle' && state.status !== 'error' ? state.track.id : undefined,
			position: state.status === 'playing' || state.status === 'paused' ? state.position : undefined
		});

		// performanceMonitor.recordMetric('state-transition', duration, {
		// 	fromState: currentState.status,
		// 	toState: state.status,
		// 	eventType: event.type,
		// 	success: result
		// });

		return result;
	};

	const handleIdleState = (event: PlaybackEvent): boolean => {
		switch (event.type) {
			case 'LOAD_TRACK':
				setState({ status: 'loading', track: event.track });
				return true;
			case 'RESET':
				// Already idle
				return true;
			default:
				return false;
		}
	};

	const handleLoadingState = (event: PlaybackEvent): boolean => {
		const currentState = state as { status: 'loading'; track: PlayableTrack };

		switch (event.type) {
			case 'PLAY':
				setState({ status: 'playing', track: currentState.track, position: 0 });
				return true;
			case 'STOP':
				setState({ status: 'idle' });
				return true;
			case 'ERROR':
				setState({ status: 'error', error: event.error, canRetry: true });
				return true;
			case 'LOAD_TRACK':
				// Replace current loading track
				setState({ status: 'loading', track: event.track });
				return true;
			default:
				return false;
		}
	};

	const handlePlayingState = (event: PlaybackEvent): boolean => {
		const currentState = state as { status: 'playing'; track: PlayableTrack; position: number };

		switch (event.type) {
			case 'PAUSE':
				setState({ status: 'paused', track: currentState.track, position: currentState.position });
				return true;
			case 'STOP':
				setState({ status: 'idle' });
				return true;
			case 'SEEK':
				setState({ ...currentState, position: event.position });
				return true;
			case 'ERROR':
				setState({ status: 'error', error: event.error, canRetry: true });
				return true;
			case 'LOAD_TRACK':
				setState({ status: 'loading', track: event.track });
				return true;
			default:
				return false;
		}
	};

	const handlePausedState = (event: PlaybackEvent): boolean => {
		const currentState = state as { status: 'paused'; track: PlayableTrack; position: number };

		switch (event.type) {
			case 'PLAY':
				setState({ status: 'playing', track: currentState.track, position: currentState.position });
				return true;
			case 'STOP':
				setState({ status: 'idle' });
				return true;
			case 'SEEK':
				setState({ ...currentState, position: event.position });
				return true;
			case 'ERROR':
				setState({ status: 'error', error: event.error, canRetry: true });
				return true;
			case 'LOAD_TRACK':
				setState({ status: 'loading', track: event.track });
				return true;
			default:
				return false;
		}
	};

	const handleErrorState = (event: PlaybackEvent): boolean => {
		const currentState = state as { status: 'error'; error: Error; canRetry: boolean };

		switch (event.type) {
			case 'LOAD_TRACK':
				setState({ status: 'loading', track: event.track });
				return true;
			case 'RESET':
				setState({ status: 'idle' });
				return true;
			default:
				return false;
		}
	};

	return {
		get currentState() {
			return { ...state };
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		transition
	};
}
