// Search state machine for deterministic search behavior
// This replaces the fragile reactive search logic with explicit state transitions

import type { Track, Album, Artist, Playlist, SonglinkTrack } from '../../types';

export type SearchTab = 'tracks' | 'albums' | 'artists' | 'playlists';

export type SearchState =
	| { status: 'idle' }
	| { status: 'searching'; query: string; tab: SearchTab; abortController: AbortController }
	| { status: 'results'; query: string; results: SearchResults; tab: SearchTab }
	| { status: 'error'; query: string; error: Error; tab: SearchTab; canRetry: boolean };

export type SearchResults = {
	tracks: (Track | SonglinkTrack)[];
	albums: Album[];
	artists: Artist[];
	playlists: Playlist[];
};

export type SearchEvent =
	| { type: 'SEARCH'; query: string; tab: SearchTab }
	| { type: 'CHANGE_TAB'; tab: SearchTab }
	| { type: 'RESULTS'; results: SearchResults }
	| { type: 'ERROR'; error: Error }
	| { type: 'CANCEL' }
	| { type: 'RESET' };

export class SearchStateMachine {
	private state: SearchState = { status: 'idle' };
	private listeners = new Set<(state: SearchState, previousState: SearchState) => void>();

	public get currentState(): SearchState {
		return { ...this.state };
	}

	public subscribe(listener: (state: SearchState, previousState: SearchState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private setState(newState: SearchState): void {
		const previousState = this.state;
		this.state = newState;
		this.listeners.forEach((listener) => listener(newState, previousState));
	}

	public transition(event: SearchEvent): boolean {
		const currentState = this.state;

		switch (currentState.status) {
			case 'idle':
				return this.handleIdleState(event);

			case 'searching':
				return this.handleSearchingState(event);

			case 'results':
				return this.handleResultsState(event);

			case 'error':
				return this.handleErrorState(event);

			default:
				console.warn('[SearchStateMachine] Unknown state:', currentState);
				return false;
		}
	}

	private handleIdleState(event: SearchEvent): boolean {
		switch (event.type) {
			case 'SEARCH': {
				const abortController = new AbortController();
				this.setState({
					status: 'searching',
					query: event.query,
					tab: event.tab,
					abortController
				});
				return true;
			}
			case 'RESET':
				// Already idle
				return true;
			default:
				return false;
		}
	}

	private handleSearchingState(event: SearchEvent): boolean {
		const currentState = this.state as {
			status: 'searching';
			query: string;
			tab: SearchTab;
			abortController: AbortController;
		};

		switch (event.type) {
			case 'SEARCH': {
				// Cancel current search and start new one
				currentState.abortController.abort();
				const abortController = new AbortController();
				this.setState({
					status: 'searching',
					query: event.query,
					tab: event.tab,
					abortController
				});
				return true;
			}
			case 'CHANGE_TAB':
				// Keep searching but change active tab
				this.setState({
					...currentState,
					tab: event.tab
				});
				return true;
			case 'RESULTS':
				this.setState({
					status: 'results',
					query: currentState.query,
					results: event.results,
					tab: currentState.tab
				});
				return true;
			case 'ERROR':
				this.setState({
					status: 'error',
					query: currentState.query,
					error: event.error,
					tab: currentState.tab,
					canRetry: true
				});
				return true;
			case 'CANCEL':
				currentState.abortController.abort();
				this.setState({ status: 'idle' });
				return true;
			default:
				return false;
		}
	}

	private handleResultsState(event: SearchEvent): boolean {
		const currentState = this.state as {
			status: 'results';
			query: string;
			results: SearchResults;
			tab: SearchTab;
		};

		switch (event.type) {
			case 'SEARCH': {
				const abortController = new AbortController();
				this.setState({
					status: 'searching',
					query: event.query,
					tab: event.tab,
					abortController
				});
				return true;
			}
			case 'CHANGE_TAB':
				this.setState({
					...currentState,
					tab: event.tab
				});
				return true;
			case 'RESET':
				this.setState({ status: 'idle' });
				return true;
			default:
				return false;
		}
	}

	private handleErrorState(event: SearchEvent): boolean {
		switch (event.type) {
			case 'SEARCH': {
				const abortController = new AbortController();
				this.setState({
					status: 'searching',
					query: event.query,
					tab: event.tab,
					abortController
				});
				return true;
			}
			case 'RESET':
				this.setState({ status: 'idle' });
				return true;
			default:
				return false;
		}
	}

	// Convenience methods
	public canSearch(): boolean {
		return (
			this.state.status === 'idle' ||
			this.state.status === 'results' ||
			this.state.status === 'error'
		);
	}

	public isSearching(): boolean {
		return this.state.status === 'searching';
	}

	public getCurrentQuery(): string | null {
		switch (this.state.status) {
			case 'searching':
			case 'results':
			case 'error':
				return this.state.query;
			default:
				return null;
		}
	}

	public getCurrentTab(): SearchTab | null {
		switch (this.state.status) {
			case 'searching':
			case 'results':
			case 'error':
				return this.state.tab;
			default:
				return null;
		}
	}

	public getResults(): SearchResults | null {
		return this.state.status === 'results' ? this.state.results : null;
	}

	public getError(): Error | null {
		return this.state.status === 'error' ? this.state.error : null;
	}

	public cancelCurrentSearch(): void {
		if (this.state.status === 'searching') {
			(
				this.state as { status: 'searching'; abortController: AbortController }
			).abortController.abort();
			this.setState({ status: 'idle' });
		}
	}
}
