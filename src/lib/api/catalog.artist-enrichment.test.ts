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

	it('falls back to artist-name search when URL search returns no matching artist albums', async () => {
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

		const urlSearchPayload = {
			version: '2.4',
			data: {
				albums: {
					limit: 25,
					offset: 0,
					totalNumberOfItems: 300,
					items: [
						{
							id: 76032367,
							title: 'Unrelated Compilation',
							cover: 'cover-76032367',
							videoCover: null,
							artists: [{ id: 2935, name: 'Various Artists', type: 'MAIN' }]
						}
					]
				}
			}
		};

		const artistNameSearchPayload = {
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

		const emptySearchPayload = {
			version: '2.4',
			data: {
				albums: {
					limit: 25,
					offset: 0,
					totalNumberOfItems: 0,
					items: []
				}
			}
		};

		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/artist/?f=1684')) {
				return jsonResponse(sourcePayload);
			}
			if (url.includes('/search/?al=')) {
				const parsedUrl = new URL(url);
				const query = parsedUrl.searchParams.get('al');
				if (query === 'https://tidal.com/artist/1684') {
					return jsonResponse(urlSearchPayload);
				}
				if (query === 'Nina Simone') {
					return jsonResponse(artistNameSearchPayload);
				}
				return jsonResponse(emptySearchPayload);
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
		expect(result.discographyInfo?.reason).toBe(
			'Artist-name search returned 1 of 145 albums for this artist'
		);
		expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/search/?al=Nina%20Simone'));
		expect(result.discographyInfo?.enrichmentDiagnostics?.passes.some((pass) => pass.name === 'artist-name')).toBe(true);
	});

	it('uses track-title enrichment queries to recover missing albums', async () => {
		const weightedTrackTitles: Array<[string, number]> = [
			['Alpha', 9],
			['Beta', 8],
			['Gamma', 7],
			['Delta', 6],
			['Epsilon', 5],
			['Zeta', 4],
			['Eta', 3],
			['Theta', 2],
			['Little Girl Blue', 1]
		];
		let trackIdCursor = 7000;
		const sourceTracks = weightedTrackTitles.flatMap(([title, count], groupIndex) =>
			Array.from({ length: count }, (_, offset) => ({
				id: trackIdCursor++,
				title,
				duration: 120,
				trackNumber: offset + 1,
				volumeNumber: 1,
				version: null,
				popularity: 100 - groupIndex,
				url: `http://www.tidal.com/track/${trackIdCursor}`,
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
					id: 8000 + groupIndex,
					title: `Source Album ${groupIndex + 1}`,
					cover: `cover-${groupIndex + 1}`,
					videoCover: null
				}
			}))
		);

		const sourcePayload = {
			version: '2.4',
			albums: [],
			tracks: sourceTracks
		};

		const urlSearchPayload = {
			version: '2.4',
			data: {
				albums: {
					limit: 25,
					offset: 0,
					totalNumberOfItems: 300,
					items: Array.from({ length: 25 }, (_, index) => ({
						id: 8800 + index,
						title: `Unrelated ${index + 1}`,
						cover: `cover-unrelated-${index}`,
						videoCover: null,
						artists: [{ id: 2935, name: 'Various Artists', type: 'MAIN' }]
					}))
				}
			}
		};

		const artistNameSearchPayload = {
			version: '2.4',
			data: {
				albums: {
					limit: 25,
					offset: 0,
					totalNumberOfItems: 145,
					items: Array.from({ length: 25 }, (_, index) => ({
						id: 9800 + index,
						title: `Known Album ${index + 1}`,
						cover: `cover-known-${index}`,
						videoCover: null,
						artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }]
					}))
				}
			}
		};

		const fetchQueries: string[] = [];
		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/artist/?f=1684')) {
				return jsonResponse(sourcePayload);
			}
			if (url.includes('/search/?al=')) {
				const parsed = new URL(url);
				const query = parsed.searchParams.get('al') ?? '';
				fetchQueries.push(query);
				if (query === 'https://tidal.com/artist/1684') {
					return jsonResponse(urlSearchPayload);
				}
				if (query === 'Nina Simone') {
					return jsonResponse(artistNameSearchPayload);
				}
				if (query.includes('Little Girl Blue')) {
					return jsonResponse({
						version: '2.4',
						data: {
							albums: {
								limit: 25,
								offset: 0,
								totalNumberOfItems: 1,
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
					});
				}
				return jsonResponse({
					version: '2.4',
					data: { albums: { limit: 25, offset: 0, totalNumberOfItems: 0, items: [] } }
				});
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const context: CatalogApiContext = {
			baseUrl: 'https://example.test',
			fetch: fetchMock,
			ensureNotRateLimited: vi.fn()
		};

		const result = await getArtist(context, 1684);
		expect(result.albums.some((album) => album.id === 274235577)).toBe(true);
		expect(fetchQueries.some((query) => query.includes('Little Girl Blue'))).toBe(true);
		expect(result.discographyInfo?.enrichedAlbumCount).toBeGreaterThan(0);
	});

	it('enforces query budget and preserves strict artist filtering across enrichment passes', async () => {
		const sourceTracks = Array.from({ length: 12 }, (_, index) => {
			const albumId = 4000 + index;
			return {
				id: 5000 + index,
				title: `Track ${index + 1}`,
				duration: 120,
				trackNumber: index + 1,
				volumeNumber: 1,
				version: null,
				popularity: 1,
				url: `http://www.tidal.com/track/${5000 + index}`,
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
					id: albumId,
					title: `Album ${index + 1}`,
					cover: `cover-${albumId}`,
					videoCover: null
				}
			};
		});

		const sourcePayload = {
			version: '2.4',
			albums: [],
			tracks: sourceTracks
		};

		const urlSearchPayload = {
			version: '2.4',
			data: {
				albums: {
					limit: 25,
					offset: 0,
					totalNumberOfItems: 300,
					items: Array.from({ length: 25 }, (_, index) => ({
						id: 8000 + index,
						title: `Unrelated ${index + 1}`,
						cover: `cover-8000-${index}`,
						videoCover: null,
						artists: [{ id: 2935, name: 'Various Artists', type: 'MAIN' }]
					}))
				}
			}
		};

		const artistNameSearchPayload = {
			version: '2.4',
			data: {
				albums: {
					limit: 25,
					offset: 0,
					totalNumberOfItems: 145,
					items: Array.from({ length: 25 }, (_, index) => ({
						id: 9000 + index,
						title: `Known Album ${index + 1}`,
						cover: `cover-9000-${index}`,
						videoCover: null,
						artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }]
					}))
				}
			}
		};

		const titleSearchPayload = (query: string) => {
			const titleSeed = Number(query.match(/Album (\d+)/)?.[1] ?? '0');
			return {
				version: '2.4',
				data: {
					albums: {
						limit: 25,
						offset: 0,
						totalNumberOfItems: 2,
						items: [
							{
								id: 10000 + titleSeed,
								title: `Recovered Album ${titleSeed}`,
								cover: `cover-recovered-${titleSeed}`,
								videoCover: null,
								artists: [{ id: 1684, name: 'Nina Simone', type: 'MAIN' }]
							},
							{
								id: 11000 + titleSeed,
								title: `Wrong Artist Album ${titleSeed}`,
								cover: `cover-wrong-${titleSeed}`,
								videoCover: null,
								artists: [{ id: 999999, name: 'Wrong Artist', type: 'MAIN' }]
							}
						]
					}
				}
			};
		};

		const seenQueries: string[] = [];
		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes('/artist/?f=1684')) {
				return jsonResponse(sourcePayload);
			}
			if (url.includes('/search/?al=')) {
				const parsedUrl = new URL(url);
				const query = parsedUrl.searchParams.get('al') ?? '';
				seenQueries.push(query);
				if (query === 'https://tidal.com/artist/1684') {
					return jsonResponse(urlSearchPayload);
				}
				if (query === 'Nina Simone') {
					return jsonResponse(artistNameSearchPayload);
				}
				if (query.startsWith('Nina Simone Album')) {
					return jsonResponse(titleSearchPayload(query));
				}
				return jsonResponse({
					version: '2.4',
					data: { albums: { limit: 25, offset: 0, totalNumberOfItems: 0, items: [] } }
				});
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const context: CatalogApiContext = {
			baseUrl: 'https://example.test',
			fetch: fetchMock,
			ensureNotRateLimited: vi.fn()
		};

		const result = await getArtist(context, 1684);
		const discographyInfo = result.discographyInfo;
		expect(discographyInfo).toBeDefined();
		expect(discographyInfo?.enrichmentDiagnostics?.queryCount).toBe(14);
		expect(discographyInfo?.enrichmentDiagnostics?.queryBudget).toBe(14);
		expect(discographyInfo?.enrichmentDiagnostics?.budgetExhausted).toBe(true);
		expect(discographyInfo?.reason).toBe('Artist-name search returned 25 of 145 albums for this artist');
		expect(discographyInfo?.searchAlbumCount).toBe(25);

		const wrongArtistAlbumPresent = result.albums.some(
			(album) => album.artist?.id === 999999 || album.artists?.some((artist) => artist.id === 999999)
		);
		expect(wrongArtistAlbumPresent).toBe(false);
		expect(seenQueries.filter((query) => query.startsWith('Nina Simone Album')).length).toBeGreaterThan(0);
		expect(seenQueries.filter((query) => query.startsWith('Nina Simone Track')).length).toBeGreaterThan(0);
	});
});
