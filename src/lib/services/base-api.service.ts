import { API_BASE } from '../constants';
import { TidalError, withErrorHandling, retryWithBackoff } from '../errors';
import { ApiCache } from '../utils/cache';
import { fetchWithCORS } from '../config';

export abstract class BaseApiService {
	protected baseUrl: string;
	protected cache: ApiCache;

	constructor(baseUrl: string = API_BASE) {
		this.baseUrl = baseUrl;
		this.cache = new ApiCache();
	}

	protected async makeRequest<T>(
		endpoint: string,
		options?: RequestInit & { apiVersion?: 'v1' | 'v2' },
		cacheKey?: string,
		cacheTtl?: number
	): Promise<T> {
		const operation = async (): Promise<T> => {
			// Check cache first
			if (cacheKey && cacheTtl) {
				const cached = this.cache.get<T>(cacheKey);
				if (cached !== null) {
					return cached;
				}
			}

			const result = await retryWithBackoff(async (): Promise<T> => {
				const response = await fetchWithCORS(`${this.baseUrl}${endpoint}`, options);
				if (!response.ok) {
					throw TidalError.fromApiResponse({
						status: response.status,
						statusText: response.statusText
					});
				}
				return response.json();
			});

			// Cache the result
			if (cacheKey && cacheTtl) {
				this.cache.set(cacheKey, result, cacheTtl);
			}

			return result;
		};

		return withErrorHandling(operation, `API request to ${endpoint}`);
	}

	protected generateCacheKey(endpoint: string, params?: Record<string, any>): string {
		const sortedParams = params
			? Object.keys(params)
					.sort()
					.map((key) => `${key}:${params[key]}`)
					.join('|')
			: '';
		return `${endpoint}${sortedParams ? `?${sortedParams}` : ''}`;
	}
}

export interface SearchResponse<T> {
	items: T[];
	totalNumberOfItems?: number;
	limit?: number;
	offset?: number;
}

export interface ApiResponse<T> {
	data?: T;
	status?: string;
	message?: string;
}
