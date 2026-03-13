import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTabSearch, clearSearchCache } from './searchService';
import type { Album, Artist, Track, Playlist } from '$lib/types';

const mockSearchTracks = vi.fn();
const mockSearchAlbums = vi.fn();
const mockSearchArtists = vi.fn();
const mockSearchPlaylists = vi.fn();
const mockGetArtist = vi.fn();

vi.mock('$lib/api', () => ({
	losslessAPI: {
		searchTracks: (...args: unknown[]) => mockSearchTracks(...args),
		searchAlbums: (...args: unknown[]) => mockSearchAlbums(...args),
		searchArtists: (...args: unknown[]) => mockSearchArtists(...args),
		searchPlaylists: (...args: unknown[]) => mockSearchPlaylists(...args),
		getArtist: (...args: unknown[]) => mockGetArtist(...args)
	}
}));

describe('searchService', () => {
	const baseAlbum: Album = {
		id: 100,
		title: 'Random Access Memories',
		cover: '',
		videoCover: null,
		artist: { id: 10, name: 'Daft Punk', type: 'MAIN' }
	};
	const officialAlbum: Album = {
		id: 101,
		title: 'Random Access Memories (10th Anniversary Edition)',
		cover: '',
		videoCover: null,
		artist: { id: 10, name: 'Daft Punk', type: 'MAIN' },
		discographySource: 'official_tidal'
	};
	const artist: Artist = { id: 10, name: 'Daft Punk', type: 'MAIN' };
	const partialArtistAlbum: Album = {
		id: 102,
		title: 'Random Access Memories',
		cover: '',
		videoCover: null,
		artist: { id: 10, name: 'Daft Punk', type: 'MAIN' }
	};
	const nonMatchingAlbum: Album = {
		id: 103,
		title: 'Voices of a Generation',
		cover: '',
		videoCover: null,
		artist: { id: 77, name: 'Random Artist', type: 'MAIN' }
	};
	const dylanAlbum: Album = {
		id: 104,
		title: 'Voices of a Generation',
		cover: '',
		videoCover: null,
		artist: { id: 201, name: 'Bob Dylan', type: 'MAIN' }
	};
	const dylanOfficialAlbum: Album = {
		id: 105,
		title: 'Voices of a Generation (Deluxe)',
		cover: '',
		videoCover: null,
		artist: { id: 201, name: 'Bob Dylan', type: 'MAIN' },
		discographySource: 'official_tidal'
	};
	const dylanArtist: Artist = { id: 201, name: 'Bob Dylan', type: 'MAIN' };

	beforeEach(() => {
		clearSearchCache();
		mockSearchTracks.mockResolvedValue({ items: [] });
		mockSearchAlbums.mockResolvedValue({ items: [] });
		mockSearchArtists.mockResolvedValue({ items: [] });
		mockSearchPlaylists.mockResolvedValue({ items: [] });
		mockGetArtist.mockResolvedValue({
			...artist,
			albums: [],
			tracks: []
		});
		vi.clearAllMocks();
	});

	it('does not dedupe requests across regions', async () => {
		await executeTabSearch('test', 'tracks', 'us');
		await executeTabSearch('test', 'tracks', 'eu');

		expect(mockSearchTracks).toHaveBeenCalledTimes(2);
		expect(mockSearchTracks).toHaveBeenNthCalledWith(1, 'test', 'us');
		expect(mockSearchTracks).toHaveBeenNthCalledWith(2, 'test', 'eu');
	});

	it('ranks track search results with the strongest textual match first', async () => {
		const createTrack = (id: number, title: string, artistName: string, popularity = 10): Track => ({
			id,
			title,
			duration: 180,
			replayGain: -6,
			peak: 0.95,
			allowStreaming: true,
			streamReady: true,
			streamStartDate: '2024-01-01',
			premiumStreamingOnly: false,
			trackNumber: 1,
			volumeNumber: 1,
			version: null,
			popularity,
			copyright: '',
			url: 'https://example.com',
			isrc: `TRACK${id}`,
			editable: false,
			explicit: false,
			audioQuality: 'LOSSLESS',
			audioModes: ['STEREO'],
			artist: { id: id + 10, name: artistName, type: 'MAIN' },
			artists: [{ id: id + 10, name: artistName, type: 'MAIN' }],
			album: {
				id: id + 100,
				title: 'Album',
				cover: '',
				videoCover: null
			}
		});
		mockSearchTracks.mockResolvedValue({
			items: [
				createTrack(1, 'Voices', 'Bob Dylan', 80),
				createTrack(2, 'Highway 61 Revisited', 'Bob Dylan', 95),
				createTrack(3, 'Voices of a Generation', 'Bob Dylan', 10)
			]
		});

		const result = await executeTabSearch('Voices of a Generation', 'tracks', 'us');

		expect(result.success).toBe(true);
		if (result.success) {
			expect((result.results.tracks[0] as Track).title).toBe('Voices of a Generation');
		}
	});

	it('ranks artist search results by strongest name relevance', async () => {
		mockSearchArtists.mockResolvedValue({
			items: [
				{ id: 301, name: 'Generation Vox', type: 'MAIN', popularity: 95 } as Artist,
				{ id: 302, name: 'Voices of a Generation', type: 'MAIN', popularity: 5 } as Artist
			]
		});

		const result = await executeTabSearch('Voices of a Generation', 'artists', 'us');

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.results.artists[0]?.id).toBe(302);
		}
	});

	it('ranks playlist search results by title relevance over popularity', async () => {
		const createPlaylist = (uuid: string, title: string, popularity: number): Playlist => ({
			uuid,
			title,
			description: '',
			image: '',
			squareImage: '',
			duration: 1200,
			numberOfTracks: 20,
			numberOfVideos: 0,
			creator: { id: 1, name: 'tester', picture: null },
			created: '2025-01-01',
			lastUpdated: '2025-01-01',
			type: 'playlist',
			publicPlaylist: true,
			url: `https://tidal.com/playlist/${uuid}`,
			popularity
		});
		mockSearchPlaylists.mockResolvedValue({
			items: [
				createPlaylist('pl-low', 'Voices of a Generation', 5),
				createPlaylist('pl-high', 'Generation Mix', 99)
			]
		});

		const result = await executeTabSearch('Voices of a Generation', 'playlists', 'us');

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.results.playlists[0]?.uuid).toBe('pl-low');
		}
	});

	it('passes optional album artist filter and merges official catalog enrichment', async () => {
		mockSearchAlbums.mockResolvedValue({ items: [baseAlbum] });
		mockSearchArtists.mockResolvedValue({ items: [artist] });
		mockGetArtist.mockResolvedValue({
			...artist,
			albums: [officialAlbum],
			tracks: []
		});

		const result = await executeTabSearch('Random Access Memories', 'albums', 'us', {
			albumArtistQuery: 'Daft Punk'
		});

		expect(mockSearchAlbums).toHaveBeenCalledWith('Random Access Memories', 'us', 'Daft Punk');
		expect(
			mockSearchArtists.mock.calls.some(
				(call) => call[0] === 'Daft Punk' && call[1] === 'us'
			)
		).toBe(true);
		expect(mockSearchTracks).toHaveBeenCalledWith('Random Access Memories', 'us');
		expect(mockGetArtist).toHaveBeenCalledWith(artist.id);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.results.albums.some((album) => album.id === officialAlbum.id)).toBe(true);
		}
	});

	it('supports strict album artist matching (exact artist only)', async () => {
		mockSearchAlbums.mockResolvedValue({ items: [partialArtistAlbum] });
		mockSearchArtists.mockResolvedValue({ items: [artist] });
		mockGetArtist.mockResolvedValue({
			...artist,
			albums: [officialAlbum],
			tracks: []
		});

		const result = await executeTabSearch('Random Access Memories', 'albums', 'us', {
			albumArtistQuery: 'Daft',
			strictAlbumArtistMatch: true
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.results.albums).toHaveLength(0);
		}
	});

	it('supports strict artist wildcard patterns for album filtering', async () => {
		mockSearchAlbums.mockResolvedValue({ items: [dylanAlbum] });
		mockSearchArtists.mockResolvedValue({ items: [dylanArtist] });
		mockGetArtist.mockResolvedValue({
			...dylanArtist,
			albums: [dylanOfficialAlbum],
			tracks: []
		});

		const result = await executeTabSearch('Voices of a Generation', 'albums', 'us', {
			albumArtistQuery: 'Bob Dyl*',
			strictAlbumArtistMatch: true
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.results.albums.some((album) => album.id === dylanAlbum.id)).toBe(true);
			expect(result.results.albums.some((album) => album.id === dylanOfficialAlbum.id)).toBe(true);
		}
	});

	it('does not fall back to unfiltered albums when artist filter has no matches', async () => {
		mockSearchAlbums.mockResolvedValue({ items: [nonMatchingAlbum] });
		mockSearchArtists.mockResolvedValue({ items: [] });
		mockGetArtist.mockResolvedValue({
			...artist,
			albums: [],
			tracks: []
		});

		const result = await executeTabSearch('Voices of a Generation', 'albums', 'us', {
			albumArtistQuery: 'Dylan'
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.results.albums).toHaveLength(0);
		}
	});

	it('does not return same-artist albums when album title does not match', async () => {
		const wrongTitleByDylan: Album = {
			id: 701,
			title: 'Highway 61 Revisited',
			cover: '',
			videoCover: null,
			artist: { id: 201, name: 'Bob Dylan', type: 'MAIN' }
		};
		mockSearchAlbums.mockResolvedValue({ items: [wrongTitleByDylan] });
		mockSearchArtists.mockResolvedValue({ items: [dylanArtist] });
		mockGetArtist.mockResolvedValue({
			...dylanArtist,
			albums: [wrongTitleByDylan],
			tracks: []
		});

		const result = await executeTabSearch('Voices of a Generation', 'albums', 'us', {
			albumArtistQuery: 'Bob Dylan'
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.results.albums).toHaveLength(0);
		}
	});

	it('recovers matching albums from track search when album search is sparse', async () => {
		mockSearchAlbums.mockResolvedValue({ items: [] });
		mockSearchArtists.mockResolvedValue({ items: [] });
		mockSearchTracks.mockResolvedValue({
			items: [
				{
					id: 9001,
					title: 'Voices of a Generation',
					artist: { id: 201, name: 'Bob Dylan', type: 'MAIN' },
					artists: [{ id: 201, name: 'Bob Dylan', type: 'MAIN' }],
					album: {
						id: 9050,
						title: 'Voices of a Generation',
						cover: '',
						videoCover: null
					}
				}
			]
		});
		mockGetArtist.mockResolvedValue({
			...dylanArtist,
			albums: [],
			tracks: []
		});

		const result = await executeTabSearch('Voices of a Generation', 'albums', 'us', {
			albumArtistQuery: 'Dylan'
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.results.albums.some((album) => album.id === 9050)).toBe(true);
		}
	});

	it('emits progressive album updates while enrichment is running', async () => {
		mockSearchAlbums.mockResolvedValue({ items: [baseAlbum] });
		mockSearchArtists.mockResolvedValue({ items: [artist] });
		mockGetArtist.mockResolvedValue({
			...artist,
			albums: [officialAlbum],
			tracks: []
		});
		const onProgress = vi.fn();

		const result = await executeTabSearch('Random Access Memories', 'albums', 'us', {
			albumArtistQuery: 'Daft Punk',
			onProgress
		});

		expect(result.success).toBe(true);
		expect(onProgress).toHaveBeenCalled();
		expect(
			onProgress.mock.calls.some((call) => call[0]?.phase === 'base' && call[0]?.items?.length >= 1)
		).toBe(true);
		expect(
			onProgress.mock.calls.some(
				(call) =>
					call[0]?.phase === 'enriched' &&
					call[0]?.items?.some((album: Album) => album.id === officialAlbum.id)
				)
		).toBe(true);
	});

	it('expands album API queries to fetch broader base results', async () => {
		mockSearchAlbums
			.mockResolvedValueOnce({ items: [] })
			.mockResolvedValueOnce({ items: [baseAlbum] })
			.mockResolvedValue({ items: [] });
		mockSearchArtists.mockResolvedValue({ items: [] });
		mockGetArtist.mockResolvedValue({
			...artist,
			albums: [],
			tracks: []
		});

		const result = await executeTabSearch('Random Access Memories', 'albums', 'us', {
			albumArtistQuery: 'Daft Punk'
		});

		expect(mockSearchAlbums.mock.calls.length).toBeGreaterThan(1);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.results.albums.some((album) => album.id === baseAlbum.id)).toBe(true);
		}
	});

	it('treats artist filters as wildcard-friendly for enriched album search', async () => {
		mockSearchAlbums.mockResolvedValue({ items: [dylanAlbum] });
		mockSearchArtists.mockImplementation(async (query: string) => {
			if (query.toLowerCase().includes('dyl')) {
				return { items: [dylanArtist] };
			}
			return { items: [] };
		});
		mockGetArtist.mockResolvedValue({
			...dylanArtist,
			albums: [dylanOfficialAlbum],
			tracks: []
		});

		const result = await executeTabSearch('Voices of a Generation', 'albums', 'us', {
			albumArtistQuery: 'Dyl*'
		});

		expect(result.success).toBe(true);
		expect(
			mockSearchAlbums.mock.calls.some(
				(call) => call[0] === 'Voices of a Generation' && call[1] === 'us' && call[2] === 'Dyl'
			)
		).toBe(true);
		expect(
			mockSearchArtists.mock.calls.some(
				(call) => typeof call[0] === 'string' && call[0].toLowerCase().includes('dyl')
			)
		).toBe(true);
		if (result.success) {
			expect(result.results.albums.some((album) => album.id === dylanOfficialAlbum.id)).toBe(true);
		}
	});

	it('returns cached album results for repeated identical searches', async () => {
		mockSearchAlbums.mockResolvedValue({ items: [baseAlbum] });
		mockSearchArtists.mockResolvedValue({ items: [artist] });
		mockGetArtist.mockResolvedValue({
			...artist,
			albums: [officialAlbum],
			tracks: []
		});

		const first = await executeTabSearch('Random Access Memories', 'albums', 'us', {
			albumArtistQuery: 'Daft Punk'
		});
		expect(first.success).toBe(true);
		const callsAfterFirst = mockSearchAlbums.mock.calls.length;
		const artistCallsAfterFirst = mockSearchArtists.mock.calls.length;
		const getArtistCallsAfterFirst = mockGetArtist.mock.calls.length;

		const second = await executeTabSearch('Random Access Memories', 'albums', 'us', {
			albumArtistQuery: 'Daft Punk'
		});
		expect(second.success).toBe(true);
		expect(mockSearchAlbums.mock.calls.length).toBe(callsAfterFirst);
		expect(mockSearchArtists.mock.calls.length).toBe(artistCallsAfterFirst);
		expect(mockGetArtist.mock.calls.length).toBe(getArtistCallsAfterFirst);
	});

	it('retries artists tab search after transient errors', async () => {
		mockSearchArtists
			.mockRejectedValueOnce(new Error('temporary artist search failure'))
			.mockResolvedValueOnce({ items: [dylanArtist] });

		const result = await executeTabSearch('Bob Dylan', 'artists', 'us');

		expect(result.success).toBe(true);
		expect(mockSearchArtists).toHaveBeenCalledTimes(2);
		if (result.success) {
			expect(result.results.artists.some((artist) => artist.id === dylanArtist.id)).toBe(true);
		}
	});

	it('retries playlists tab search after transient errors', async () => {
		const playlist = {
			uuid: 'pl-42',
			title: 'Test',
			description: 'Test playlist',
			image: '',
			squareImage: '',
			duration: 1200,
			numberOfTracks: 20,
			numberOfVideos: 0,
			creator: { id: 1, name: 'tester', picture: null },
			created: '2025-01-01',
			lastUpdated: '2025-01-01',
			type: 'playlist',
			publicPlaylist: true,
			url: 'https://tidal.com/playlist/pl-42',
			popularity: 0
		};
		mockSearchPlaylists
			.mockRejectedValueOnce(new Error('temporary playlist search failure'))
			.mockResolvedValueOnce({ items: [playlist] });

		const result = await executeTabSearch('Road Trip', 'playlists', 'us');

		expect(result.success).toBe(true);
		expect(mockSearchPlaylists).toHaveBeenCalledTimes(2);
		if (result.success) {
			expect(result.results.playlists.some((entry) => entry.uuid === 'pl-42')).toBe(true);
		}
	});
});
