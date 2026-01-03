/**
 * Search Service
 *
 * Handles search execution, deduplication, retry logic, and result aggregation.
 * Extracted from SearchInterface component to separate search business logic
 * from UI presentation.
 */

import { losslessAPI } from '$lib/api';
import type { Track, Album, Artist, Playlist, SonglinkTrack } from '$lib/types';
import type { SearchTab } from '$lib/stores/searchStoreAdapter';
import type { RegionOption } from '$lib/stores/region';

export type { SearchTab };

export interface SearchResults {
	tracks: (Track | SonglinkTrack)[];
	albums: Album[];
	artists: Artist[];
	playlists: Playlist[];
}

/**
 * Structured error types for search operations
 */
export type SearchError =
	| { code: 'NETWORK_ERROR'; retry: true; message: string; originalError?: unknown }
	| { code: 'INVALID_QUERY'; retry: false; message: string }
	| { code: 'API_ERROR'; retry: true; message: string; statusCode?: number }
	| { code: 'TIMEOUT'; retry: true; message: string }
	| { code: 'UNKNOWN_ERROR'; retry: false; message: string; originalError?: unknown };

export type SearchResult =
	| { success: true; results: SearchResults }
	| { success: false; error: SearchError };

/**
 * In-flight search cache to prevent duplicate concurrent requests
 */
const inFlightSearches = new Map<string, Promise<SearchResult>>();

/**
 * Classifies an error into a structured SearchError type
 */
function classifySearchError(error: unknown): SearchError {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();

		// Network-related errors
		if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
			return { code: 'NETWORK_ERROR', retry: true, message: error.message, originalError: error };
		}

		// Timeout errors
		if (message.includes('timeout') || message.includes('timed out')) {
			return { code: 'TIMEOUT', retry: true, message: error.message };
		}

		// API errors with status codes (500+ are retryable, others are not)
		if ('status' in error && typeof error.status === 'number') {
			if (error.status >= 500) {
				return {
					code: 'API_ERROR',
					retry: true,
					message: error.message,
					statusCode: error.status
				};
			}
			// Client errors (4xx) are not retryable - treat as unknown
			return { code: 'UNKNOWN_ERROR', retry: false, message: error.message, originalError: error };
		}

		// Unknown errors
		return { code: 'UNKNOWN_ERROR', retry: false, message: error.message, originalError: error };
	}

	return {
		code: 'UNKNOWN_ERROR',
		retry: false,
		message: typeof error === 'string' ? error : 'An unknown error occurred',
		originalError: error
	};
}

/**
 * Retry a function with exponential backoff
 */
async function fetchWithRetry<T>(
	action: () => Promise<T>,
	attempts = 3,
	delayMs = 250
): Promise<T> {
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await action();
		} catch (err) {
			lastError = err;
			if (attempt < attempts) {
				await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
			}
		}
	}
	throw lastError instanceof Error ? lastError : new Error('Request failed');
}

/**
 * Execute a search for a specific tab
 * Includes request deduplication and automatic retry
 * Returns a structured result with type-safe error handling
 */
export async function executeTabSearch(
	query: string,
	tab: SearchTab,
	region?: RegionOption
): Promise<SearchResult> {
	const trimmedQuery = query.trim();
	if (!trimmedQuery) {
		return {
			success: false,
			error: { code: 'INVALID_QUERY', retry: false, message: 'Search query cannot be empty' }
		};
	}

	const emptyResults: SearchResults = { tracks: [], albums: [], artists: [], playlists: [] };
	// Include region in cache key to prevent result mismatches across regions
	const searchKey = `${tab}:${trimmedQuery.toLowerCase()}:${region || 'auto'}`;

	// Check if there's already an in-flight search for this query+tab+region
	let pending = inFlightSearches.get(searchKey);

	if (!pending) {
		// Create new search promise
		pending = (async (): Promise<SearchResult> => {
			try {
				let results: SearchResults;
				switch (tab) {
					case 'tracks': {
						const response = await fetchWithRetry(() =>
							losslessAPI.searchTracks(trimmedQuery, region)
						);
						const items = Array.isArray(response?.items) ? response.items : [];
						results = { ...emptyResults, tracks: items };
						break;
					}
					case 'albums': {
						const response = await losslessAPI.searchAlbums(trimmedQuery);
						const items = Array.isArray(response?.items) ? response.items : [];
						results = { ...emptyResults, albums: items };
						break;
					}
					case 'artists': {
						const response = await losslessAPI.searchArtists(trimmedQuery);
						const items = Array.isArray(response?.items) ? response.items : [];
						results = { ...emptyResults, artists: items };
						break;
					}
					case 'playlists': {
						const response = await losslessAPI.searchPlaylists(trimmedQuery);
						const items = Array.isArray(response?.items) ? response.items : [];
						results = { ...emptyResults, playlists: items };
						break;
					}
					default:
						results = emptyResults;
				}
				return { success: true, results };
			} catch (error) {
				return { success: false, error: classifySearchError(error) };
			}
		})();

		inFlightSearches.set(searchKey, pending);
	}

	// Wait for the search to complete
	try {
		return await pending;
	} finally {
		// Clean up the in-flight cache
		if (inFlightSearches.get(searchKey) === pending) {
			inFlightSearches.delete(searchKey);
		}
	}
}

/**
 * Clears the in-flight search cache
 * Useful for testing or forcing fresh searches
 */
export function clearSearchCache(): void {
	inFlightSearches.clear();
}
