import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentService } from './content.service';
import { fetchWithCORS } from '../config';

// Mock fetchWithCORS
vi.mock('../config', () => ({
	fetchWithCORS: vi.fn()
}));

const mockedFetchWithCORS = vi.mocked(fetchWithCORS);

describe('ContentService', () => {
	let service: ContentService;

	beforeEach(() => {
		service = new ContentService('https://test-api.com');
		vi.clearAllMocks();
	});

	it('gets album with well-known data', async () => {
		const mockData = {
			album: {
				id: 123,
				title: 'Test Album',
				artists: [{ name: 'Test Artist' }],
				releaseDate: '2023-01-01',
				cover: 'test-cover-id'
			},
			tracks: [
				{
					id: 456,
					title: 'Test Track',
					duration: 240,
					artists: [{ name: 'Test Artist' }]
				}
			]
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.getAlbum(123);

		expect(mockedFetchWithCORS).toHaveBeenCalledWith('https://test-api.com/albums/123', {
			apiVersion: 'v2'
		});
		expect(result).toEqual(mockData);
	});

	it('gets artist with well-known data', async () => {
		const mockData = {
			id: 789,
			name: 'Test Artist',
			picture: 'test-picture-id',
			albums: [],
			topTracks: []
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.getArtist(789);

		expect(mockedFetchWithCORS).toHaveBeenCalledWith('https://test-api.com/artists/789', {
			apiVersion: 'v2'
		});
		expect(result).toEqual(mockData);
	});

	it('gets playlist with well-known data', async () => {
		const mockData = {
			playlist: {
				uuid: 'test-uuid',
				title: 'Test Playlist',
				description: 'A test playlist',
				creator: { name: 'Test User' }
			},
			items: [{ item: { id: 101, title: 'Track 1' } }, { item: { id: 102, title: 'Track 2' } }]
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.getPlaylist('test-uuid');

		expect(mockedFetchWithCORS).toHaveBeenCalledWith('https://test-api.com/playlists/test-uuid', {
			apiVersion: 'v2'
		});
		expect(result).toEqual(mockData);
	});

	it('gets lyrics with well-known data', async () => {
		const mockData = {
			trackId: 123,
			lyrics: 'Test lyrics content',
			synced: false
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.getLyrics(123);

		expect(mockedFetchWithCORS).toHaveBeenCalledWith('https://test-api.com/tracks/123/lyrics', {
			apiVersion: 'v2'
		});
		expect(result).toEqual(mockData);
	});

	it('gets playlist with well-known data', async () => {
		const mockData = {
			playlist: {
				uuid: 'test-uuid',
				title: 'Test Playlist',
				description: 'A test playlist',
				creator: { name: 'Test User' }
			},
			items: [{ item: { id: 101, title: 'Track 1' } }, { item: { id: 102, title: 'Track 2' } }]
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.getPlaylist('test-uuid');

		expect(mockedFetchWithCORS).toHaveBeenCalledWith('https://test-api.com/playlists/test-uuid', {
			apiVersion: 'v2'
		});
		expect(result).toEqual(mockData);
	});

	it('gets lyrics with well-known data', async () => {
		const mockData = {
			trackId: 123,
			lyrics: 'Test lyrics content',
			synced: false
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.getLyrics(123);

		expect(mockedFetchWithCORS).toHaveBeenCalledWith('https://test-api.com/tracks/123/lyrics', {
			apiVersion: 'v2'
		});
		expect(result).toEqual(mockData);
	});

	it('searches covers with query', async () => {
		const mockData = [
			{ id: 1, name: 'Cover 1', '640': 'url1' },
			{ id: 2, name: 'Cover 2', '640': 'url2' }
		];
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.searchCovers('test query', 10);

		expect(mockedFetchWithCORS).toHaveBeenCalledWith(
			'https://test-api.com/covers?query=test%20query&limit=10',
			{ apiVersion: 'v2' }
		);
		expect(result).toEqual(mockData);
	});

	it('searches covers without query', async () => {
		const mockData = [{ id: 1, name: 'Cover 1' }];
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.searchCovers(undefined, 5);

		expect(mockedFetchWithCORS).toHaveBeenCalledWith('https://test-api.com/covers?limit=5', {
			apiVersion: 'v2'
		});
		expect(result).toEqual(mockData);
	});

	it('handles API errors for album', async () => {
		mockedFetchWithCORS.mockResolvedValue(new Response('Not found', { status: 404 }));

		await expect(service.getAlbum(999)).rejects.toThrow();
	});

	it('handles API errors for artist', async () => {
		mockedFetchWithCORS.mockResolvedValue(new Response('Not found', { status: 404 }));

		await expect(service.getArtist(999)).rejects.toThrow();
	});

	it('handles empty search results', async () => {
		const mockData: any[] = [];
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.searchCovers('nonexistent', 10);

		expect(result).toEqual([]);
	});
});
