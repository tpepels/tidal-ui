import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { searchStore, searchStoreActions } from './searchStoreAdapter';

describe('searchStoreAdapter', () => {
	beforeEach(() => {
		searchStoreActions.resetSearch();
	});

	it('initializes with safe defaults', () => {
		const state = get(searchStore);
		expect(state.query).toBe('');
		expect(state.activeTab).toBe('tracks');
		expect(state.results).toBeNull();
		expect(state.tabLoading.tracks).toBe(false);
	});

	it('marks loading state for active tab', () => {
		searchStoreActions.search('test', 'albums');
		const state = get(searchStore);
		expect(state.isLoading).toBe(true);
		expect(state.activeTab).toBe('albums');
		expect(state.tabLoading.albums).toBe(true);
	});

	it('sets results and clears loading', () => {
		searchStoreActions.search('test', 'tracks');
		searchStoreActions.commit({
			results: {
				tracks: [{ id: 1 } as any],
				albums: [],
				artists: [],
				playlists: []
			},
			isLoading: false,
			error: null,
			tabLoading: {
				tracks: false,
				albums: false,
				artists: false,
				playlists: false
			}
		});
		const state = get(searchStore);
		expect(state.isLoading).toBe(false);
		expect(state.results?.tracks.length).toBe(1);
	});
});
