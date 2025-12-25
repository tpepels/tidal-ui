import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedClass } from 'vitest';
import { TidalApiClient } from './tidal-api.client';
import { SearchService } from './search.service';
import { PlaybackService } from './playback.service';
import { ContentService } from './content.service';

// Mock dependencies
vi.mock('$lib/version', () => ({ APP_VERSION: '1.0.0' }));
vi.mock('./search.service');
vi.mock('./playback.service');
vi.mock('./content.service');

const MockedSearchService = SearchService as MockedClass<typeof SearchService>;
const MockedPlaybackService = PlaybackService as MockedClass<typeof PlaybackService>;
const MockedContentService = ContentService as MockedClass<typeof ContentService>;

describe('TidalApiClient', () => {
	let client: TidalApiClient;
	let mockSearch: InstanceType<typeof MockedSearchService>;
	let mockPlayback: InstanceType<typeof MockedPlaybackService>;
	let mockContent: InstanceType<typeof MockedContentService>;

	beforeEach(() => {
		vi.clearAllMocks();

		mockSearch = new MockedSearchService();
		mockPlayback = new MockedPlaybackService();
		mockContent = new MockedContentService();

		MockedSearchService.mockImplementation(() => mockSearch);
		MockedPlaybackService.mockImplementation(() => mockPlayback);
		MockedContentService.mockImplementation(() => mockContent);

		client = new TidalApiClient('https://test-api.com');
	});

	it('delegates searchTracks to SearchService', async () => {
		const mockResult = { items: [], totalNumberOfItems: 0 };
		mockSearch.searchTracks = vi.fn().mockResolvedValue(mockResult);

		const result = await client.searchTracks('query', 'us', 10, 5);

		expect(mockSearch.searchTracks).toHaveBeenCalledWith('query', 'us', 10, 5);
		expect(result).toBe(mockResult);
	});

	it('delegates searchAlbums to SearchService', async () => {
		const mockResult = { items: [], totalNumberOfItems: 0 };
		mockSearch.searchAlbums = vi.fn().mockResolvedValue(mockResult);

		const result = await client.searchAlbums('query', 'us', 10, 5);

		expect(mockSearch.searchAlbums).toHaveBeenCalledWith('query', 'us', 10, 5);
		expect(result).toBe(mockResult);
	});

	it('delegates searchArtists to SearchService', async () => {
		const mockResult = { items: [], totalNumberOfItems: 0 };
		mockSearch.searchArtists = vi.fn().mockResolvedValue(mockResult);

		const result = await client.searchArtists('query', 'us', 10, 5);

		expect(mockSearch.searchArtists).toHaveBeenCalledWith('query', 'us', 10, 5);
		expect(result).toBe(mockResult);
	});

	it('delegates searchPlaylists to SearchService', async () => {
		const mockResult = { items: [], totalNumberOfItems: 0 };
		mockSearch.searchPlaylists = vi.fn().mockResolvedValue(mockResult);

		const result = await client.searchPlaylists('query', 'us', 10, 5);

		expect(mockSearch.searchPlaylists).toHaveBeenCalledWith('query', 'us', 10, 5);
		expect(result).toBe(mockResult);
	});

	it('delegates getTrack to PlaybackService', async () => {
		const mockResult = { id: 123, title: 'Track' };
		mockPlayback.getTrackInfo = vi.fn().mockResolvedValue(mockResult);

		const result = await client.getTrack(123, 'LOSSLESS');

		expect(mockPlayback.getTrackInfo).toHaveBeenCalledWith(123, 'LOSSLESS');
		expect(result).toBe(mockResult);
	});

	it('delegates getStreamData to PlaybackService', async () => {
		const mockResult = { url: 'stream-url', quality: 'LOSSLESS' };
		mockPlayback.getStreamData = vi.fn().mockResolvedValue(mockResult);

		const result = await client.getStreamData(123, 'LOSSLESS');

		expect(mockPlayback.getStreamData).toHaveBeenCalledWith(123, 'LOSSLESS');
		expect(result).toBe(mockResult);
	});

	it('delegates getDashManifest to PlaybackService', async () => {
		const mockResult = { manifest: 'dash-xml' };
		mockPlayback.getDashManifest = vi.fn().mockResolvedValue(mockResult);

		const result = await client.getDashManifest(123, 'HI_RES_LOSSLESS');

		expect(mockPlayback.getDashManifest).toHaveBeenCalledWith(123, 'HI_RES_LOSSLESS');
		expect(result).toBe(mockResult);
	});

	it('delegates getAlbum to ContentService', async () => {
		const mockResult = { album: {}, tracks: [] };
		mockContent.getAlbum = vi.fn().mockResolvedValue(mockResult);

		const result = await client.getAlbum(456);

		expect(mockContent.getAlbum).toHaveBeenCalledWith(456);
		expect(result).toBe(mockResult);
	});

	it('delegates getArtist to ContentService', async () => {
		const mockResult = { id: 789, name: 'Artist' };
		mockContent.getArtist = vi.fn().mockResolvedValue(mockResult);

		const result = await client.getArtist(789);

		expect(mockContent.getArtist).toHaveBeenCalledWith(789);
		expect(result).toBe(mockResult);
	});

	it('delegates getPlaylist to ContentService', async () => {
		const mockResult = { playlist: {}, items: [] };
		mockContent.getPlaylist = vi.fn().mockResolvedValue(mockResult);

		const result = await client.getPlaylist('uuid-123');

		expect(mockContent.getPlaylist).toHaveBeenCalledWith('uuid-123');
		expect(result).toBe(mockResult);
	});

	it('delegates getLyrics to ContentService', async () => {
		const mockResult = { lyrics: 'lyrics text' };
		mockContent.getLyrics = vi.fn().mockResolvedValue(mockResult);

		const result = await client.getLyrics(123);

		expect(mockContent.getLyrics).toHaveBeenCalledWith(123);
		expect(result).toBe(mockResult);
	});

	it('delegates getCover to ContentService', async () => {
		const mockResult = [{ id: 1, name: 'Cover' }];
		mockContent.searchCovers = vi.fn().mockResolvedValue(mockResult);

		const result = await client.getCover('cover-id');

		expect(mockContent.searchCovers).toHaveBeenCalledWith('cover-id', 1);
		expect(result).toBe(mockResult);
	});

	it('delegates getCoverUrl to PlaybackService', () => {
		mockPlayback.getCoverUrl = vi.fn().mockReturnValue('cover-url');

		const result = client.getCoverUrl('cover-id', '640');

		expect(mockPlayback.getCoverUrl).toHaveBeenCalledWith('cover-id', '640');
		expect(result).toBe('cover-url');
	});

	it('delegates getArtistPictureUrl to PlaybackService', () => {
		mockPlayback.getArtistPictureUrl = vi.fn().mockReturnValue('picture-url');

		const result = client.getArtistPictureUrl('picture-id', '750');

		expect(mockPlayback.getArtistPictureUrl).toHaveBeenCalledWith('picture-id', '750');
		expect(result).toBe('picture-url');
	});

	it('delegates formatDuration to PlaybackService', () => {
		mockPlayback.formatDuration = vi.fn().mockReturnValue('1:23');

		const result = client.formatDuration(83);

		expect(mockPlayback.formatDuration).toHaveBeenCalledWith(83);
		expect(result).toBe('1:23');
	});

	it('throws for importFromUrl', async () => {
		await expect(client.importFromUrl('url')).rejects.toThrow('URL import not implemented');
	});

	it('throws for getSong', async () => {
		await expect(client.getSong('query')).rejects.toThrow('Song search not implemented');
	});
});
