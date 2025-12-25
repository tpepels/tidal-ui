import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchService } from './search.service';
import { fetchWithCORS } from '../config';

// Mock fetchWithCORS
vi.mock('../config', () => ({
	fetchWithCORS: vi.fn()
}));

const mockedFetchWithCORS = vi.mocked(fetchWithCORS);

describe('SearchService', () => {
	let service: SearchService;

	beforeEach(() => {
		service = new SearchService('https://test-api.com');
		vi.clearAllMocks();
	});

	it('searches tracks with well-known data', async () => {
		const mockData = {
			items: [
				{
					id: 123,
					title: 'Test Track',
					artists: [{ name: 'Test Artist' }],
					album: { title: 'Test Album' },
					duration: 240
				}
			],
			totalNumberOfItems: 1
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.searchTracks('test query', 'us', 10, 0);

		expect(mockedFetchWithCORS).toHaveBeenCalledWith(
			'https://test-api.com/search/?s=test%20query&limit=10&offset=0',
			{ apiVersion: 'v2' }
		);
		expect(result).toEqual(mockData);
	});

	it('searches albums with well-known data', async () => {
		const mockData = {
			items: [
				{
					id: 456,
					title: 'Test Album',
					artists: [{ name: 'Test Artist' }],
					releaseDate: '2023-01-01'
				}
			],
			totalNumberOfItems: 1
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.searchAlbums('test album', 'us', 10, 0);

		expect(mockedFetchWithCORS).toHaveBeenCalledWith(
			'https://test-api.com/search/?al=test%20album&limit=10&offset=0',
			{ apiVersion: 'v2' }
		);
		expect(result).toEqual(mockData);
	});

	it('searches artists with well-known data', async () => {
		const mockData = {
			items: [
				{
					id: 789,
					name: 'Test Artist',
					picture: 'test-picture-id'
				}
			],
			totalNumberOfItems: 1
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.searchArtists('test artist', 'us', 10, 0);

		expect(mockedFetchWithCORS).toHaveBeenCalledWith(
			'https://test-api.com/search/?a=test%20artist&limit=10&offset=0',
			{ apiVersion: 'v2' }
		);
		expect(result).toEqual(mockData);
	});

	it('searches playlists with well-known data', async () => {
		const mockData = {
			items: [
				{
					uuid: 'test-uuid',
					title: 'Test Playlist',
					description: 'A test playlist',
					creator: { name: 'Test User' }
				}
			],
			totalNumberOfItems: 1
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.searchPlaylists('test playlist', 'us', 10, 0);

		expect(mockedFetchWithCORS).toHaveBeenCalledWith(
			'https://test-api.com/search/?p=test%20playlist&limit=10&offset=0',
			{ apiVersion: 'v2' }
		);
		expect(result).toEqual(mockData);
	});
});
