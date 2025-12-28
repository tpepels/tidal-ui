// State machines for deterministic state management
// These replace fragile reactive effects with explicit state transitions

import type { PlayableTrack } from '../../types';

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
	private state: PlaybackState = { status: 'idle' };
	private listeners = new Set<(state: PlaybackState, previousState: PlaybackState) => void>();

	public get currentState(): PlaybackState {
		return { ...this.state };
	}

	public subscribe(
		listener: (state: PlaybackState, previousState: PlaybackState) => void
	): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private setState(newState: PlaybackState): void {
		const previousState = this.state;
		this.state = newState;
		this.listeners.forEach((listener) => listener(newState, previousState));
	}

	public transition(event: PlaybackEvent): boolean {
		const currentState = this.state;

		switch (currentState.status) {
			case 'idle':
				return this.handleIdleState(event);

			case 'loading':
				return this.handleLoadingState(event);

			case 'playing':
				return this.handlePlayingState(event);

			case 'paused':
				return this.handlePausedState(event);

			case 'error':
				return this.handleErrorState(event);

			default:
				console.warn('[PlaybackStateMachine] Unknown state:', currentState);
				return false;
		}
	}

	private handleIdleState(event: PlaybackEvent): boolean {
		switch (event.type) {
			case 'LOAD_TRACK':
				this.setState({ status: 'loading', track: event.track });
				return true;
			case 'RESET':
				// Already idle
				return true;
			default:
				return false; // Invalid transition
		}
	}

	private handleLoadingState(event: PlaybackEvent): boolean {
		switch (event.type) {
			case 'PLAY':
				// Stay in loading state, but mark as playing once loaded
				return true; // Transition will happen when loading completes
			case 'ERROR':
				this.setState({ status: 'error', error: event.error, canRetry: true });
				return true;
			case 'STOP':
				this.setState({ status: 'idle' });
				return true;
			default:
				return false;
		}
	}

	private handlePlayingState(event: PlaybackEvent): boolean {
		const currentState = this.state as {
			status: 'playing';
			track: PlayableTrack;
			position: number;
		};
		switch (event.type) {
			case 'PAUSE':
				this.setState({
					status: 'paused',
					track: currentState.track,
					position: currentState.position
				});
				return true;
			case 'SEEK':
				this.setState({
					...currentState,
					position: event.position
				});
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
			case 'SEEK':
				this.setState({
					...currentState,
					position: event.position
				});
				return true;
			case 'STOP':
				this.setState({ status: 'idle' });
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

	// Convenience methods
	public canPlay(): boolean {
		return this.state.status === 'paused' || this.state.status === 'idle';
	}

	public canPause(): boolean {
		return this.state.status === 'playing';
	}

	public isPlaying(): boolean {
		return this.state.status === 'playing';
	}

	public getCurrentTrack(): PlayableTrack | null {
		switch (this.state.status) {
			case 'loading':
			case 'playing':
			case 'paused':
				return this.state.track;
			default:
				return null;
		}
	}
}
