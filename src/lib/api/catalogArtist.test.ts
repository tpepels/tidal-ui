import { describe, expect, it, vi } from 'vitest';
import { getArtist } from './catalogArtist';
import type { CatalogApiContext } from './catalogTypes';

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

describe('catalog artist parsing', () => {
	it('uses the v2.10 artist envelope when discography aggregation needs fallback identity', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/artist/?f=42')) {
				return jsonResponse({
					version: '2.10',
					data: {
						items: []
					}
				});
			}
			if (url.includes('/artist/?id=42')) {
				return jsonResponse({
					version: '2.10',
					artist: {
						id: 42,
						name: 'Source Artist',
						type: 'MAIN',
						url: 'http://www.tidal.com/artist/42'
					},
					cover: null
				});
			}
			if (url.includes('/search/')) {
				return jsonResponse({
					version: '2.10',
					data: {
						albums: {
							limit: 500,
							offset: 0,
							totalNumberOfItems: 0,
							items: []
						}
					}
				});
			}
			throw new Error(`Unexpected URL: ${url}`);
		});
		const context: CatalogApiContext = {
			baseUrl: 'https://hifi.example.test',
			fetch: fetchMock,
			ensureNotRateLimited: vi.fn()
		};

		const result = await getArtist(context, 42);

		expect(result.id).toBe(42);
		expect(result.name).toBe('Source Artist');
		expect(result.albums).toEqual([]);
		expect(result.tracks).toEqual([]);
	});
});
