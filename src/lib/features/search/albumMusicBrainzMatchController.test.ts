import { describe, expect, it, vi } from 'vitest';
import type { Album } from '$lib/types';
import {
	createAlbumMusicBrainzMatchController,
	musicBrainzTitlesLikelyMatch,
	stripTrailingBracketedSuffix,
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
		expect(musicBrainzTitlesLikelyMatch('The Album: Deluxe Edition', 'The Album Deluxe')).toBe(
			true
		);
		expect(
			musicBrainzTitlesLikelyMatch('Future Nostalgia (The Moonlight Edition)', 'Future Nostalgia')
		).toBe(true);
		expect(musicBrainzTitlesLikelyMatch('Completely Different', 'Another Record')).toBe(false);
	});

	it('strips trailing bracketed suffixes iteratively', () => {
		expect(stripTrailingBracketedSuffix('Album Name (Deluxe Edition)')).toBe('Album Name');
		expect(stripTrailingBracketedSuffix('Album Name (Deluxe) [Remastered]')).toBe('Album Name');
		expect(stripTrailingBracketedSuffix('Album Name')).toBe('Album Name');
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

	it('still matches when album track count is missing by preferring latest compatible title', async () => {
		const album = createAlbum({
			title: 'Missing Count Album',
			numberOfTracks: undefined
		});
		const lookupKey = resolveAlbumMusicBrainzLookupKey(album);
		expect(lookupKey).toBeTruthy();

		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				releases: [
					{ id: 'old', title: 'Missing Count Album', trackCount: 9, date: '2017-01-01' },
					{ id: 'new', title: 'Missing Count Album', trackCount: 11, date: '2024-02-01' }
				]
			})
		});

		const match = await resolveAlbumMusicBrainzReleaseMatch(album, lookupKey!, {
			lookupCache: new Map<string, string | null>(),
			fetchImpl: fetchImpl as unknown as typeof fetch
		});

		expect(match).toBe('new');
	});

	it('retries MusicBrainz lookup with trailing bracket suffix removed when first query does not match', async () => {
		const album = createAlbum({
			title: 'Future Nostalgia (The Moonlight Edition)',
			numberOfTracks: 12
		});
		const lookupKey = resolveAlbumMusicBrainzLookupKey(album);
		expect(lookupKey).toBeTruthy();

		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ success: true, releases: [] })
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					releases: [
						{
							id: 'moonlight-core',
							title: 'Future Nostalgia',
							trackCount: 12,
							date: '2021-02-12'
						}
					]
				})
			});

		const match = await resolveAlbumMusicBrainzReleaseMatch(album, lookupKey!, {
			lookupCache: new Map<string, string | null>(),
			fetchImpl: fetchImpl as unknown as typeof fetch
		});

		expect(match).toBe('moonlight-core');
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? '{}')).albumTitle).toBe(
			'Future Nostalgia (The Moonlight Edition)'
		);
		expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body ?? '{}')).albumTitle).toBe(
			'Future Nostalgia'
		);
	});

	it('does not cache transport failures as no-match', async () => {
		const album = createAlbum({ id: 303, title: 'Retry Album' });
		const lookupKey = resolveAlbumMusicBrainzLookupKey(album);
		expect(lookupKey).toBeTruthy();

		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				json: async () => ({ success: false })
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					releases: [
						{ id: 'release-303', title: 'Retry Album', trackCount: 10, date: '2024-01-01' }
					]
				})
			});
		const lookupCache = new Map<string, string | null>();

		const firstMatch = await resolveAlbumMusicBrainzReleaseMatch(album, lookupKey!, {
			lookupCache,
			fetchImpl: fetchImpl as unknown as typeof fetch
		});
		const secondMatch = await resolveAlbumMusicBrainzReleaseMatch(album, lookupKey!, {
			lookupCache,
			fetchImpl: fetchImpl as unknown as typeof fetch
		});

		expect(firstMatch).toBeNull();
		expect(secondMatch).toBe('release-303');
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('hydrates matches and avoids duplicate fetches once matched', async () => {
		const album = createAlbum({ id: 202, title: 'Cache Test Album' });
		const matchedByAlbum = new Map<number, string>();
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				releases: [
					{ id: 'release-202', title: 'Cache Test Album', trackCount: 10, date: '2024-01-01' }
				]
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

	it('supports a high-priority ensureMatch lookup without duplicating in-flight requests', async () => {
		const album = createAlbum({ id: 203, title: 'Priority Album' });
		const matchedByAlbum = new Map<number, string>();
		let resolveFetch = () => {};
		const fetchImpl = vi.fn().mockImplementation(async () => {
			await new Promise<void>((resolve) => {
				resolveFetch = resolve;
			});
			return {
				ok: true,
				json: async () => ({
					success: true,
					releases: [
						{ id: 'release-203', title: 'Priority Album', trackCount: 10, date: '2024-01-01' }
					]
				})
			};
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

		const firstLookup = controller.ensureMatch(album);
		const secondLookup = controller.ensureMatch(album);
		await Promise.resolve();

		expect(fetchImpl).toHaveBeenCalledTimes(1);

		resolveFetch();
		await expect(firstLookup).resolves.toBe('release-203');
		await expect(secondLookup).resolves.toBe('release-203');
		expect(matchedByAlbum.get(album.id)).toBe('release-203');
	});

	it('clears cached no-match entries on invalidate so a retry can recover', async () => {
		const album = createAlbum({ id: 404, title: 'Invalidate Album' });
		const matchedByAlbum = new Map<number, string>();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ success: true, releases: [] })
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					releases: [
						{ id: 'release-404', title: 'Invalidate Album', trackCount: 10, date: '2024-01-01' }
					]
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
		expect(matchedByAlbum.has(album.id)).toBe(false);
		controller.invalidate();
		await controller.hydrate([album]);

		expect(matchedByAlbum.get(album.id)).toBe('release-404');
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('processes lookup batches sequentially and waits for each batch to finish', async () => {
		const albums = [
			createAlbum({ id: 1, title: 'Batch Album 1' }),
			createAlbum({ id: 2, title: 'Batch Album 2' }),
			createAlbum({ id: 3, title: 'Batch Album 3' }),
			createAlbum({ id: 4, title: 'Batch Album 4' })
		];
		const matchedByAlbum = new Map<number, string>();
		const deferredByTitle = new Map<string, { resolve: (value: unknown) => void }>();
		const startedTitles: string[] = [];

		const fetchImpl = vi
			.fn()
			.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body ?? '{}')) as { albumTitle?: string };
				const albumTitle = String(body.albumTitle ?? '');
				startedTitles.push(albumTitle);

				if (albumTitle === 'Batch Album 1' || albumTitle === 'Batch Album 2') {
					let resolvePromise: (value: unknown) => void = () => {};
					const promise = new Promise((resolve) => {
						resolvePromise = resolve;
					});
					deferredByTitle.set(albumTitle, { resolve: resolvePromise });
					await promise;
				}

				return {
					ok: true,
					json: async () => ({
						success: true,
						releases: [
							{ id: `release-${albumTitle}`, title: albumTitle, trackCount: 10, date: '2024-01-01' }
						]
					})
				};
			});

		const controller = createAlbumMusicBrainzMatchController({
			concurrency: 2,
			lookupLimit: 10,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			hasMatch: (albumId) => matchedByAlbum.has(albumId),
			onMatch: (albumId, releaseId) => {
				matchedByAlbum.set(albumId, releaseId);
			}
		});

		const hydrationPromise = controller.hydrate(albums);
		await Promise.resolve();
		await Promise.resolve();

		expect(startedTitles).toEqual(['Batch Album 1', 'Batch Album 2']);

		deferredByTitle.get('Batch Album 1')?.resolve(undefined);
		await Promise.resolve();
		await Promise.resolve();
		expect(startedTitles).toEqual(['Batch Album 1', 'Batch Album 2']);

		deferredByTitle.get('Batch Album 2')?.resolve(undefined);
		await hydrationPromise;
		expect(startedTitles).toEqual([
			'Batch Album 1',
			'Batch Album 2',
			'Batch Album 3',
			'Batch Album 4'
		]);

		expect(matchedByAlbum.size).toBe(4);
	});

	it('enforces a strict batch limit of five concurrent lookups', async () => {
		const albums = Array.from({ length: 6 }, (_, index) =>
			createAlbum({ id: index + 1, title: `Strict Cap Album ${index + 1}` })
		);
		const matchedByAlbum = new Map<number, string>();
		const startedTitles: string[] = [];
		const deferredByTitle = new Map<string, { resolve: () => void }>();

		const fetchImpl = vi
			.fn()
			.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body ?? '{}')) as { albumTitle?: string };
				const albumTitle = String(body.albumTitle ?? '');
				startedTitles.push(albumTitle);

				let resolvePromise: () => void = () => {};
				const promise = new Promise<void>((resolve) => {
					resolvePromise = resolve;
				});
				deferredByTitle.set(albumTitle, { resolve: resolvePromise });
				await promise;

				return {
					ok: true,
					json: async () => ({
						success: true,
						releases: [
							{
								id: `release-${albumTitle}`,
								title: albumTitle,
								trackCount: 10,
								date: '2024-01-01'
							}
						]
					})
				};
			});

		const controller = createAlbumMusicBrainzMatchController({
			concurrency: 12,
			lookupLimit: 10,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			hasMatch: (albumId) => matchedByAlbum.has(albumId),
			onMatch: (albumId, releaseId) => {
				matchedByAlbum.set(albumId, releaseId);
			}
		});

		const hydrationPromise = controller.hydrate(albums);
		await Promise.resolve();
		await Promise.resolve();

		expect(startedTitles).toHaveLength(5);

		for (const title of [...startedTitles]) {
			deferredByTitle.get(title)?.resolve();
		}

		for (let attempt = 0; attempt < 20 && startedTitles.length < 6; attempt += 1) {
			await Promise.resolve();
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		expect(startedTitles).toHaveLength(6);

		for (const title of startedTitles) {
			deferredByTitle.get(title)?.resolve();
		}

		await hydrationPromise;
		expect(matchedByAlbum.size).toBe(6);
	});
});
