import { ApiCache } from '../utils/cache';
import { TidalError, withErrorHandling, retryWithBackoff } from '../errors';
import { fetchWithCORS, selectApiTargetForRegion } from '../config';
import { validateApiResponse } from '../utils/api-contracts';
import type { ZodSchema } from 'zod';
import type { RegionOption } from '../stores/region';

const API_BASE = 'https://tidal.401658.xyz';

export abstract class BaseApiService {
	protected baseUrl: string;
	protected cache: ApiCache;

	constructor(baseUrl: string = API_BASE) {
		this.baseUrl = baseUrl;
		this.cache = new ApiCache();
	}

	protected resolveRegionalBase(region: RegionOption = 'auto'): string {
		try {
			const target = selectApiTargetForRegion(region);
			if (target?.baseUrl) {
				return target.baseUrl;
			}
		} catch (error) {
			console.warn('Falling back to default API base URL for region selection', { region, error });
		}
		return this.baseUrl;
	}

	protected buildRegionalUrl(path: string, region: RegionOption = 'auto'): string {
		const base = this.resolveRegionalBase(region).replace(/\/+$/, '');
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;
		return `${base}${normalizedPath}`;
	}

	protected async makeRequest<T>(
		endpoint: string,
		options?: RequestInit & {
			apiVersion?: 'v1' | 'v2';
			preferredQuality?: string;
			responseSchema?: ZodSchema;
		},
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
				const fullUrl = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
				const response = await fetchWithCORS(fullUrl, options);
				if (!response.ok) {
					throw TidalError.fromApiResponse({
						status: response.status,
						statusText: response.statusText
					});
				}
				const data = await response.json();

				// Validate response is not null/undefined
				if (data == null) {
					throw new Error('API returned null or undefined response');
				}

				return data;
			});

			// Validate response against schema if provided
			if (options?.responseSchema) {
				validateApiResponse(result, options.responseSchema, endpoint);
			}

			// Cache the result
			if (cacheKey && cacheTtl) {
				this.cache.set(cacheKey, result, cacheTtl);
			}

			return result;
		};

		return withErrorHandling(operation, `API request to ${endpoint}`);
	}

	protected generateCacheKey(endpoint: string, params?: Record<string, unknown>): string {
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
	limit: number;
	offset: number;
	totalNumberOfItems: number;
}
