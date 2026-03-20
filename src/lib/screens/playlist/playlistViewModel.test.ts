import { describe, expect, it } from 'vitest';
import type { Playlist } from '$lib/types';
import {
	buildPlaylistFeaturedArtistRows,
	buildPlaylistHeroViewModel,
	buildPlaylistMetadataFacts
} from './playlistViewModel';

function createPlaylist(): Playlist {
	return {
		uuid: 'playlist-1',
		title: 'Night Drive',
		description: 'Late playlist',
		image: 'cover-image',
		squareImage: 'square-image',
		duration: 3600,
		numberOfTracks: 25,
		numberOfVideos: 0,
		creator: {
			id: 9,
			name: 'DJ Test',
			picture: 'creator-picture'
		},
		created: '2024-01-01',
		lastUpdated: '2024-06-01',
		type: 'EDITORIAL',
		publicPlaylist: true,
		url: '',
		popularity: 50,
		promotedArtists: [{ id: 10, name: 'Burial', type: 'Artist', picture: 'artist-picture' }]
	};
}

describe('playlistViewModel', () => {
	it('builds playlist hero and metadata facts', () => {
		const playlist = createPlaylist();
		const hero = buildPlaylistHeroViewModel(playlist);
		const facts = buildPlaylistMetadataFacts(playlist);

		expect(hero.title).toBe('Night Drive');
		expect(hero.metaItems?.length).toBeGreaterThan(0);
		expect(facts).toHaveLength(2);
	});

	it('maps featured artists to reusable entity rows', () => {
		const rows = buildPlaylistFeaturedArtistRows(createPlaylist());

		expect(rows[0]?.href).toBe('/artist/10');
		expect(rows[0]?.title).toBe('Burial');
	});
});
