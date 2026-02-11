import { describe, expect, it, vi } from 'vitest';
import { getArtist, type CatalogApiContext } from './catalog';

const jsonResponse = (payload: unknown, status = 200) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' }
	});

describe('catalog.getArtist enrichment', () => {
	it('enriches discography from search and exposes incompleteness diagnostics', async () => {
		const sourcePayload = {
			version: '2.4',
			albums: [],
			tracks: [
				{
					id: 101,
					title: 'Source Track',
					duration: 120,
					trackNumber: 1,
					volumeNumber: 1,
					version: null,
					popularity: 1,
					url: 'http://www.tidal.com/track/101',
					streamReady: true,
					allowStreaming: true,
					premiumStreamingOnly: false,
					explicit: false,
					editable: false,
					audioQuality: 'LOW',
					audioModes: [],
					artist: { id: 1684, name: 'Nina Simone', type: 'MAIN' },
					artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }],
					album: {
						id: 1001,
						title: 'Source Album',
						cover: 'cover-1001',
						videoCover: null
					}
				}
			]
		};

		const searchPayload = {
			version: '2.4',
			data: {
				albums: {
					limit: 25,
					offset: 0,
					totalNumberOfItems: 300,
					items: [
						{
							id: 274235577,
							title: 'Little Girl Blue (2021 - Stereo Remaster)',
							cover: 'cover-274235577',
							videoCover: null,
							artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }]
						}
					]
				}
			}
		};

		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/artist/?f=1684')) {
				return jsonResponse(sourcePayload);
			}
			if (url.includes('/search/?al=')) {
				return jsonResponse(searchPayload);
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const context: CatalogApiContext = {
			baseUrl: 'https://example.test',
			fetch: fetchMock,
			ensureNotRateLimited: vi.fn()
		};

		const result = await getArtist(context, 1684);
		const albumIds = result.albums.map((album) => album.id);

		expect(albumIds).toContain(1001);
		expect(albumIds).toContain(274235577);
		expect(result.discographyInfo?.enrichmentApplied).toBe(true);
		expect(result.discographyInfo?.mayBeIncomplete).toBe(true);
		expect(result.discographyInfo?.searchTotalCount).toBe(300);
		expect(result.discographyInfo?.searchReturnedCount).toBe(1);
		expect(result.discographyInfo?.sourceAlbumCount).toBe(0);
		expect(result.discographyInfo?.trackDerivedAlbumCount).toBe(1);
		expect(result.discographyInfo?.enrichedAlbumCount).toBe(1);
	});
});

