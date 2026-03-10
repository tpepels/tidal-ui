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

	it('stores media metadata for album and artist entries', () => {
		navigationHistoryStore.visitAlbum({
			id: 12,
			title: 'Album 12',
			artistName: 'Artist 12',
			cover: 'album-cover-id'
		});
		navigationHistoryStore.visitArtist({
			id: 34,
			name: 'Artist 34',
			picture: 'artist-picture-id'
		});

		const state = get(navigationHistoryStore);
		expect(state.albums[0]?.cover).toBe('album-cover-id');
		expect(state.artists[0]?.picture).toBe('artist-picture-id');
	});

	it('updates media metadata when revisiting an existing entry', () => {
		navigationHistoryStore.visitAlbum({
			id: 5,
			title: 'Album A',
			artistName: 'Artist A',
			cover: 'cover-old'
		});
		navigationHistoryStore.visitAlbum({
			id: 5,
			title: 'Album A (Remaster)',
			artistName: 'Artist A',
			cover: 'cover-new'
		});
		navigationHistoryStore.visitArtist({
			id: 7,
			name: 'Artist B',
			picture: 'portrait-old'
		});
		navigationHistoryStore.visitArtist({
			id: 7,
			name: 'Artist B',
			picture: 'portrait-new'
		});

		const state = get(navigationHistoryStore);
		expect(state.albums).toHaveLength(1);
		expect(state.albums[0]?.title).toBe('Album A (Remaster)');
		expect(state.albums[0]?.cover).toBe('cover-new');
		expect(state.artists).toHaveLength(1);
		expect(state.artists[0]?.picture).toBe('portrait-new');
	});
});
