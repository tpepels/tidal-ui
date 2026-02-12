import { beforeEach, describe, expect, it } from 'vitest';
import type { ArtistDetails } from '$lib/types';
import { artistCacheStore } from './artistCache';

function createArtistDetails(artistId: number, albumId: number, cover = ''): ArtistDetails {
	return {
		id: artistId,
		name: `Artist ${artistId}`,
		type: 'ARTIST',
		albums: [
			{
				id: albumId,
				title: `Album ${albumId}`,
				cover,
				videoCover: null
			}
		],
		tracks: []
	};
}

describe('artistCacheStore', () => {
	beforeEach(() => {
		artistCacheStore.clear();
	});

	it('upsertAlbumCover updates only the targeted artist entry', () => {
		artistCacheStore.set(createArtistDetails(1, 10));
		artistCacheStore.set(createArtistDetails(2, 10));

		artistCacheStore.upsertAlbumCover(1, 10, 'cover-a');

		expect(artistCacheStore.get(1)?.albums[0]?.cover).toBe('cover-a');
		expect(artistCacheStore.get(2)?.albums[0]?.cover).toBe('');
	});

	it('upsertAlbumCoverGlobally updates matching albums across all cached artists', () => {
		artistCacheStore.set(createArtistDetails(1, 10));
		artistCacheStore.set(createArtistDetails(2, 10));
		artistCacheStore.set(createArtistDetails(3, 11));

		artistCacheStore.upsertAlbumCoverGlobally(10, 'cover-global');

		expect(artistCacheStore.get(1)?.albums[0]?.cover).toBe('cover-global');
		expect(artistCacheStore.get(2)?.albums[0]?.cover).toBe('cover-global');
		expect(artistCacheStore.get(3)?.albums[0]?.cover).toBe('');
	});
});
