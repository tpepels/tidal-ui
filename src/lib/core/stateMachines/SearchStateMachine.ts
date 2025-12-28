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

export interface SearchStateMachine {
	currentState: SearchState;
	subscribe(listener: (state: SearchState, previousState: SearchState) => void): () => void;
	transition(event: SearchEvent): boolean;
}

export function createSearchStateMachine(): SearchStateMachine {
	let state: SearchState = { status: 'idle' };
	const listeners = new Set<(state: SearchState, previousState: SearchState) => void>();

	const setState = (newState: SearchState): void => {
		const previousState = state;
		state = newState;
		listeners.forEach((listener) => listener(newState, previousState));
	};

	const handleIdleState = (event: SearchEvent): boolean => {
		switch (event.type) {
			case 'SEARCH': {
				const abortController = new AbortController();
				setState({
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
	};

	const handleSearchingState = (event: SearchEvent): boolean => {
		const currentState = state as {
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
				setState({
					status: 'searching',
					query: event.query,
					tab: event.tab,
					abortController
				});
				return true;
			}
			case 'CHANGE_TAB':
				// Keep searching but change active tab
				setState({
					...currentState,
					tab: event.tab
				});
				return true;
			case 'RESULTS':
				setState({
					status: 'results',
					query: currentState.query,
					results: event.results,
					tab: currentState.tab
				});
				return true;
			case 'ERROR':
				setState({
					status: 'error',
					query: currentState.query,
					error: event.error,
					tab: currentState.tab,
					canRetry: true
				});
				return true;
			case 'CANCEL':
				currentState.abortController.abort();
				setState({ status: 'idle' });
				return true;
			default:
				return false;
		}
	};

	const handleResultsState = (event: SearchEvent): boolean => {
		const currentState = state as {
			status: 'results';
			query: string;
			results: SearchResults;
			tab: SearchTab;
		};

		switch (event.type) {
			case 'SEARCH': {
				const abortController = new AbortController();
				setState({
					status: 'searching',
					query: event.query,
					tab: event.tab,
					abortController
				});
				return true;
			}
			case 'CHANGE_TAB':
				setState({
					...currentState,
					tab: event.tab
				});
				return true;
			case 'RESET':
				setState({ status: 'idle' });
				return true;
			default:
				return false;
		}
	};

	const handleErrorState = (event: SearchEvent): boolean => {
		const currentState = state as {
			status: 'error';
			query: string;
			error: Error;
			tab: SearchTab;
			canRetry: boolean;
		};

		switch (event.type) {
			case 'SEARCH': {
				const abortController = new AbortController();
				setState({
					status: 'searching',
					query: event.query,
					tab: event.tab,
					abortController
				});
				return true;
			}
			case 'RESET':
				setState({ status: 'idle' });
				return true;
			default:
				return false;
		}
	};

	const transition = (event: SearchEvent): boolean => {
		const currentState = state;
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
				result = handleIdleState(event);
				break;

			case 'searching':
				result = handleSearchingState(event);
				break;

			case 'results':
				result = handleResultsState(event);
				break;

			case 'error':
				result = handleErrorState(event);
				break;

			default:
				logger.error('Unknown search state encountered', {
					component: 'SearchStateMachine',
					unknownState: currentState,
					event: eventType
				});
				result = false;
		}

		logger.logStateTransition(currentState.status, state.status, eventType, {
			component: 'SearchStateMachine',
			success: result,
			query: state.status !== 'idle' ? state.query : undefined,
			tab: state.status !== 'idle' ? state.tab : undefined
		});

		return result;
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
