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
	tracks: (Track | SonglinkTrack)[];
	albums: Album[];
	artists: Artist[];
	playlists: Playlist[];
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
	tracks?: (Track | SonglinkTrack)[];
	albums?: Album[];
	artists?: Artist[];
	playlists?: Playlist[];
};

const emptyResults = {
	tracks: [] as (Track | SonglinkTrack)[],
	albums: [] as Album[],
	artists: [] as Artist[],
	playlists: [] as Playlist[]
};

const searchStoreBase = writable<SearchStoreState>({
	query: '',
	activeTab: 'tracks',
	isLoading: false,
	error: null,
	results: null,
	...emptyResults,
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
	if (state.results) {
		validateInvariant(
			state.tracks.length === state.results.tracks.length,
			'Search tracks list should match results payload',
			{ tracks: state.tracks.length, results: state.results.tracks.length }
		);
		validateInvariant(
			state.albums.length === state.results.albums.length,
			'Search albums list should match results payload',
			{ albums: state.albums.length, results: state.results.albums.length }
		);
		validateInvariant(
			state.artists.length === state.results.artists.length,
			'Search artists list should match results payload',
			{ artists: state.artists.length, results: state.results.artists.length }
		);
		validateInvariant(
			state.playlists.length === state.results.playlists.length,
			'Search playlists list should match results payload',
			{ playlists: state.playlists.length, results: state.results.playlists.length }
		);
	}
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
			const nextResults = payload.results ?? store.results;
			const tracks = payload.tracks ?? nextResults?.tracks ?? store.tracks;
			const albums = payload.albums ?? nextResults?.albums ?? store.albums;
			const artists = payload.artists ?? nextResults?.artists ?? store.artists;
			const playlists = payload.playlists ?? nextResults?.playlists ?? store.playlists;

			return {
				...store,
				query: payload.query ?? store.query,
				activeTab: nextActiveTab,
				isLoading: nextIsLoading,
				error: payload.error ?? store.error,
				results: payload.results ?? store.results,
				tracks,
				albums,
				artists,
				playlists,
				tabLoading: nextTabLoading
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

	setSearchResults(results: {
		tracks: (Track | SonglinkTrack)[];
		albums: Album[];
		artists: Artist[];
		playlists: Playlist[];
	}) {
		this.commit({
			results,
			isLoading: false,
			error: null,
			tabLoading: resetLoading()
		});
	},

	setSearchError(error: Error) {
		this.commit({
			isLoading: false,
			error: error.message,
			tabLoading: resetLoading()
		});
	},

	cancelSearch() {
		this.commit({
			query: '',
			isLoading: false,
			error: null,
			results: null,
			tracks: [],
			albums: [],
			artists: [],
			playlists: [],
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
			tracks: [],
			albums: [],
			artists: [],
			playlists: [],
			tabLoading: resetLoading()
		});
	},

	// Additional compatibility methods
	setIsLoading(value: boolean) {
		const activeTab = get(searchStore).activeTab;
		this.commit({
			isLoading: value,
			tabLoading: value ? markTabLoading(activeTab, true) : resetLoading()
		});
	},

	setError(value: string | null) {
		this.commit({ error: value });
	},

	setResults(value: SearchStoreState['results']) {
		this.commit({ results: value });
	},

	setIsPlaylistConversionMode(value: boolean) {
		updateSearchStore((store) => ({ ...store, isPlaylistConversionMode: value }));
	},

	setPlaylistConversionTotal(value: number) {
		updateSearchStore((store) => ({ ...store, playlistConversionTotal: value }));
	},

	setPlaylistLoadingMessage(value: string | null) {
		updateSearchStore((store) => ({ ...store, playlistLoadingMessage: value }));
	},

	setQuery(value: string) {
		this.commit({ query: value });
	},

	setActiveTab(value: SearchTab) {
		this.commit({ activeTab: value });
	},

	setTracks(value: (Track | SonglinkTrack)[]) {
		this.commit({
			tracks: value,
			results: { ...emptyResults, tracks: value }
		});
	},

	setAlbums(value: Album[]) {
		this.commit({
			albums: value,
			results: { ...emptyResults, albums: value }
		});
	},

	setArtists(value: Artist[]) {
		this.commit({
			artists: value,
			results: { ...emptyResults, artists: value }
		});
	},

	setPlaylists(value: Playlist[]) {
		this.commit({
			playlists: value,
			results: { ...emptyResults, playlists: value }
		});
	}
};
