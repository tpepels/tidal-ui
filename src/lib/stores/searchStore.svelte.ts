import { browser } from '$app/environment';
import type { Track, Album, Artist, Playlist, SonglinkTrack } from '../types';

export type SearchTab = 'tracks' | 'albums' | 'artists' | 'playlists';

class SearchStore {
	query = $state('');
	activeTab = $state<SearchTab>('tracks');
	isLoading = $state(false);
	tabLoading = $state<Record<SearchTab, boolean>>({
		tracks: false,
		albums: false,
		artists: false,
		playlists: false
	});
	tracks = $state<(Track | SonglinkTrack)[]>([]);
	albums = $state<Album[]>([]);
	artists = $state<Artist[]>([]);
	playlists = $state<Playlist[]>([]);
	error = $state<string | null>(null);

	// Advanced filters
	minDuration = $state<number | null>(null);
	maxDuration = $state<number | null>(null);
	minYear = $state<number | null>(null);
	maxYear = $state<number | null>(null);
	genres = $state<string[]>([]);
	explicitFilter = $state<'all' | 'explicit' | 'clean'>('all');

	// Playlist conversion state
	isPlaylistConversionMode = $state(false);
	playlistConversionTotal = $state(0);
	playlistLoadingMessage = $state<string | null>(null);

	constructor() {
		if (browser) {
			const stored = sessionStorage.getItem('tidal-ui-search-store');
			if (stored) {
				try {
					const data = JSON.parse(stored);
					this.query = data.query ?? '';
					this.activeTab = data.activeTab ?? 'tracks';
					this.tabLoading = data.tabLoading ?? {
						tracks: false,
						albums: false,
						artists: false,
						playlists: false
					};
					this.tracks = data.tracks ?? [];
					this.albums = data.albums ?? [];
					this.artists = data.artists ?? [];
					this.playlists = data.playlists ?? [];
					this.minDuration = data.minDuration ?? null;
					this.maxDuration = data.maxDuration ?? null;
					this.minYear = data.minYear ?? null;
					this.maxYear = data.maxYear ?? null;
					this.genres = data.genres ?? [];
					this.explicitFilter = data.explicitFilter ?? 'all';
					this.isPlaylistConversionMode = data.isPlaylistConversionMode ?? false;
					this.playlistConversionTotal = data.playlistConversionTotal ?? 0;
				} catch (e) {
					console.error('Failed to restore search state:', e);
				}
			}

			$effect.root(() => {
				$effect(() => {
					const data = {
						query: this.query,
						activeTab: this.activeTab,
						tabLoading: this.tabLoading,
						tracks: this.tracks,
						albums: this.albums,
						artists: this.artists,
						playlists: this.playlists,
						minDuration: this.minDuration,
						maxDuration: this.maxDuration,
						minYear: this.minYear,
						maxYear: this.maxYear,
						genres: this.genres,
						explicitFilter: this.explicitFilter,
						isPlaylistConversionMode: this.isPlaylistConversionMode,
						playlistConversionTotal: this.playlistConversionTotal
					};
					try {
						sessionStorage.setItem('tidal-ui-search-store', JSON.stringify(data));
					} catch (e) {
						console.warn('Failed to save search state to sessionStorage:', e);
					}
				});
			});
		}
	}

	reset() {
		this.query = '';
		this.activeTab = 'tracks';
		this.isLoading = false;
		this.tabLoading = {
			tracks: false,
			albums: false,
			artists: false,
			playlists: false
		};
		this.tracks = [];
		this.albums = [];
		this.artists = [];
		this.playlists = [];
		this.error = null;
		this.minDuration = null;
		this.maxDuration = null;
		this.minYear = null;
		this.maxYear = null;
		this.genres = [];
		this.explicitFilter = 'all';
		this.isPlaylistConversionMode = false;
		this.playlistConversionTotal = 0;
		this.playlistLoadingMessage = null;
	}

	setDurationFilter(min: number | null, max: number | null) {
		this.minDuration = min;
		this.maxDuration = max;
	}

	setYearFilter(min: number | null, max: number | null) {
		this.minYear = min;
		this.maxYear = max;
	}

	toggleGenre(genre: string) {
		if (this.genres.includes(genre)) {
			this.genres = this.genres.filter((g) => g !== genre);
		} else {
			this.genres = [...this.genres, genre];
		}
	}

	setExplicitFilter(filter: 'all' | 'explicit' | 'clean') {
		this.explicitFilter = filter;
	}

	clearFilters() {
		this.minDuration = null;
		this.maxDuration = null;
		this.minYear = null;
		this.maxYear = null;
		this.genres = [];
		this.explicitFilter = 'all';
	}

	hasActiveFilters(): boolean {
		return (
			this.minDuration !== null ||
			this.maxDuration !== null ||
			this.minYear !== null ||
			this.maxYear !== null ||
			this.genres.length > 0 ||
			this.explicitFilter !== 'all'
		);
	}
}

export const searchStore = new SearchStore();
