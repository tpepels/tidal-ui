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
const MAX_ARTIST_ENRICHMENT_SEEDS = 10;
const MAX_ENRICHED_ALBUMS = 220;
const ARTIST_ENRICHMENT_CONCURRENCY = 3;
const TRACK_SEED_LIMIT = 10;

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

function extractArtistHintsFromAlbumQuery(query: string): string[] {
	const hints = new Set<string>();
	const trimmed = query.trim();
	if (!trimmed) return [];

	const dashMatch = trimmed.match(/^(.+?)\s[-–—]\s(.+)$/);
	if (dashMatch) {
		const leftSide = dashMatch[1]?.trim();
		if (leftSide && leftSide.length > 1) {
			hints.add(leftSide);
		}
	}

	const byMatch = trimmed.match(/^(.+?)\s+by\s+(.+)$/i);
	if (byMatch) {
		const artistSide = byMatch[2]?.trim();
		if (artistSide && artistSide.length > 1) {
			hints.add(artistSide);
		}
	}

	const commaMatch = trimmed.match(/^(.+?),\s*([^,]+)$/);
	if (commaMatch) {
		const rightSide = commaMatch[2]?.trim();
		if (rightSide && rightSide.length > 1) {
			hints.add(rightSide);
		}
	}

	return Array.from(hints);
}

async function runWithConcurrency<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>
): Promise<void> {
	if (items.length === 0) return;
	const queue = [...items];
	const workerCount = Math.max(1, Math.min(concurrency, items.length));
	const runners = Array.from({ length: workerCount }, async () => {
		while (queue.length > 0) {
			const next = queue.shift();
			if (next === undefined) {
				return;
			}
			await worker(next);
		}
	});
	await Promise.all(runners);
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
	if (queryTokens.length === 0) {
		return false;
	}
	const matchedTokenCount = queryTokens.filter((token) => normalizedTitle.includes(token)).length;
	const minimumMatches = Math.max(1, Math.ceil(queryTokens.length * 0.5));
	return matchedTokenCount >= minimumMatches;
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

	const seedArtistsByQuery = async (
		query: string,
		baseScore: number,
		limit = 8
	): Promise<void> => {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) return;
		const normalizedQuery = normalizeToken(trimmedQuery);
		try {
			const artistResponse = await fetchWithRetry(
				() => losslessAPI.searchArtists(trimmedQuery, region),
				2,
				180
			);
			for (const artist of artistResponse.items.slice(0, limit)) {
				const normalizedName = normalizeToken(artist.name ?? '');
				let score = baseScore;
				if (normalizedName === normalizedQuery) score += 130;
				else if (normalizedName.startsWith(normalizedQuery)) score += 100;
				else if (normalizedName.includes(normalizedQuery)) score += 70;
				registerArtist(artist.id, score);
			}
		} catch {
			// Non-fatal: enrichment should never fail the base album search.
		}
	};

	// Preferred path: user-provided artist query.
	if (normalizedArtistQuery.length > 0) {
		await seedArtistsByQuery(artistQuery ?? '', 180, 12);
	}

	// Parse artist hints from combined free-text input such as "artist - album" or "album by artist".
	for (const hint of extractArtistHintsFromAlbumQuery(albumQuery)) {
		if (normalizeToken(hint) === normalizedArtistQuery) continue;
		await seedArtistsByQuery(hint, 120, 6);
	}

	// Fallback path: seed from current album results.
	for (const album of baseAlbums) {
		if (typeof album.artist?.id === 'number') {
			registerArtist(album.artist.id, 140);
		}
		for (const artist of album.artists ?? []) {
			if (typeof artist?.id === 'number') {
				registerArtist(artist.id, 115);
			}
		}
	}

	// Additional seed path: track search often exposes useful artist IDs even when album search is sparse.
	try {
		const trackResponse = await fetchWithRetry(() => losslessAPI.searchTracks(albumQuery, region), 2, 180);
		for (const track of trackResponse.items.slice(0, TRACK_SEED_LIMIT)) {
			if (typeof track.artist?.id === 'number') {
				registerArtist(track.artist.id, 110);
			}
			for (const artist of track.artists ?? []) {
				if (typeof artist?.id === 'number') {
					registerArtist(artist.id, 95);
				}
			}
		}
	} catch {
		// Non-fatal.
	}

	// Last fallback: discover candidate artists from album query text.
	if (candidateArtistScores.size < 3) {
		await seedArtistsByQuery(albumQuery, 90, 10);
	}

	const artistIds = Array.from(candidateArtistScores.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, MAX_ARTIST_ENRICHMENT_SEEDS)
		.map(([artistId]) => artistId);

	if (artistIds.length === 0) {
		return [];
	}

	const enrichedAlbums: Album[] = [];
	let reachedLimit = false;
	await runWithConcurrency(artistIds, ARTIST_ENRICHMENT_CONCURRENCY, async (artistId) => {
		if (reachedLimit) return;
		try {
			// getArtist includes official-discography enrichment when available in browser context.
			const artistDetails = await fetchWithRetry(() => losslessAPI.getArtist(artistId), 2, 220);
			const albums = Array.isArray(artistDetails?.albums) ? artistDetails.albums : [];
			for (const album of albums) {
				if (reachedLimit) break;
				if (!albumTitleMatchesQuery(album, albumQuery)) continue;
				if (!albumMatchesArtistFilter(album, artistQuery ?? '')) continue;
				enrichedAlbums.push(album);
				if (enrichedAlbums.length >= MAX_ENRICHED_ALBUMS) {
					reachedLimit = true;
					break;
				}
			}
		} catch {
			// Non-fatal.
		}
	});

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
