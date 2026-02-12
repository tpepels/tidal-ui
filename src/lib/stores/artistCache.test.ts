import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtistDetails } from '$lib/types';
import {
	ARTIST_CACHE_MAX_ENTRIES,
	ARTIST_CACHE_MAX_TOTAL_BYTES,
	artistCacheStore
} from './artistCache';

function createArtistDetails(
	artistId: number,
	albumId: number,
	cover = '',
	nameSuffix = ''
): ArtistDetails {
	return {
		id: artistId,
		name: `Artist ${artistId}${nameSuffix}`,
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
		vi.restoreAllMocks();
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

	it('evicts least-recently-used entries once the bounded entry cap is exceeded', () => {
		const totalArtists = ARTIST_CACHE_MAX_ENTRIES + 5;
		for (let artistId = 1; artistId <= totalArtists; artistId += 1) {
			artistCacheStore.set(createArtistDetails(artistId, artistId));
		}

		expect(artistCacheStore.get(totalArtists)?.id).toBe(totalArtists);
		expect(artistCacheStore.get(1)).toBeUndefined();
	});

	it('skips storing entries that exceed the total cache byte budget', () => {
		const oversizedName = 'x'.repeat(ARTIST_CACHE_MAX_TOTAL_BYTES + 1024);
		artistCacheStore.set(createArtistDetails(1, 10, '', oversizedName));
		expect(artistCacheStore.get(1)).toBeUndefined();
	});

	it('emits telemetry when session persistence fails due quota exhaustion', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const originalSessionStorage = globalThis.sessionStorage;
		const failingSessionStorage = {
			getItem: () => null,
			setItem: () => {
				throw new DOMException('Quota exceeded', 'QuotaExceededError');
			},
			removeItem: () => undefined
		} as unknown as Storage;

		Object.defineProperty(globalThis, 'sessionStorage', {
			value: failingSessionStorage,
			writable: true,
			configurable: true
		});

		try {
			artistCacheStore.set(createArtistDetails(1, 10));

			expect(warn).toHaveBeenCalled();
			expect(
				warn.mock.calls.some((call) => String(call[0]).toLowerCase().includes('quota exceeded'))
			).toBe(true);
		} finally {
			Object.defineProperty(globalThis, 'sessionStorage', {
				value: originalSessionStorage,
				writable: true,
				configurable: true
			});
		}
	});
});
