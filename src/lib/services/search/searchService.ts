/**
 * Search Service
 *
 * Handles search execution, deduplication, retry logic, and result aggregation.
 * Extracted from SearchInterface component to separate search business logic
 * from UI presentation.
 */

import { losslessAPI } from '$lib/api';
import type { Track, Album, Artist, Playlist, SonglinkTrack } from '$lib/types';
export type SearchTab = 'tracks' | 'albums' | 'artists' | 'playlists';
export type RegionOption = 'auto' | 'us' | 'eu';
type SearchExecutionOptions = {
	albumArtistQuery?: string;
};

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
const MAX_ARTIST_ENRICHMENT_SEEDS = 4;
const MAX_ENRICHED_ALBUMS = 120;

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

function normalizeToken(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

function splitTokens(value: string): string[] {
	return normalizeToken(value)
		.split(/[^a-z0-9]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length > 1);
}

function getAlbumArtistNames(album: Album): string[] {
	const names: string[] = [];
	if (typeof album.artist?.name === 'string' && album.artist.name.trim().length > 0) {
		names.push(album.artist.name);
	}
	if (Array.isArray(album.artists)) {
		for (const artist of album.artists) {
			if (typeof artist?.name === 'string' && artist.name.trim().length > 0) {
				names.push(artist.name);
			}
		}
	}
	return Array.from(new Set(names.map((name) => name.trim())));
}

function albumTitleMatchesQuery(album: Album, albumQuery: string): boolean {
	const normalizedTitle = normalizeToken(album.title ?? '');
	if (!normalizedTitle) return false;
	const normalizedQuery = normalizeToken(albumQuery);
	if (!normalizedQuery) return false;
	if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) {
		return true;
	}
	const queryTokens = splitTokens(albumQuery);
	return queryTokens.length > 0 && queryTokens.every((token) => normalizedTitle.includes(token));
}

function albumMatchesArtistFilter(album: Album, artistQuery: string): boolean {
	const normalizedArtistQuery = normalizeToken(artistQuery);
	if (!normalizedArtistQuery) {
		return true;
	}
	return getAlbumArtistNames(album)
		.map((name) => normalizeToken(name))
		.some(
			(name) =>
				name === normalizedArtistQuery ||
				name.includes(normalizedArtistQuery) ||
				normalizedArtistQuery.includes(name)
		);
}

function scoreAlbumResult(album: Album, albumQuery: string, artistQuery?: string): number {
	const normalizedTitle = normalizeToken(album.title ?? '');
	const normalizedQuery = normalizeToken(albumQuery);
	let score = 0;

	if (normalizedTitle === normalizedQuery) score += 220;
	else if (normalizedTitle.startsWith(normalizedQuery)) score += 160;
	else if (normalizedTitle.includes(normalizedQuery)) score += 100;

	const tokens = splitTokens(albumQuery);
	if (tokens.length > 0 && tokens.every((token) => normalizedTitle.includes(token))) {
		score += 60;
	}

	const normalizedArtistQuery = normalizeToken(artistQuery ?? '');
	if (normalizedArtistQuery.length > 0) {
		const artistMatch = getAlbumArtistNames(album)
			.map((name) => normalizeToken(name))
			.some(
				(name) =>
					name === normalizedArtistQuery ||
					name.includes(normalizedArtistQuery) ||
					normalizedArtistQuery.includes(name)
			);
		if (artistMatch) score += 100;
	}

	if (album.discographySource === 'official_tidal') {
		score += 28;
	}
	if (typeof album.popularity === 'number' && Number.isFinite(album.popularity)) {
		score += Math.min(36, Math.max(0, album.popularity / 3));
	}
	return score;
}

function albumDedupeKey(album: Album): string {
	if (typeof album.id === 'number' && Number.isFinite(album.id)) {
		return `id:${album.id}`;
	}
	if (typeof album.upc === 'string' && album.upc.trim().length > 0) {
		return `upc:${album.upc.trim().toLowerCase()}`;
	}
	if (typeof album.url === 'string' && album.url.trim().length > 0) {
		return `url:${album.url.trim().toLowerCase()}`;
	}
	const artistToken = normalizeToken(album.artist?.name ?? '');
	const titleToken = normalizeToken(album.title ?? '');
	const year =
		typeof album.releaseDate === 'string' && album.releaseDate.length >= 4
			? album.releaseDate.slice(0, 4)
			: '';
	return `fallback:${artistToken}|${titleToken}|${year}`;
}

function mergeAlbumResults(
	baseAlbums: Album[],
	enrichedAlbums: Album[],
	albumQuery: string,
	artistQuery?: string
): Album[] {
	const ranked = new Map<string, { album: Album; score: number }>();

	const ingest = (album: Album, sourceBoost: number): void => {
		const key = albumDedupeKey(album);
		const score = scoreAlbumResult(album, albumQuery, artistQuery) + sourceBoost;
		const current = ranked.get(key);
		if (!current || score > current.score) {
			ranked.set(key, { album, score });
		}
	};

	for (const album of baseAlbums) ingest(album, 8);
	for (const album of enrichedAlbums) ingest(album, 0);

	return Array.from(ranked.values())
		.sort((a, b) => b.score - a.score)
		.map((entry) => entry.album);
}

