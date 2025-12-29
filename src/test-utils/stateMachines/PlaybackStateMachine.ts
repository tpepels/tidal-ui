// These replace fragile reactive effects with explicit state transitions

import type { PlayableTrack } from '../../lib/types';
import { logger } from '../../lib/core/logger';

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

export class PlaybackStateMachine {
	public state: PlaybackState = { status: 'idle' };
	private listeners = new Set<(state: PlaybackState, previousState: PlaybackState) => void>();

	get currentState() {
		return { ...this.state };
	}

	subscribe(listener: (state: PlaybackState, previousState: PlaybackState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	canPlay(): boolean {
		return this.state.status === 'idle' || this.state.status === 'paused';
	}

	canPause(): boolean {
		return this.state.status === 'playing';
	}

	isPlaying(): boolean {
		return this.state.status === 'playing';
	}

	getCurrentTrack(): PlayableTrack | null {
		if (this.state.status === 'loading') {
			return this.state.track;
		}
		if (this.state.status === 'playing' || this.state.status === 'paused') {
			return this.state.track;
		}
		return null;
	}

	private setState(newState: PlaybackState): void {
		const previousState = this.state;
		this.state = newState;
		this.listeners.forEach((listener) => listener(newState, previousState));
	}

	private handleIdleState(event: PlaybackEvent): boolean {
		switch (event.type) {
			case 'LOAD_TRACK':
				this.setState({ status: 'loading', track: event.track });
				return true;
			case 'RESET':
				return true;
			default:
				return false;
		}
	}

	private handleLoadingState(event: PlaybackEvent): boolean {
		switch (event.type) {
			case 'PLAY':
				// Accept PLAY but stay in loading until actual media is ready
				return true;
			case 'STOP':
				this.setState({ status: 'idle' });
				return true;
			case 'ERROR':
				this.setState({ status: 'error', error: event.error, canRetry: true });
				return true;
			default:
				return false;
		}
	}

	private handlePlayingState(event: PlaybackEvent): boolean {
		const currentState = this.state as { status: 'playing'; track: PlayableTrack; position: number };

		switch (event.type) {
			case 'PAUSE':
				this.setState({
					status: 'paused',
					track: currentState.track,
					position: currentState.position
				});
				return true;
			case 'STOP':
				this.setState({ status: 'idle' });
				return true;
			case 'SEEK':
				this.setState({ ...currentState, position: event.position });
				return true;
			case 'ERROR':
				this.setState({ status: 'error', error: event.error, canRetry: true });
				return true;
			default:
				return false;
		}
	}

	private handlePausedState(event: PlaybackEvent): boolean {
		const currentState = this.state as { status: 'paused'; track: PlayableTrack; position: number };

		switch (event.type) {
			case 'PLAY':
				this.setState({
					status: 'playing',
					track: currentState.track,
					position: currentState.position
				});
				return true;
			case 'STOP':
				this.setState({ status: 'idle' });
				return true;
			case 'SEEK':
				this.setState({ ...currentState, position: event.position });
				return true;
			case 'LOAD_TRACK':
				this.setState({ status: 'loading', track: event.track });
				return true;
			default:
				return false;
		}
	}

	private handleErrorState(event: PlaybackEvent): boolean {
		switch (event.type) {
			case 'LOAD_TRACK':
				this.setState({ status: 'loading', track: event.track });
				return true;
			case 'RESET':
				this.setState({ status: 'idle' });
				return true;
			default:
				return false;
		}
	}

	transition(event: PlaybackEvent): boolean {
		const startTime = performance.now();
		const currentState = this.state;

		let result: boolean;

		switch (currentState.status) {
			case 'idle':
				result = this.handleIdleState(event);
				break;
			case 'loading':
				result = this.handleLoadingState(event);
				break;
			case 'playing':
				result = this.handlePlayingState(event);
				break;
			case 'paused':
				result = this.handlePausedState(event);
				break;
			case 'error':
				result = this.handleErrorState(event);
				break;
			default:
				console.warn('[PlaybackStateMachine] Unknown state:', currentState);
				result = false;
		}

		const duration = performance.now() - startTime;
		const trackId =
			this.state.status === 'loading' ||
			this.state.status === 'playing' ||
			this.state.status === 'paused'
				? this.state.track.id
				: undefined;
		const position =
			this.state.status === 'playing' || this.state.status === 'paused'
				? this.state.position
				: undefined;

		logger.logStateTransition(currentState.status, this.state.status, event.type, {
			component: 'PlaybackStateMachine',
			duration,
			trackId,
			position
		});

		return result;
	}
}
