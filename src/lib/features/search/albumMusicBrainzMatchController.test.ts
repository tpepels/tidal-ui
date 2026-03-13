import { describe, expect, it, vi } from 'vitest';
import type { Album } from '$lib/types';
import {
	createAlbumMusicBrainzMatchController,
	musicBrainzTitlesLikelyMatch,
	resolveAlbumMusicBrainzLookupKey,
	resolveAlbumMusicBrainzReleaseMatch
} from './albumMusicBrainzMatchController';

function createAlbum(overrides: Partial<Album> = {}): Album {
	return {
		id: 101,
		title: 'Album Title',
		cover: '',
		videoCover: null,
		numberOfTracks: 10,
		artist: {
			id: 77,
			name: 'Artist Name',
			type: 'ARTIST',
			picture: undefined
		},
		...overrides
	};
}

describe('albumMusicBrainzMatchController', () => {
	it('builds deterministic lookup keys for album matching', () => {
		const album = createAlbum({
			title: 'Álbum  Title (Deluxe)',
			releaseDate: '2020-11-03',
			upc: '12345',
			artist: {
				id: 77,
				name: 'Årtist Name',
				type: 'ARTIST',
				picture: undefined
			}
		});

		expect(resolveAlbumMusicBrainzLookupKey(album)).toBe(
			'album title deluxe::artist name::10::2020-11-03::12345'
		);
	});

	it('matches equivalent titles with punctuation and token overlap', () => {
		expect(musicBrainzTitlesLikelyMatch('The Album: Deluxe Edition', 'The Album Deluxe')).toBe(true);
		expect(musicBrainzTitlesLikelyMatch('Completely Different', 'Another Record')).toBe(false);
	});

	it('picks the closest compatible MusicBrainz release', async () => {
		const album = createAlbum({
			title: 'Blue Record',
			numberOfTracks: 10,
			releaseDate: '2021-01-01'
		});
		const lookupKey = resolveAlbumMusicBrainzLookupKey(album);
		expect(lookupKey).toBeTruthy();

		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				releases: [
					{ id: 'x', title: 'Blue Record', trackCount: 11, date: '2023-01-01' },
					{ id: 'y', title: 'Blue Record', trackCount: 10, date: '2019-06-01' },
					{ id: 'z', title: 'Blue Record', trackCount: 10, date: '2024-05-01' }
				]
			})
		});

		const match = await resolveAlbumMusicBrainzReleaseMatch(album, lookupKey!, {
			lookupCache: new Map<string, string | null>(),
			fetchImpl: fetchImpl as unknown as typeof fetch
		});

		expect(match).toBe('z');
	});

	it('hydrates matches and avoids duplicate fetches once matched', async () => {
		const album = createAlbum({ id: 202, title: 'Cache Test Album' });
		const matchedByAlbum = new Map<number, string>();
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				releases: [{ id: 'release-202', title: 'Cache Test Album', trackCount: 10, date: '2024-01-01' }]
			})
		});

		const controller = createAlbumMusicBrainzMatchController({
			concurrency: 1,
			lookupLimit: 10,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			hasMatch: (albumId) => matchedByAlbum.has(albumId),
			onMatch: (albumId, releaseId) => {
				matchedByAlbum.set(albumId, releaseId);
			}
		});

		await controller.hydrate([album]);
		await controller.hydrate([album]);

		expect(matchedByAlbum.get(album.id)).toBe('release-202');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