async function fetchEnrichedAlbumsFromTidal(
	albumQuery: string,
	region: RegionOption | undefined,
	artistQuery: string | undefined,
	baseAlbums: Album[]
): Promise<Album[]> {
	const normalizedArtistQuery = normalizeToken(artistQuery ?? '');
	const candidateArtistScores = new Map<number, number>();

	const registerArtist = (artistId: number, score: number): void => {
		if (!Number.isFinite(artistId) || artistId <= 0) return;
		const current = candidateArtistScores.get(artistId) ?? Number.NEGATIVE_INFINITY;
		if (score > current) {
			candidateArtistScores.set(artistId, score);
		}
	};

	// Preferred path: user-provided artist query.
	if (normalizedArtistQuery.length > 0) {
		try {
			const artistResponse = await fetchWithRetry(
				() => losslessAPI.searchArtists(artistQuery!.trim(), region),
				2,
				180
			);
			for (const artist of artistResponse.items.slice(0, 6)) {
				const normalizedName = normalizeToken(artist.name ?? '');
				let score = 0;
				if (normalizedName === normalizedArtistQuery) score = 220;
				else if (normalizedName.startsWith(normalizedArtistQuery)) score = 180;
				else if (normalizedName.includes(normalizedArtistQuery)) score = 130;
				else score = 80;
				registerArtist(artist.id, score);
			}
		} catch {
			// Non-fatal: enrichment should never fail the base album search.
		}
	}

	// Fallback path: seed from current album results.
	if (candidateArtistScores.size === 0) {
		for (const album of baseAlbums) {
			if (typeof album.artist?.id === 'number') {
				registerArtist(album.artist.id, 120);
			}
			for (const artist of album.artists ?? []) {
				if (typeof artist?.id === 'number') {
					registerArtist(artist.id, 90);
				}
			}
		}
	}

	// Last fallback: discover candidate artists from album query text.
	if (candidateArtistScores.size === 0) {
		try {
			const artistResponse = await fetchWithRetry(() => losslessAPI.searchArtists(albumQuery, region), 2, 180);
			for (const artist of artistResponse.items.slice(0, 3)) {
				registerArtist(artist.id, 70);
			}
		} catch {
			// Non-fatal.
		}
	}

	const artistIds = Array.from(candidateArtistScores.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, MAX_ARTIST_ENRICHMENT_SEEDS)
		.map(([artistId]) => artistId);

	if (artistIds.length === 0) {
		return [];
	}

	const enrichedAlbums: Album[] = [];
	for (const artistId of artistIds) {
		try {
			const artistDetails = await fetchWithRetry(() => losslessAPI.getArtist(artistId), 2, 220);
			const albums = Array.isArray(artistDetails?.albums) ? artistDetails.albums : [];
			for (const album of albums) {
				if (!albumTitleMatchesQuery(album, albumQuery)) continue;
				if (!albumMatchesArtistFilter(album, artistQuery ?? '')) continue;
				enrichedAlbums.push(album);
				if (enrichedAlbums.length >= MAX_ENRICHED_ALBUMS) {
					return enrichedAlbums;
				}
			}
		} catch {
			// Non-fatal.
		}
	}

	return enrichedAlbums;
}

/**
 * Execute a search for a specific tab
 * Includes request deduplication and automatic retry
 * Returns a structured result with type-safe error handling
 */
export async function executeTabSearch(
	query: string,
	tab: SearchTab,
	region?: RegionOption,
	options?: SearchExecutionOptions
): Promise<SearchResult> {
	const trimmedQuery = query.trim();
	if (!trimmedQuery) {
		return {
			success: false,
			error: { code: 'INVALID_QUERY', retry: false, message: 'Search query cannot be empty' }
		};
	}

	const emptyResults: SearchResults = { tracks: [], albums: [], artists: [], playlists: [] };
	const albumArtistQuery = options?.albumArtistQuery?.trim() ?? '';
	// Include region in cache key to prevent result mismatches across regions
	const searchKey = `${tab}:${trimmedQuery.toLowerCase()}:${region || 'auto'}:${tab === 'albums' ? albumArtistQuery.toLowerCase() : ''}`;

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
						const response = await losslessAPI.searchAlbums(
							trimmedQuery,
							region,
							albumArtistQuery || undefined
						);
						const baseItems = Array.isArray(response?.items) ? response.items : [];
						const enrichedItems = await fetchEnrichedAlbumsFromTidal(
							trimmedQuery,
							region,
							albumArtistQuery || undefined,
							baseItems
						);
						const items =
							enrichedItems.length > 0
								? mergeAlbumResults(
										baseItems,
										enrichedItems,
										trimmedQuery,
										albumArtistQuery || undefined
									)
								: baseItems;
						results = { ...emptyResults, albums: items };
						break;
					}
					case 'artists': {
						const response = await losslessAPI.searchArtists(trimmedQuery, region);
						const items = Array.isArray(response?.items) ? response.items : [];
						results = { ...emptyResults, artists: items };
						break;
					}
					case 'playlists': {
						const response = await losslessAPI.searchPlaylists(trimmedQuery, region);
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
