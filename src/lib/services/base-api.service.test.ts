import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { BaseApiService } from './base-api.service';
import { fetchWithCORS } from '../config';
import { ApiCache } from '../utils/cache';

// Mock dependencies
vi.mock('../config', () => ({
	fetchWithCORS: vi.fn()
}));
vi.mock('../utils/cache');
vi.mock('../errors', () => ({
	withErrorHandling: vi.fn((fn) => fn()),
	retryWithBackoff: vi.fn((fn) => fn()),
	TidalError: { fromApiResponse: vi.fn() }
}));

const mockedFetchWithCORS = vi.mocked(fetchWithCORS);
const MockedApiCache = ApiCache as any;

// Concrete subclass for testing
class TestApiService extends BaseApiService {
	public testMakeRequest(endpoint: string, options?: any, cacheKey?: string, cacheTtl?: number) {
		// eslint-disable-line @typescript-eslint/no-explicit-any
		return this.makeRequest(endpoint, options, cacheKey, cacheTtl);
	}

	public testGenerateCacheKey(endpoint: string, params?: any) {
		// eslint-disable-line @typescript-eslint/no-explicit-any
		return this.generateCacheKey(endpoint, params);
	}
}

describe('BaseApiService', () => {
	let service: TestApiService;
	let mockCache: Record<string, Mock>;

	beforeEach(() => {
		vi.clearAllMocks();

		mockCache = {
			get: vi.fn(),
			set: vi.fn()
		};
		MockedApiCache.mockImplementation(() => mockCache as any); // eslint-disable-line @typescript-eslint/no-explicit-any

		service = new TestApiService('https://test-api.com');
	});

	it('makes request without cache', async () => {
		const mockData = { test: 'data' };
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.testMakeRequest('/test');

		expect(mockedFetchWithCORS).toHaveBeenCalledWith('https://test-api.com/test', undefined);
		expect(result).toEqual(mockData);
	});

	it('makes request with cache hit', async () => {
		const mockData = { cached: 'data' };
		mockCache.get.mockReturnValue(mockData);

		const result = await service.testMakeRequest('/test', undefined, 'cache-key', 1000);

		expect(mockCache.get).toHaveBeenCalledWith('cache-key');
		expect(mockCache.set).not.toHaveBeenCalled();
		expect(mockedFetchWithCORS).not.toHaveBeenCalled();
		expect(result).toEqual(mockData);
	});

	it('makes request with cache miss and sets cache', async () => {
		const mockData = { fresh: 'data' };
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockCache.get.mockReturnValue(null);
		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.testMakeRequest('/test', undefined, 'cache-key', 1000);

		expect(mockCache.get).toHaveBeenCalledWith('cache-key');
		expect(mockCache.set).toHaveBeenCalledWith('cache-key', mockData, 1000);
		expect(mockedFetchWithCORS).toHaveBeenCalledWith('https://test-api.com/test', undefined);
		expect(result).toEqual(mockData);
	});

	it('generates cache key without params', () => {
		const result = service.testGenerateCacheKey('/api/test');
		expect(result).toBe('/api/test');
	});

	it('generates cache key with params', () => {
		const params = { query: 'test', limit: 10 };
		const result = service.testGenerateCacheKey('/api/search', params);
		expect(result).toBe('/api/search?limit:10|query:test');
	});

	it('generates cache key with empty params', () => {
		const result = service.testGenerateCacheKey('/api/test', {});
		expect(result).toBe('/api/test');
	});
});
