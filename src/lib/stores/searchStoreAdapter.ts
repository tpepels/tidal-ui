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
	validateInvariant(
		!state.error || !state.isLoading,
		'Search has error but is still marked as loading',
		{ error: state.error, isLoading: state.isLoading }
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
			const nextTabLoading =
				payload.tabLoading ??
				(nextIsLoading ? markTabLoading(nextActiveTab, true) : resetLoading());

			return {
				...store,
				query: payload.query ?? store.query,
				activeTab: nextActiveTab,
				isLoading: nextIsLoading,
				error: payload.error ?? store.error,
				results: payload.results ?? store.results,
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
