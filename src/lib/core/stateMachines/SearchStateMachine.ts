// This replaces the fragile reactive search logic with explicit state transitions

import type { Track, Album, Artist, Playlist, SonglinkTrack } from '../../types';
import { logger } from '../logger';

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
	public state: SearchState = { status: 'idle' };
	private listeners = new Set<(state: SearchState, previousState: SearchState) => void>();

	get currentState() {
		return { ...this.state };
	}

	subscribe(listener: (state: SearchState, previousState: SearchState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	canSearch(): boolean {
		return this.state.status !== 'searching';
	}

	isSearching(): boolean {
		return this.state.status === 'searching';
	}

	getCurrentQuery(): string | null {
		if (this.state.status === 'idle') {
			return null;
		}
		return this.state.query;
	}

	getCurrentTab(): SearchTab | null {
		if (this.state.status === 'idle') {
			return null;
		}
		return this.state.tab;
	}

	getResults(): SearchResults | null {
		return this.state.status === 'results' ? this.state.results : null;
	}

	getError(): Error | null {
		return this.state.status === 'error' ? this.state.error : null;
	}

	cancelCurrentSearch(): void {
		if (this.state.status !== 'searching') {
			return;
		}
		this.state.abortController.abort();
		this.setState({ status: 'idle' });
	}

	private setState(newState: SearchState): void {
		const previousState = this.state;
		this.state = newState;
		this.listeners.forEach((listener) => listener(newState, previousState));
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

	transition(event: SearchEvent): boolean {
		const currentState = this.state;
		const eventType = event.type;

		logger.logStateTransition(currentState.status, 'transitioning', eventType, {
			component: 'SearchStateMachine',
			fromState: currentState.status,
			event: eventType,
			query: currentState.status !== 'idle' ? currentState.query : undefined,
			tab: currentState.status !== 'idle' ? currentState.tab : undefined
		});

		let result: boolean;

		switch (currentState.status) {
			case 'idle':
				result = this.handleIdleState(event);
				break;
			case 'searching':
				result = this.handleSearchingState(event);
				break;
			case 'results':
				result = this.handleResultsState(event);
				break;
			case 'error':
				result = this.handleErrorState(event);
				break;
			default:
				console.warn('[SearchStateMachine] Unknown state:', currentState);
				result = false;
		}

		logger.logStateTransition(currentState.status, this.state.status, eventType, {
			component: 'SearchStateMachine',
			success: result,
			query: this.state.status !== 'idle' ? this.state.query : undefined,
			tab: this.state.status !== 'idle' ? this.state.tab : undefined
		});

		return result;
	}
}
