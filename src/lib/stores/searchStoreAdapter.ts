// Reactive search store (single source of truth for search UI)
import { get, writable } from 'svelte/store';
import type { Track, Album, Artist, Playlist, SonglinkTrack } from '../types';
import { validateInvariant } from '../core/invariants';

export type SearchTab = 'tracks' | 'albums' | 'artists' | 'playlists';

type SearchStoreState = {
	query: string;
	activeTab: SearchTab;
	isLoading: boolean;
	error: string | null;
	results: {
		tracks: (Track | SonglinkTrack)[];
		albums: Album[];
		artists: Artist[];
		playlists: Playlist[];
	} | null;
	tabLoading: Record<SearchTab, boolean>;
	minDuration: number | null;
	maxDuration: number | null;
	minYear: number | null;
	maxYear: number | null;
	genres: string[];
	explicitFilter: 'all';
	isPlaylistConversionMode: boolean;
	playlistConversionTotal: number;
	playlistLoadingMessage: string | null;
};

type SearchCommitPayload = {
	query?: string;
	activeTab?: SearchTab;
	isLoading?: boolean;
	error?: string | null;
	tabLoading?: Record<SearchTab, boolean>;
	results?: SearchStoreState['results'];
	isPlaylistConversionMode?: boolean;
	playlistConversionTotal?: number;
	playlistLoadingMessage?: string | null;
};

const searchStoreBase = writable<SearchStoreState>({
	query: '',
	activeTab: 'tracks',
	isLoading: false,
	error: null,
	results: null,
	tabLoading: {
		tracks: false,
		albums: false,
		artists: false,
		playlists: false
	},
	minDuration: null,
	maxDuration: null,
	minYear: null,
	maxYear: null,
	genres: [],
	explicitFilter: 'all',
	isPlaylistConversionMode: false,
	playlistConversionTotal: 0,
	playlistLoadingMessage: null
});

const enforceInvariants = (state: SearchStoreState) => {
	const hasAnyTabLoading = Object.values(state.tabLoading).some((loading) => loading);

	// INVARIANT 1: Loading state consistency
	validateInvariant(
		!state.isLoading || hasAnyTabLoading,
		'Search is loading but no tab is marked as loading',
		{ tabLoading: state.tabLoading }
	);
	validateInvariant(
		!hasAnyTabLoading || state.isLoading,
		'Tab loading is true while overall loading is false',
		{ isLoading: state.isLoading, tabLoading: state.tabLoading }
	);

	// INVARIANT 2: Error state excludes loading state
	validateInvariant(
		!state.error || !state.isLoading,
		'Search has error but is still marked as loading',
		{ error: state.error, isLoading: state.isLoading }
	);

	// INVARIANT 3: Only the active tab can be loading
	const loadingTabs = Object.entries(state.tabLoading)
		.filter(([, loading]) => loading)
		.map(([tab]) => tab);
	validateInvariant(
		loadingTabs.length === 0 || (loadingTabs.length === 1 && loadingTabs[0] === state.activeTab),
		'Non-active tab is marked as loading',
		{ activeTab: state.activeTab, loadingTabs }
	);

	// INVARIANT 4: Results should be null when loading or in error state
	// (unless it's a tab switch where we keep old results)
	if (state.isLoading && state.results) {
		// This is acceptable during tab loading - we show previous results
		// But warn if the loading tab matches existing non-empty results
		const activeTabResults = state.results[state.activeTab];
		if (activeTabResults && activeTabResults.length > 0 && state.tabLoading[state.activeTab]) {
			// This means we're reloading a tab that already has results
			// This is fine, just documenting it
		}
	}

	// INVARIANT 5: Query must be present if we have results
	validateInvariant(
		!state.results || state.query.trim().length > 0 || state.isPlaylistConversionMode,
		'Search has results but query is empty (unless in playlist conversion mode)',
		{ query: state.query, hasResults: !!state.results, isPlaylistConversionMode: state.isPlaylistConversionMode }
	);

	// INVARIANT 6: Playlist conversion state consistency
	validateInvariant(
		!state.isPlaylistConversionMode || state.playlistConversionTotal >= 0,
		'Playlist conversion mode is active but total is negative',
		{ playlistConversionTotal: state.playlistConversionTotal }
	);

	return state;
};

const updateSearchStore = (updater: (state: SearchStoreState) => SearchStoreState) => {
	searchStoreBase.update((state) => enforceInvariants(updater(state)));
};

export const searchStore = {
	subscribe: searchStoreBase.subscribe
};

const resetLoading = () => ({
	tracks: false,
	albums: false,
	artists: false,
	playlists: false
});

const markTabLoading = (tab: SearchTab, isLoading: boolean) => ({
	tracks: tab === 'tracks' ? isLoading : false,
	albums: tab === 'albums' ? isLoading : false,
	artists: tab === 'artists' ? isLoading : false,
	playlists: tab === 'playlists' ? isLoading : false
});

export const searchStoreActions = {
	commit(payload: SearchCommitPayload) {
		updateSearchStore((store) => {
			const nextActiveTab = payload.activeTab ?? store.activeTab;
			const nextIsLoading = payload.isLoading ?? store.isLoading;
			const nextError = payload.error !== undefined ? payload.error : store.error;
			const nextResults = payload.results !== undefined ? payload.results : store.results;

			// STATE TRANSITION VALIDATION
			// Rule 1: If transitioning to error state, must clear loading
			if (nextError && nextIsLoading) {
				console.warn('[SearchStore] Cannot commit error while loading. Clearing loading state.');
			}

			// Rule 2: If providing new results, must clear error
			if (payload.results !== undefined && payload.results !== null && nextError) {
				console.warn('[SearchStore] Clearing error state when new results provided.');
			}

			// Rule 3: If clearing query, should also clear results (unless explicitly kept)
			if (payload.query === '' && payload.results === undefined && store.results !== null) {
				console.warn('[SearchStore] Query cleared but results not cleared. This may be intentional.');
			}

			const nextTabLoading =
				payload.tabLoading ??
				(nextIsLoading ? markTabLoading(nextActiveTab, true) : resetLoading());

			return {
				...store,
				query: payload.query ?? store.query,
				activeTab: nextActiveTab,
				isLoading: nextError ? false : nextIsLoading, // Force loading=false when error present
				error: payload.results !== undefined && payload.results !== null ? null : nextError, // Clear error when new results
				results: nextResults,
				tabLoading: nextTabLoading,
				isPlaylistConversionMode:
					payload.isPlaylistConversionMode ?? store.isPlaylistConversionMode,
				playlistConversionTotal:
					payload.playlistConversionTotal ?? store.playlistConversionTotal,
				playlistLoadingMessage: payload.playlistLoadingMessage ?? store.playlistLoadingMessage
			};
		});
	},

	search(query: string, tab?: SearchTab) {
		const searchTab = tab || get(searchStore).activeTab;
		this.commit({
			query,
			activeTab: searchTab,
			isLoading: true,
			error: null,
			tabLoading: markTabLoading(searchTab, true)
		});
	},
	setQuery(query: string) {
		this.commit({ query });
	},

	cancelSearch() {
		this.commit({
			query: '',
			isLoading: false,
			error: null,
			results: null,
			tabLoading: resetLoading()
		});
	},

	resetSearch() {
		this.commit({
			query: '',
			activeTab: 'tracks',
			isLoading: false,
			error: null,
			results: null,
			tabLoading: resetLoading()
		});
	}
};
