import { describe, expect, it, vi } from 'vitest';
import { getAlbum, type CatalogApiContext } from './catalog';

function createContext(fetchImpl: CatalogApiContext['fetch']): CatalogApiContext {
	return {
		baseUrl: 'https://api.example.com/v1',
		fetch: fetchImpl,
		ensureNotRateLimited: vi.fn()
	};
}

function createAlbumResponse(id: number): Response {
	return new Response(
		JSON.stringify([
			{
				id,
				title: `Album ${id}`,
				cover: `cover-${id}`
			}
		]),
		{
			status: 200,
			headers: { 'content-type': 'application/json' }
		}
	);
}

describe('catalog album request guards', () => {
	it('dedupes concurrent getAlbum requests for the same id', async () => {
		let resolveFetch: ((value: Response) => void) | undefined;
		const fetchMock = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					resolveFetch = resolve;
				})
		);
		const context = createContext(fetchMock);

		const first = getAlbum(context, 111001);
		const second = getAlbum(context, 111001);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		if (!resolveFetch) {
			throw new Error('Expected fetch promise resolver to be available');
		}
		resolveFetch(createAlbumResponse(111001));

		const [firstResult, secondResult] = await Promise.all([first, second]);
		expect(firstResult.album.id).toBe(111001);
		expect(secondResult.album.id).toBe(111001);
	});

	it('caches not-found album lookups and suppresses immediate retries', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }));
		const context = createContext(fetchMock);

		await expect(getAlbum(context, 222002)).rejects.toMatchObject({ status: 404 });
		await expect(getAlbum(context, 222002)).rejects.toMatchObject({ status: 404, cached: true });

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
