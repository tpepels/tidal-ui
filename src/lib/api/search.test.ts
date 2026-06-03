import { describe, expect, it, vi } from 'vitest';
import { searchAlbums, type SearchApiContext } from './search';

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

describe('search API', () => {
	it('uses a single hifi-api album query param and filters artist locally', async () => {
		const fetchMock = vi.fn<
			Parameters<SearchApiContext['fetch']>,
			ReturnType<SearchApiContext['fetch']>
		>(async () =>
			jsonResponse({
				version: '2.10',
				data: {
					albums: {
						limit: 100,
						offset: 0,
						totalNumberOfItems: 2,
						items: [
							{
								id: 1,
								title: 'Money For Nothing',
								cover: 'cover-1',
								videoCover: null,
								artist: { id: 10, name: 'Dire Straits', type: 'MAIN' },
								artists: [{ id: 10, name: 'Dire Straits', type: 'MAIN' }]
							},
							{
								id: 2,
								title: 'Money For Nothing',
								cover: 'cover-2',
								videoCover: null,
								artist: { id: 20, name: 'Other Artist', type: 'MAIN' },
								artists: [{ id: 20, name: 'Other Artist', type: 'MAIN' }]
							}
						]
					}
				}
			})
		);
		const context: SearchApiContext = {
			buildRegionalUrl: (path) => `https://hifi.example.test${path}`,
			fetch: fetchMock,
			ensureNotRateLimited: vi.fn()
		};

		const result = await searchAlbums(context, 'Money For Nothing', 'auto', 'Dire Straits');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
		expect(requestedUrl.pathname).toBe('/search/');
		expect(requestedUrl.searchParams.get('al')).toBe('Money For Nothing');
		expect(requestedUrl.searchParams.has('a')).toBe(false);
		expect(result.items).toHaveLength(1);
		expect(result.items[0].artist?.name).toBe('Dire Straits');
		expect(result.totalNumberOfItems).toBe(1);
	});
});
