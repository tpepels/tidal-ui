// Unified UI state management for component coordination
// This replaces multiple scattered stores with a single source of truth

import { derived, writable } from 'svelte/store';
import type { Track } from '../types';
import {
	createPlaybackStateMachine,
	type PlaybackStateMachine,
	type PlaybackState
} from '../core/stateMachines/PlaybackStateMachine';
import {
	createSearchStateMachine,
	type SearchStateMachine,
	type SearchState,
	type SearchResults
} from '../core/stateMachines/SearchStateMachine';

export interface UIState {
	playback: PlaybackState;
	search: SearchState;
	downloads: {
		activeDownloads: Set<string>;
		completedDownloads: Set<string>;
		failedDownloads: Map<string, Error>;
	};
	notifications: {
		toasts: Array<{
			id: string;
			type: 'success' | 'error' | 'warning' | 'info';
			message: string;
			action?: {
				label: string;
				handler: () => void;
			};
		}>;
	};
	ui: {
		activeModal: string | null;
		sidebarCollapsed: boolean;
		theme: 'light' | 'dark' | 'auto';
	};
}

const initialState: UIState = {
	playback: { status: 'idle' },
	search: { status: 'idle' },
	downloads: {
		activeDownloads: new Set(),
		completedDownloads: new Set(),
		failedDownloads: new Map()
	},
	notifications: {
		toasts: []
	},
	ui: {
		activeModal: null,
		sidebarCollapsed: false,
		theme: 'auto'
	}
};

class UnifiedUIStore {
	private store = writable<UIState>(initialState);
	private playbackMachine: PlaybackStateMachine;
	private searchMachine: SearchStateMachine;

	constructor() {
		this.playbackMachine = createPlaybackStateMachine();
		this.searchMachine = createSearchStateMachine();
		// Connect state machines to the store
		this.playbackMachine.subscribe((state) => {
			this.store.update((s) => ({ ...s, playback: state }));
		});

		this.searchMachine.subscribe((state) => {
			this.store.update((s) => ({ ...s, search: state }));
		});
	}

	// Store subscription
	subscribe = this.store.subscribe;

	// Direct access to state machine subscriptions for components
	get subscribeToPlayback() {
		return this.playbackMachine.subscribe;
	}
	get subscribeToSearch() {
		return this.searchMachine.subscribe;
	}

	// State machine state access for components
	get searchState() {
		return this.searchMachine.currentState;
	}

	// Playback actions
	playTrack(track: Track) {
		this.playbackMachine.transition({ type: 'LOAD_TRACK', track });
	}

	pausePlayback() {
		this.playbackMachine.transition({ type: 'PAUSE' });
	}

	resumePlayback() {
		this.playbackMachine.transition({ type: 'PLAY' });
	}

	stopPlayback() {
		this.playbackMachine.transition({ type: 'STOP' });
	}

	seekTo(position: number) {
		this.playbackMachine.transition({ type: 'SEEK', position });
	}

	// Search actions
	performSearch(query: string, tab: 'tracks' | 'albums' | 'artists' | 'playlists') {
		this.searchMachine.transition({ type: 'SEARCH', query, tab });
	}

	changeSearchTab(tab: 'tracks' | 'albums' | 'artists' | 'playlists') {
		this.searchMachine.transition({ type: 'CHANGE_TAB', tab });
	}

	setSearchResults(results: SearchResults) {
		this.searchMachine.transition({ type: 'RESULTS', results });
	}

	setSearchError(error: Error) {
		this.searchMachine.transition({ type: 'ERROR', error });
	}

	cancelSearch() {
		this.searchMachine.transition({ type: 'CANCEL' });
	}

	// Download actions
	startDownload(trackId: string) {
		this.store.update((state) => ({
			...state,
			downloads: {
				...state.downloads,
				activeDownloads: new Set([...state.downloads.activeDownloads, trackId])
			}
		}));
	}

	completeDownload(trackId: string) {
		this.store.update((state) => ({
			...state,
			downloads: {
				...state.downloads,
				activeDownloads: new Set(
					[...state.downloads.activeDownloads].filter((id) => id !== trackId)
				),
				completedDownloads: new Set([...state.downloads.completedDownloads, trackId])
			}
		}));
	}

	failDownload(trackId: string, error: Error) {
		this.store.update((state) => ({
			...state,
			downloads: {
				...state.downloads,
				activeDownloads: new Set(
					[...state.downloads.activeDownloads].filter((id) => id !== trackId)
				),
				failedDownloads: new Map([...state.downloads.failedDownloads, [trackId, error]])
			}
		}));
	}

	// Notification actions
	addToast(toast: Omit<UIState['notifications']['toasts'][0], 'id'>) {
		const id = Math.random().toString(36).substr(2, 9);
		const newToast = { ...toast, id };

		this.store.update((state) => ({
			...state,
			notifications: {
				toasts: [...state.notifications.toasts, newToast]
			}
		}));

		// Auto-remove after duration
		setTimeout(() => {
			this.removeToast(id);
		}, 5000);

		return id;
	}

	removeToast(id: string) {
		this.store.update((state) => ({
			...state,
			notifications: {
				toasts: state.notifications.toasts.filter((toast) => toast.id !== id)
			}
		}));
	}

	// UI actions
	setActiveModal(modal: string | null) {
		this.store.update((state) => ({
			...state,
			ui: { ...state.ui, activeModal: modal }
		}));
	}

	toggleSidebar() {
		this.store.update((state) => ({
			...state,
			ui: { ...state.ui, sidebarCollapsed: !state.ui.sidebarCollapsed }
		}));
	}

	setTheme(theme: UIState['ui']['theme']) {
		this.store.update((state) => ({
			...state,
			ui: { ...state.ui, theme }
		}));
	}
}

// Create and export the singleton instance
export const uiStore = new UnifiedUIStore();

// Convenience derived stores for components
export const playbackState = derived(uiStore, ($state) => $state.playback);
export const searchState = derived(uiStore, ($state) => $state.search);
export const downloadState = derived(uiStore, ($state) => $state.downloads);
export const notifications = derived(uiStore, ($state) => $state.notifications);
export const uiState = derived(uiStore, ($state) => $state.ui);
