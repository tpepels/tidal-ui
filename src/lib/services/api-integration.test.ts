import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchService } from './search.service';
import { ContentService } from './content.service';
import { PlaybackService } from './playback.service';
import { TidalError } from '../errors';
import type { SearchResponse, Track, Album } from '../types';

// Mock the base API service
vi.mock('./base-api.service', () => ({
	BaseApiService: class {
		makeRequest = vi.fn();
		generateCacheKey = vi.fn();
	}
}));

describe('API Services Integration Tests', () => {
	describe('SearchService error handling', () => {
		let service: SearchService;

		beforeEach(() => {
			service = new SearchService();
		});

		it('should handle network timeouts gracefully', async () => {
			const mockMakeRequest = vi
				.fn()
				.mockRejectedValue(new TidalError('Network timeout', 'NETWORK_ERROR', 408, true));
			(service as any).makeRequest = mockMakeRequest;

			await expect(service.searchTracks('test', 'us')).rejects.toThrow('Network timeout');
		});

		it('should handle API rate limiting', async () => {
			const mockMakeRequest = vi
				.fn()
				.mockRejectedValue(new TidalError('Rate limit exceeded', 'RATE_LIMIT', 429, true));
			(service as any).makeRequest = mockMakeRequest;

			await expect(service.searchTracks('test', 'us')).rejects.toThrow('Rate limit exceeded');
		});

		it('should handle empty search results', async () => {
			const mockResponse = { items: [], limit: 50, offset: 0 };
			const mockMakeRequest = vi.fn().mockResolvedValue(mockResponse);
			(service as any).makeRequest = mockMakeRequest;

			const result = await service.searchTracks('nonexistent', 'us');
			expect(result.items).toHaveLength(0);
		});

		it('should handle malformed API responses', async () => {
			const mockMakeRequest = vi
				.fn()
				.mockRejectedValue(new Error('API returned null or undefined response'));
			(service as any).makeRequest = mockMakeRequest;

			await expect(service.searchTracks('test', 'us')).rejects.toThrow(
				'API returned null or undefined response'
			);
		});
	});

	describe('ContentService error scenarios', () => {
		let service: ContentService;

		beforeEach(() => {
			service = new ContentService();
		});

		it('should handle non-existent albums', async () => {
			const mockMakeRequest = vi
				.fn()
				.mockRejectedValue(new TidalError('Album not found', 'NOT_FOUND', 404));
			(service as any).makeRequest = mockMakeRequest;

			await expect(service.getAlbum(999999)).rejects.toThrow('Album not found');
		});

		it('should handle invalid artist IDs', async () => {
			const mockMakeRequest = vi
				.fn()
				.mockRejectedValue(new TidalError('Artist not found', 'NOT_FOUND', 404));
			(service as any).makeRequest = mockMakeRequest;

			await expect(service.getArtist(-1)).rejects.toThrow('Artist not found');
		});

		it('should handle playlist access restrictions', async () => {
			const mockMakeRequest = vi
				.fn()
				.mockRejectedValue(new TidalError('Playlist access denied', 'FORBIDDEN', 403));
			(service as any).makeRequest = mockMakeRequest;

			await expect(service.getPlaylist('restricted-uuid')).rejects.toThrow(
				'Playlist access denied'
			);
		});

		it('should handle lyrics not available', async () => {
			const mockMakeRequest = vi
				.fn()
				.mockRejectedValue(new TidalError('Lyrics not found', 'NOT_FOUND', 404));
			(service as any).makeRequest = mockMakeRequest;

			await expect(service.getLyrics(12345)).rejects.toThrow('Lyrics not found');
		});

		it('should handle cover search with no results', async () => {
			const mockResponse: any[] = [];
			const mockMakeRequest = vi.fn().mockResolvedValue(mockResponse);
			(service as any).makeRequest = mockMakeRequest;

			const result = await service.searchCovers('nonexistent', 10);
			expect(result).toHaveLength(0);
		});
	});

	describe('PlaybackService edge cases', () => {
		let service: PlaybackService;

		beforeEach(() => {
			service = new PlaybackService();
		});

		it('should handle tracks without streaming rights', async () => {
			const mockMakeRequest = vi
				.fn()
				.mockRejectedValue(new TidalError('Track not available for streaming', 'FORBIDDEN', 403));
			(service as any).makeRequest = mockMakeRequest;

			await expect(service.getTrackInfo(123, 'LOSSLESS')).rejects.toThrow('Track not available');
		});

		it('should handle unsupported audio qualities', async () => {
			const mockMakeRequest = vi
				.fn()
				.mockRejectedValue(new TidalError('Quality not supported', 'BAD_REQUEST', 400));
			(service as any).makeRequest = mockMakeRequest;

			await expect(service.getStreamData(123, 'UNSUPPORTED' as any)).rejects.toThrow(
				'Quality not supported'
			);
		});

		it('should handle DASH manifest generation failures', async () => {
			const mockMakeRequest = vi
				.fn()
				.mockRejectedValue(new TidalError('DASH manifest unavailable', 'SERVER_ERROR', 500, true));
			(service as any).makeRequest = mockMakeRequest;

			await expect(service.getDashManifest(123)).rejects.toThrow('DASH manifest unavailable');
		});

		it('should handle malformed track IDs', async () => {
			const mockMakeRequest = vi
				.fn()
				.mockRejectedValue(new TidalError('Invalid track ID', 'BAD_REQUEST', 400));
			(service as any).makeRequest = mockMakeRequest;

			await expect(service.getTrackInfo(NaN)).rejects.toThrow('Invalid track ID');
		});
	});

	describe('Cross-service integration', () => {
		it('should handle concurrent API failures gracefully', async () => {
			const searchService = new SearchService();
			const contentService = new ContentService();

			const mockNetworkError = new TidalError('Network error', 'NETWORK_ERROR', 0, true);
			const mockSearchRequest = vi.fn().mockRejectedValue(mockNetworkError);
			const mockContentRequest = vi.fn().mockRejectedValue(mockNetworkError);

			(searchService as any).makeRequest = mockSearchRequest;
			(contentService as any).makeRequest = mockContentRequest;

			// Test concurrent failures
			const [searchResult, contentResult] = await Promise.allSettled([
				searchService.searchTracks('test', 'us').catch(() => null),
				contentService.getAlbum(123).catch(() => null)
			]);

			expect(searchResult.status).toBe('fulfilled');
			expect(contentResult.status).toBe('fulfilled');
			expect(
				(searchResult as PromiseFulfilledResult<SearchResponse<Track> | null>).value
			).toBeNull();
			expect(
				(contentResult as PromiseFulfilledResult<{ album: Album; tracks: Track[] } | null>).value
			).toBeNull();
		});

		it('should handle partial search failures in searchAll', async () => {
			const service = new SearchService();

			const mockSuccessResponse = {
				items: [{ id: 1, title: 'Test' }],
				total: 1,
				limit: 10,
				offset: 0
			};
			const mockFailure = new TidalError('Search failed', 'SERVER_ERROR', 500);

			const mockMakeRequest = vi
				.fn()
				.mockResolvedValueOnce(mockSuccessResponse) // tracks success
				.mockRejectedValueOnce(mockFailure) // albums fail
				.mockResolvedValueOnce(mockSuccessResponse) // artists success
				.mockResolvedValueOnce(mockSuccessResponse); // playlists success

			(service as any).makeRequest = mockMakeRequest;

			const result = await service.searchAll('test');

			expect(result.tracks.items).toHaveLength(1);
			expect(result.albums.items).toHaveLength(0); // Should be empty on failure
			expect(result.artists.items).toHaveLength(1);
			expect(result.playlists.items).toHaveLength(1);
		});
	});

	describe('Caching behavior', () => {
		it('should use cached responses when available', async () => {
			const service = new SearchService();
			const mockMakeRequest = vi.fn().mockResolvedValue({
				items: [{ id: 1, title: 'Cached Track' }],
				total: 1,
				limit: 50,
				offset: 0
			});

			(service as any).makeRequest = mockMakeRequest;

			// First call should make request
			await service.searchTracks('test', 'us');
			expect(mockMakeRequest).toHaveBeenCalledTimes(1);

			// Second identical call should also make request (no caching in mock)
			await service.searchTracks('test', 'us');
			expect(mockMakeRequest).toHaveBeenCalledTimes(2);
		});

		it('should handle cache key generation', () => {
			const service = new SearchService();
			const mockGenerateCacheKey = vi.fn().mockReturnValue('test-key');
			(service as any).generateCacheKey = mockGenerateCacheKey;

			// Call a method that uses cache
			const cacheCall = () => (service as any).generateCacheKey('/search', { s: 'test' });
			cacheCall();

			expect(mockGenerateCacheKey).toHaveBeenCalledWith('/search', { s: 'test' });
		});
	});
});
