import { describe, expect, it, vi } from 'vitest';
import { getArtist, type CatalogApiContext } from './catalog';

const jsonResponse = (payload: unknown, status = 200) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' }
	});

const buildSourcePayload = () => ({
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
});

describe('catalog.getArtist enrichment', () => {
	it('enriches discography from artist-name search and exposes diagnostics', async () => {
		const sourcePayload = buildSourcePayload();
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
			if (url.includes('/artist/?f=1684')) return jsonResponse(sourcePayload);
			if (url.includes('/search/?al=')) return jsonResponse(searchPayload);
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
		expect(result.discographyInfo?.reason).toBe(
			'Artist-name search returned 1 of 300 albums for this artist'
		);
		expect(result.discographyInfo?.searchTotalCount).toBe(300);
		expect(result.discographyInfo?.searchReturnedCount).toBe(1);
		expect(result.discographyInfo?.sourceAlbumCount).toBe(0);
		expect(result.discographyInfo?.trackDerivedAlbumCount).toBe(1);
		expect(result.discographyInfo?.enrichedAlbumCount).toBe(1);
		expect(result.discographyInfo?.enrichmentDiagnostics?.passes).toEqual([
			{
				name: 'artist-name',
				query: 'Nina Simone',
				returned: 1,
				accepted: 1,
				newlyAdded: 1,
				total: 300
			}
		]);
	});

	it('uses only artist-name query for enrichment', async () => {
		const sourcePayload = buildSourcePayload();
		const searchPayload = {
			version: '2.4',
			data: {
				albums: {
					limit: 25,
					offset: 0,
					totalNumberOfItems: 145,
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

		const seenQueries: string[] = [];
		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/artist/?f=1684')) return jsonResponse(sourcePayload);
			if (url.includes('/search/?al=')) {
				const parsedUrl = new URL(url);
				seenQueries.push(parsedUrl.searchParams.get('al') ?? '');
				return jsonResponse(searchPayload);
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const context: CatalogApiContext = {
			baseUrl: 'https://example.test',
			fetch: fetchMock,
			ensureNotRateLimited: vi.fn()
		};

		await getArtist(context, 1684);

		expect(seenQueries).toEqual(['Nina Simone']);
	});

	it('does not include singles from enrichment search results', async () => {
		const sourcePayload = buildSourcePayload();
		const searchPayload = {
			version: '2.4',
			data: {
				albums: {
					limit: 25,
					offset: 0,
					totalNumberOfItems: 2,
					items: [
						{
							id: 2001,
							title: 'Recovered Album',
							type: 'ALBUM',
							cover: 'cover-2001',
							videoCover: null,
							artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }]
						},
						{
							id: 2002,
							title: 'Recovered Single',
							type: 'SINGLE',
							cover: 'cover-2002',
							videoCover: null,
							artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }]
						}
					]
				}
			}
		};

		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/artist/?f=1684')) return jsonResponse(sourcePayload);
			if (url.includes('/search/?al=')) return jsonResponse(searchPayload);
			throw new Error(`Unexpected URL: ${url}`);
		});

		const context: CatalogApiContext = {
			baseUrl: 'https://example.test',
			fetch: fetchMock,
			ensureNotRateLimited: vi.fn()
		};

		const result = await getArtist(context, 1684);
		const albumIds = result.albums.map((album) => album.id);
		expect(albumIds).toContain(2001);
		expect(albumIds).not.toContain(2002);
	});

	it('counts enrichment using unique title+quality variants', async () => {
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
						title: 'Shared Album',
						cover: 'cover-1001',
						videoCover: null,
						audioQuality: 'LOSSLESS'
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
					totalNumberOfItems: 4,
					items: [
						{
							id: 2001,
							title: 'Shared Album',
							audioQuality: 'LOSSLESS',
							cover: 'cover-2001',
							videoCover: null,
							artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }]
						},
						{
							id: 2002,
							title: 'Shared Album',
							audioQuality: 'LOSSLESS',
							cover: 'cover-2002',
							videoCover: null,
							artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }]
						},
						{
							id: 2003,
							title: 'Shared Album',
							audioQuality: 'HI_RES_LOSSLESS',
							cover: 'cover-2003',
							videoCover: null,
							artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }]
						},
						{
							id: 2004,
							title: 'Distinct Album',
							audioQuality: 'LOSSLESS',
							cover: 'cover-2004',
							videoCover: null,
							artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }]
						}
					]
				}
			}
		};

		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/artist/?f=1684')) return jsonResponse(sourcePayload);
			if (url.includes('/search/?al=')) return jsonResponse(searchPayload);
			throw new Error(`Unexpected URL: ${url}`);
		});

		const context: CatalogApiContext = {
			baseUrl: 'https://example.test',
			fetch: fetchMock,
			ensureNotRateLimited: vi.fn()
		};

		const result = await getArtist(context, 1684);
		expect(result.discographyInfo?.enrichedAlbumCount).toBe(2);
		expect(result.discographyInfo?.enrichmentApplied).toBe(true);
		expect(result.discographyInfo?.enrichmentDiagnostics?.passes[0]?.accepted).toBe(3);
		expect(result.discographyInfo?.enrichmentDiagnostics?.passes[0]?.newlyAdded).toBe(2);
		const sharedLosslessCount = result.albums.filter(
			(album) => album.title === 'Shared Album' && album.audioQuality === 'LOSSLESS'
		).length;
		expect(sharedLosslessCount).toBe(1);
	});

	it('keeps strict artist filtering in artist-name enrichment', async () => {
		const sourcePayload = buildSourcePayload();
		const searchPayload = {
			version: '2.4',
			data: {
				albums: {
					limit: 25,
					offset: 0,
					totalNumberOfItems: 2,
					items: [
						{
							id: 3001,
							title: 'Wrong Artist Album',
							cover: 'cover-3001',
							videoCover: null,
							artists: [{ id: 999999, name: 'Wrong Artist', type: 'MAIN' }]
						},
						{
							id: 3002,
							title: 'Correct Artist Album',
							cover: 'cover-3002',
							videoCover: null,
							artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }]
						}
					]
				}
			}
		};

		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/artist/?f=1684')) return jsonResponse(sourcePayload);
			if (url.includes('/search/?al=')) return jsonResponse(searchPayload);
			throw new Error(`Unexpected URL: ${url}`);
		});

		const context: CatalogApiContext = {
			baseUrl: 'https://example.test',
			fetch: fetchMock,
			ensureNotRateLimited: vi.fn()
		};

		const result = await getArtist(context, 1684);
		const albumIds = result.albums.map((album) => album.id);
		expect(albumIds).toContain(3002);
		expect(albumIds).not.toContain(3001);
	});
});
