import { describe, expect, it, vi } from 'vitest';
import { getArtistRecommendations, type CatalogApiContext } from './catalog';

const jsonResponse = (payload: unknown, status = 200) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' }
	});

describe('catalog.getArtistRecommendations', () => {
	it('derives artists and albums from artist mix while excluding the source artist', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/artist/?id=42')) {
				return jsonResponse({
					version: '2.4',
					artist: {
						id: 42,
						name: 'Source Artist',
						type: 'ARTIST',
						mixes: { ARTIST_MIX: 'mix-42' }
					}
				});
			}
			if (url.includes('/mix/?id=mix-42')) {
				return jsonResponse({
					version: '2.4',
					mix: {
						id: 'mix-42',
						title: 'Source Artist',
						subTitle: 'Artist Radio'
					},
					items: [
						{
							id: 1,
							title: 'Track One',
							artists: [
								{ id: 42, name: 'Source Artist', type: 'ARTIST' },
								{ id: 7, name: 'Recommended Alpha', type: 'ARTIST', picture: 'alpha-pic' }
							],
							album: {
								id: 100,
								title: 'Alpha Album',
								cover: 'alpha-cover',
								videoCover: null,
								releaseDate: '2024-01-01'
							}
						},
						{
							id: 2,
							title: 'Track Two',
							artists: [
								{ id: 42, name: 'Source Artist', type: 'ARTIST' },
								{ id: 7, name: 'Recommended Alpha', type: 'ARTIST', picture: 'alpha-pic' }
							],
							album: {
								id: 100,
								title: 'Alpha Album',
								cover: 'alpha-cover',
								videoCover: null,
								releaseDate: '2024-01-01'
							}
						},
						{
							id: 3,
							title: 'Track Three',
							artists: [
								{ id: 42, name: 'Source Artist', type: 'ARTIST' },
								{ id: 9, name: 'Recommended Beta', type: 'ARTIST' }
							],
							album: {
								id: 101,
								title: 'Beta Album',
								cover: 'beta-cover',
								videoCover: null,
								releaseDate: '2022-02-02'
							}
						}
					]
				});
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const context: CatalogApiContext = {
			baseUrl: 'https://example.test',
			fetch: fetchMock,
			ensureNotRateLimited: vi.fn()
		};

		const result = await getArtistRecommendations(context, 42);

		expect(result.source).toBe('artist-mix');
		expect(result.mixId).toBe('mix-42');
		expect(result.artists.map((artist) => artist.id)).toEqual([7, 9]);
		expect(result.albums.map((album) => album.id)).toEqual([100, 101]);
		expect(result.albums[0]?.artist?.id).toBe(7);
		expect(result.albums[1]?.artist?.id).toBe(9);
	});

	it('returns a none-source payload when no artist mix is available', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/artist/?id=42')) {
				return jsonResponse({
					version: '2.4',
					artist: {
						id: 42,
						name: 'Source Artist',
						type: 'ARTIST',
						mixes: {}
					}
				});
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const context: CatalogApiContext = {
			baseUrl: 'https://example.test',
			fetch: fetchMock,
			ensureNotRateLimited: vi.fn()
		};

		const result = await getArtistRecommendations(context, 42);

		expect(result.source).toBe('none');
		expect(result.reason).toBe('artist_lookup_missing_mix');
		expect(result.artists).toEqual([]);
		expect(result.albums).toEqual([]);
	});
});
