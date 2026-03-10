import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { navigationHistoryStore } from './navigationHistory';

const resetHistory = () => {
	localStorage.removeItem('tidal-ui.navigation-history');
	navigationHistoryStore.clear();
};

describe('navigationHistoryStore', () => {
	beforeEach(() => {
		resetHistory();
	});

	it('tracks and caps album history entries', () => {
		for (let i = 1; i <= 30; i += 1) {
			navigationHistoryStore.visitAlbum({ id: i, title: `Album ${i}`, artistName: `Artist ${i}` });
		}
		const state = get(navigationHistoryStore);
		expect(state.albums.length).toBe(25);
		expect(state.albums[0]?.id).toBe(30);
		expect(state.albums.at(-1)?.id).toBe(6);
	});

	it('tracks and caps artist history entries', () => {
		for (let i = 1; i <= 15; i += 1) {
			navigationHistoryStore.visitArtist({ id: i, name: `Artist ${i}` });
		}
		const state = get(navigationHistoryStore);
		expect(state.artists.length).toBe(10);
		expect(state.artists[0]?.id).toBe(15);
		expect(state.artists.at(-1)?.id).toBe(6);
	});

	it('supports clearing album and artist history independently', () => {
		navigationHistoryStore.visitAlbum({ id: 7, title: 'A', artistName: 'X' });
		navigationHistoryStore.visitArtist({ id: 9, name: 'Y' });
		navigationHistoryStore.clearAlbums();
		let state = get(navigationHistoryStore);
		expect(state.albums).toHaveLength(0);
		expect(state.artists).toHaveLength(1);

		navigationHistoryStore.clearArtists();
		state = get(navigationHistoryStore);
		expect(state.albums).toHaveLength(0);
		expect(state.artists).toHaveLength(0);
	});
});
