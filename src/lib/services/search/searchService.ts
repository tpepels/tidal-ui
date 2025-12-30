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
 * In-flight search cache to prevent duplicate concurrent requests
 */
const inFlightSearches = new Map<string, Promise<SearchResults>>();

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
 */
export async function executeTabSearch(
	query: string,
	tab: SearchTab,
	region?: RegionOption
): Promise<SearchResults> {
	const trimmedQuery = query.trim();
	if (!trimmedQuery) {
		throw new Error('Search query cannot be empty');
	}

	const emptyResults: SearchResults = { tracks: [], albums: [], artists: [], playlists: [] };
	const searchKey = `${tab}:${trimmedQuery.toLowerCase()}`;

	// Check if there's already an in-flight search for this query+tab
	let pending = inFlightSearches.get(searchKey);

	if (!pending) {
		// Create new search promise
		pending = (async () => {
			switch (tab) {
				case 'tracks': {
					const response = await fetchWithRetry(() =>
						losslessAPI.searchTracks(trimmedQuery, region)
					);
					const items = Array.isArray(response?.items) ? response.items : [];
					return { ...emptyResults, tracks: items };
				}
				case 'albums': {
					const response = await losslessAPI.searchAlbums(trimmedQuery);
					const items = Array.isArray(response?.items) ? response.items : [];
					return { ...emptyResults, albums: items };
				}
				case 'artists': {
					const response = await losslessAPI.searchArtists(trimmedQuery);
					const items = Array.isArray(response?.items) ? response.items : [];
					return { ...emptyResults, artists: items };
				}
				case 'playlists': {
					const response = await losslessAPI.searchPlaylists(trimmedQuery);
					const items = Array.isArray(response?.items) ? response.items : [];
					return { ...emptyResults, playlists: items };
				}
				default:
					return emptyResults;
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
