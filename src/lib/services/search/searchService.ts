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
export type SearchProgressUpdate = {
	tab: 'albums';
	phase: 'base' | 'enriched';
	items: Album[];
	processedArtists?: number;
	totalArtists?: number;
};
type SearchExecutionOptions = {
	albumArtistQuery?: string;
	strictAlbumArtistMatch?: boolean;
	onProgress?: (update: SearchProgressUpdate) => void;
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
const completedSearchCache = new Map<string, { expiresAt: number; result: SearchResult }>();
const SEARCH_RESULT_CACHE_TTL_MS = 45_000;
const BASE_MAX_ARTIST_ENRICHMENT_SEEDS = 10;
const BASE_MAX_ENRICHED_ALBUMS = 160;
const BASE_ARTIST_ENRICHMENT_CONCURRENCY = 2;
const BASE_ENRICHMENT_SEED_QUERY_CONCURRENCY = 2;
const BASE_ENRICHMENT_TIME_BUDGET_MS = 4_500;
const BASE_TRACK_SEED_LIMIT = 8;
const BASE_ALBUM_QUERY_ATTEMPTS = 4;
const BASE_ALBUM_ATTEMPT_BATCH_SIZE = 2;
const BASE_EARLY_RETURN_MATCH_COUNT = 8;

type EnrichmentPlan = {
	maxArtistSeeds: number;
	maxEnrichedAlbums: number;
	artistConcurrency: number;
	seedQueryConcurrency: number;
	timeBudgetMs: number;
	trackSeedLimit: number;
};

function computeEnrichmentPlan(baseAlbumCount: number, hasArtistFilter: boolean): EnrichmentPlan {
	const sparseBase = baseAlbumCount < 4;
	const emptyBase = baseAlbumCount === 0;

	const maxArtistSeeds = Math.min(
		22,
		BASE_MAX_ARTIST_ENRICHMENT_SEEDS +
			(hasArtistFilter ? 4 : 0) +
			(sparseBase ? 4 : 0) +
			(emptyBase ? 3 : 0)
	);

	const maxEnrichedAlbums = Math.min(
		420,
		BASE_MAX_ENRICHED_ALBUMS +
			(hasArtistFilter ? 90 : 0) +
			(sparseBase ? 120 : 0) +
			(emptyBase ? 70 : 0)
	);

	const artistConcurrency = Math.min(
		4,
		BASE_ARTIST_ENRICHMENT_CONCURRENCY + (sparseBase ? 1 : 0) + (hasArtistFilter ? 1 : 0)
	);

	const seedQueryConcurrency = Math.min(
		4,
		BASE_ENRICHMENT_SEED_QUERY_CONCURRENCY + (sparseBase ? 1 : 0)
	);

	const timeBudgetMs = Math.min(
		11_500,
		BASE_ENRICHMENT_TIME_BUDGET_MS +
			(hasArtistFilter ? 2_000 : 0) +
			(sparseBase ? 2_500 : 0) +
			(emptyBase ? 2_000 : 0)
	);

	const trackSeedLimit = Math.min(
		18,
		BASE_TRACK_SEED_LIMIT + (sparseBase ? 4 : 0) + (hasArtistFilter ? 2 : 0)
	);

	return {
		maxArtistSeeds,
		maxEnrichedAlbums,
		artistConcurrency,
		seedQueryConcurrency,
		timeBudgetMs,
		trackSeedLimit
	};
}

function cloneSearchResults(results: SearchResults): SearchResults {
	return {
		tracks: [...results.tracks],
		albums: [...results.albums],
		artists: [...results.artists],
		playlists: [...results.playlists]
	};
}

function cloneSearchResult(result: SearchResult): SearchResult {
	if (!result.success) {
		return { ...result };
	}
	return {
		success: true,
		results: cloneSearchResults(result.results)
	};
}

function getCachedSearchResult(searchKey: string): SearchResult | null {
	const cached = completedSearchCache.get(searchKey);
	if (!cached) {
		return null;
	}
	if (cached.expiresAt < Date.now()) {
		completedSearchCache.delete(searchKey);
		return null;
	}
	return cloneSearchResult(cached.result);
}

function setCachedSearchResult(searchKey: string, result: SearchResult): void {
	completedSearchCache.set(searchKey, {
		expiresAt: Date.now() + SEARCH_RESULT_CACHE_TTL_MS,
		result: cloneSearchResult(result)
	});
}

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

function hasWildcardPattern(value: string): boolean {
	return /[*?]/.test(value);
}

function stripWildcardOperators(value: string): string {
	return value
		.replace(/[*?]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function buildWildcardRegex(pattern: string): RegExp | null {
	const normalizedPattern = normalizeToken(pattern).replace(/\s+/g, ' ').trim();
	if (!normalizedPattern || !hasWildcardPattern(normalizedPattern)) {
		return null;
	}
	const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	const wildcardPattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
	return new RegExp(`^${wildcardPattern}$`);
}

function queryMatchesArtistName(normalizedName: string, artistQuery: string, strict = false): boolean {
	const cleanedQuery = stripWildcardOperators(artistQuery);
	const normalizedQuery = normalizeToken(cleanedQuery);
	if (!normalizedQuery && !hasWildcardPattern(artistQuery)) {
		return true;
	}

	const wildcardRegex = buildWildcardRegex(artistQuery);

	if (strict) {
		if (wildcardRegex) {
			return wildcardRegex.test(normalizedName);
		}
		return normalizedName === normalizedQuery;
	}

	if (wildcardRegex && wildcardRegex.test(normalizedName)) {
		return true;
	}

	if (
		normalizedQuery &&
		(normalizedName === normalizedQuery ||
			normalizedName.includes(normalizedQuery) ||
			normalizedQuery.includes(normalizedName))
	) {
		return true;
	}

	const queryTokens = splitTokens(cleanedQuery);
	if (queryTokens.length === 0) {
		return false;
	}
	const matchedTokenCount = queryTokens.filter((token) => normalizedName.includes(token)).length;
	const minimumMatches = Math.max(1, Math.ceil(queryTokens.length * 0.5));
	return matchedTokenCount >= minimumMatches;
}

function buildArtistSeedQueries(artistQuery: string): string[] {
	const cleaned = stripWildcardOperators(artistQuery);
	if (!cleaned) {
		return [];
	}

	const variants = new Set<string>();
	const addVariant = (candidate: string): void => {
		const trimmed = candidate.trim().replace(/\s+/g, ' ');
		if (trimmed.length > 1) {
			variants.add(trimmed);
		}
	};

	addVariant(cleaned);
	const tokens = cleaned
		.split(/[^A-Za-z0-9]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length > 1);
	for (const token of tokens) {
		addVariant(token);
	}
	if (tokens.length >= 2) {
		addVariant(`${tokens[0]} ${tokens[tokens.length - 1]}`);
	}

	return Array.from(variants).slice(0, 6);
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

function expandAlbumQueryVariants(query: string): string[] {
	const variants = new Set<string>();
	const addVariant = (candidate: string): void => {
		const trimmed = candidate.trim().replace(/\s+/g, ' ');
		if (trimmed.length > 1) {
			variants.add(trimmed);
		}
	};

	addVariant(query);

	const withoutParentheses = query.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
	addVariant(withoutParentheses);

	const withoutEditionTerms = withoutParentheses.replace(
		/\b(deluxe|remaster(?:ed)?|anniversary|expanded|edition|version|clean|explicit|bonus|collector'?s?)\b/gi,
		' '
	);
	addVariant(withoutEditionTerms);

	const beforeColon = query.split(':')[0] ?? '';
	addVariant(beforeColon);

	const withoutPunctuation = query.replace(/[^\p{L}\p{N}\s]/gu, ' ');
	addVariant(withoutPunctuation);

	return Array.from(variants);
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

function computeTokenCoverageRatio(normalizedTarget: string, queryTokens: string[]): number {
	if (queryTokens.length === 0 || !normalizedTarget) return 0;
	const matchedTokenCount = queryTokens.filter((token) => normalizedTarget.includes(token)).length;
	return matchedTokenCount / queryTokens.length;
}

function queryTokensAppearInOrder(normalizedTarget: string, queryTokens: string[]): boolean {
	if (queryTokens.length === 0 || !normalizedTarget) return false;
	let cursor = 0;
	for (const token of queryTokens) {
		const index = normalizedTarget.indexOf(token, cursor);
		if (index < 0) {
			return false;
		}
		cursor = index + token.length;
	}
	return true;
}

function computeDiceCoefficient(left: string, right: string): number {
	const normalizedLeft = left.replace(/\s+/g, '');
	const normalizedRight = right.replace(/\s+/g, '');
	if (!normalizedLeft || !normalizedRight) {
		return 0;
	}
	if (normalizedLeft === normalizedRight) {
		return 1;
	}
	if (normalizedLeft.length < 2 || normalizedRight.length < 2) {
		return 0;
	}

	const leftBigrams = new Map<string, number>();
	for (let index = 0; index < normalizedLeft.length - 1; index += 1) {
		const bigram = normalizedLeft.slice(index, index + 2);
		leftBigrams.set(bigram, (leftBigrams.get(bigram) ?? 0) + 1);
	}

	let intersection = 0;
	for (let index = 0; index < normalizedRight.length - 1; index += 1) {
		const bigram = normalizedRight.slice(index, index + 2);
		const available = leftBigrams.get(bigram) ?? 0;
		if (available > 0) {
			intersection += 1;
			leftBigrams.set(bigram, available - 1);
		}
	}

	const totalBigrams = normalizedLeft.length + normalizedRight.length - 2;
	return totalBigrams > 0 ? (2 * intersection) / totalBigrams : 0;
}

function scoreTextRelevance(primaryText: string, query: string): number {
	const normalizedPrimary = normalizeToken(primaryText);
	const normalizedQuery = normalizeToken(query);
	if (!normalizedPrimary || !normalizedQuery) {
		return 0;
	}

	let score = 0;
	if (normalizedPrimary === normalizedQuery) {
		score += 420;
	} else if (normalizedPrimary.startsWith(normalizedQuery)) {
		score += 260;
	} else if (normalizedPrimary.includes(normalizedQuery)) {
		score += 180;
	} else if (normalizedQuery.includes(normalizedPrimary)) {
		score += 120;
	}

	const queryTokens = splitTokens(query);
	const tokenCoverage = computeTokenCoverageRatio(normalizedPrimary, queryTokens);
	score += Math.round(tokenCoverage * 150);
	if (tokenCoverage === 1 && queryTokens.length > 0) {
		score += 56;
	}
	if (queryTokensAppearInOrder(normalizedPrimary, queryTokens)) {
		score += 22;
	}

	const dice = computeDiceCoefficient(normalizedPrimary, normalizedQuery);
	score += Math.round(dice * 90);

	const lengthPenalty = Math.min(36, Math.abs(normalizedPrimary.length - normalizedQuery.length));
	return score - lengthPenalty;
}

function rankItemsByScore<T>(items: T[], scorer: (item: T) => number): T[] {
	return items
		.map((item, index) => ({ item, index, score: scorer(item) }))
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((entry) => entry.item);
}

function getTrackArtistNames(track: Track | SonglinkTrack): string[] {
	const names: string[] = [];
	if ('artistName' in track && typeof track.artistName === 'string' && track.artistName.trim().length > 0) {
		names.push(track.artistName);
	}
	if ('artist' in track && typeof track.artist?.name === 'string' && track.artist.name.trim().length > 0) {
		names.push(track.artist.name);
	}
	if ('artists' in track && Array.isArray(track.artists)) {
		for (const artist of track.artists) {
			if (typeof artist?.name === 'string' && artist.name.trim().length > 0) {
				names.push(artist.name);
			}
		}
	}
	return Array.from(new Set(names.map((name) => name.trim())));
}

function scoreTrackResult(track: Track | SonglinkTrack, query: string): number {
	const title = track.title ?? '';
	const artistNames = getTrackArtistNames(track).join(' ');
	let score = 0;
	score += scoreTextRelevance(title, query) * 1.35;
	score += scoreTextRelevance(`${artistNames} ${title}`.trim(), query) * 0.6;
	score += scoreTextRelevance(artistNames, query) * 0.35;
	if ('popularity' in track && typeof track.popularity === 'number' && Number.isFinite(track.popularity)) {
		score += Math.min(28, Math.max(0, track.popularity / 4));
	}
	return score;
}

function scoreArtistResult(artist: Artist, query: string): number {
	let score = scoreTextRelevance(artist.name ?? '', query) * 1.6;
	if (typeof artist.popularity === 'number' && Number.isFinite(artist.popularity)) {
		score += Math.min(34, Math.max(0, artist.popularity / 3));
	}
	return score;
}

function scorePlaylistResult(playlist: Playlist, query: string): number {
	const creatorName = playlist.creator?.name ?? '';
	let score = 0;
	score += scoreTextRelevance(playlist.title ?? '', query) * 1.45;
	score += scoreTextRelevance(`${playlist.title ?? ''} ${creatorName}`.trim(), query) * 0.4;
	score += scoreTextRelevance(playlist.description ?? '', query) * 0.22;
	if (typeof playlist.popularity === 'number' && Number.isFinite(playlist.popularity)) {
		score += Math.min(26, Math.max(0, playlist.popularity / 4));
	}
	return score;
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

function albumMatchesArtistFilter(album: Album, artistQuery: string, strict = false): boolean {
	const cleanedQuery = stripWildcardOperators(artistQuery);
	const hasWildcard = hasWildcardPattern(artistQuery);
	const normalizedArtistQuery = normalizeToken(cleanedQuery);
	if (!normalizedArtistQuery && !hasWildcard) {
		return true;
	}
	return getAlbumArtistNames(album)
		.map((name) => normalizeToken(name))
		.some((name) => queryMatchesArtistName(name, artistQuery, strict));
}

function scoreAlbumResult(album: Album, albumQuery: string, artistQuery?: string): number {
	let score = scoreTextRelevance(album.title ?? '', albumQuery) * 1.32;
	score += scoreTextRelevance(
		`${getAlbumArtistNames(album).join(' ')} ${album.title ?? ''}`.trim(),
		albumQuery
	) * 0.22;

	const rawArtistQuery = artistQuery ?? '';
	const cleanedArtistQuery = stripWildcardOperators(rawArtistQuery);
	const normalizedArtistQuery = normalizeToken(cleanedArtistQuery);
	if (normalizedArtistQuery.length > 0 || hasWildcardPattern(rawArtistQuery)) {
		const artistMatch = albumMatchesArtistFilter(album, rawArtistQuery, false);
		if (artistMatch) score += 180;
		score +=
			Math.max(
				0,
				...getAlbumArtistNames(album).map((name) => scoreTextRelevance(name, cleanedArtistQuery))
			) * 0.35;
		if (normalizedArtistQuery.length > 0) {
			const exactArtistMatch = getAlbumArtistNames(album)
				.map((name) => normalizeToken(name))
				.some((name) => name === normalizedArtistQuery);
			if (exactArtistMatch) score += 36;
		}
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

function dedupeAlbumList(albums: Album[]): Album[] {
	const deduped = new Map<string, Album>();
	for (const album of albums) {
		const key = albumDedupeKey(album);
		if (!deduped.has(key)) {
			deduped.set(key, album);
		}
	}
	return Array.from(deduped.values());
}

function buildAlbumQueryAttempts(albumQuery: string, artistQuery?: string): Array<{
	query: string;
	artistQuery?: string;
}> {
	const attempts: Array<{ query: string; artistQuery?: string }> = [];
	const normalizedArtistQuery = stripWildcardOperators(artistQuery ?? '');
	const pushAttempt = (query: string, optionalArtistQuery?: string): void => {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) return;
		const trimmedArtist = optionalArtistQuery?.trim();
		const key = `${trimmedQuery.toLowerCase()}::${(trimmedArtist ?? '').toLowerCase()}`;
		if (attempts.some((attempt) => `${attempt.query.toLowerCase()}::${(attempt.artistQuery ?? '').toLowerCase()}` === key)) {
			return;
		}
		attempts.push({
			query: trimmedQuery,
			artistQuery: trimmedArtist && trimmedArtist.length > 0 ? trimmedArtist : undefined
		});
	};

	for (const variant of expandAlbumQueryVariants(albumQuery)) {
		pushAttempt(variant, normalizedArtistQuery || undefined);
	}

	if (normalizedArtistQuery.length > 0) {
		for (const variant of expandAlbumQueryVariants(albumQuery)) {
			pushAttempt(variant);
			pushAttempt(`${normalizedArtistQuery} ${variant}`);
			pushAttempt(`${variant} ${normalizedArtistQuery}`);
		}
	}

	return attempts.slice(0, BASE_ALBUM_QUERY_ATTEMPTS);
}

async function fetchBaseAlbumsFromApi(
	albumQuery: string,
	region: RegionOption | undefined,
	artistQuery?: string,
	strictAlbumArtistMatch = false
): Promise<Album[]> {
	const attempts = buildAlbumQueryAttempts(albumQuery, artistQuery);
	const allAlbums: Album[] = [];
	let firstError: unknown = null;
	let hasSuccess = false;

	for (let i = 0; i < attempts.length; i += BASE_ALBUM_ATTEMPT_BATCH_SIZE) {
		const batch = attempts.slice(i, i + BASE_ALBUM_ATTEMPT_BATCH_SIZE);
		const settled = await Promise.allSettled(
			batch.map((attempt) =>
				fetchWithRetry(
					() => losslessAPI.searchAlbums(attempt.query, region, attempt.artistQuery),
					2,
					180
				)
			)
		);
		for (const result of settled) {
			if (result.status === 'fulfilled') {
				hasSuccess = true;
				if (Array.isArray(result.value?.items)) {
					allAlbums.push(...result.value.items);
				}
			} else if (!firstError) {
				firstError = result.reason;
			}
		}

		if (hasSuccess) {
			const earlyDeduped = dedupeAlbumList(allAlbums);
			const earlyMatches = earlyDeduped.filter(
				(album) =>
					albumTitleMatchesQuery(album, albumQuery) &&
					albumMatchesArtistFilter(album, artistQuery ?? '', strictAlbumArtistMatch)
			);
			if (
				earlyMatches.length >= BASE_EARLY_RETURN_MATCH_COUNT ||
				(strictAlbumArtistMatch && earlyMatches.length > 0)
			) {
				return earlyMatches;
			}
		}
	}

	if (!hasSuccess) {
		throw (firstError instanceof Error ? firstError : new Error('Failed to search albums'));
	}

	const deduped = dedupeAlbumList(allAlbums);
	const hasArtistFilter = (artistQuery?.trim().length ?? 0) > 0;
	const titleAndArtistMatches = deduped.filter(
		(album) =>
			albumTitleMatchesQuery(album, albumQuery) &&
			albumMatchesArtistFilter(album, artistQuery ?? '', strictAlbumArtistMatch)
	);
	if (titleAndArtistMatches.length > 0) {
		return titleAndArtistMatches;
	}

	if (hasArtistFilter) {
		if (strictAlbumArtistMatch) {
			return [];
		}
		return [];
	}

	const titleOnly = deduped.filter((album) => albumTitleMatchesQuery(album, albumQuery));
	if (titleOnly.length > 0) {
		return titleOnly;
	}

	return deduped;
}

async function fetchEnrichedAlbumsFromTidal(
	albumQuery: string,
	region: RegionOption | undefined,
	artistQuery: string | undefined,
	baseAlbums: Album[],
	strictAlbumArtistMatch = false,
	onProgress?: (enrichedAlbums: Album[], progress: { processedArtists: number; totalArtists: number }) => void
): Promise<Album[]> {
	const cleanedArtistQuery = stripWildcardOperators(artistQuery ?? '');
	const normalizedArtistQuery = normalizeToken(cleanedArtistQuery);
	const enrichmentPlan = computeEnrichmentPlan(baseAlbums.length, normalizedArtistQuery.length > 0);
	const candidateArtistScores = new Map<number, number>();
	const trackDerivedAlbums = new Map<string, Album>();

	const registerArtist = (artistId: number, score: number): void => {
		if (!Number.isFinite(artistId) || artistId <= 0) return;
		const current = candidateArtistScores.get(artistId) ?? Number.NEGATIVE_INFINITY;
		if (score > current) {
			candidateArtistScores.set(artistId, score);
		}
	};

	const registerTrackDerivedAlbum = (album: Album): void => {
		const key = albumDedupeKey(album);
		if (!trackDerivedAlbums.has(key)) {
			trackDerivedAlbums.set(key, album);
		}
	};

	const seedArtistsFromTracks = async (
		query: string,
		baseScore: number,
		limit = enrichmentPlan.trackSeedLimit
	): Promise<void> => {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) return;
		try {
			const trackResponse = await fetchWithRetry(() => losslessAPI.searchTracks(trimmedQuery, region), 2, 180);
			for (const track of trackResponse.items.slice(0, limit)) {
				if (typeof track.artist?.id === 'number') {
					registerArtist(track.artist.id, baseScore);
				}
				for (const artist of track.artists ?? []) {
					if (typeof artist?.id === 'number') {
						registerArtist(artist.id, Math.max(1, baseScore - 15));
					}
				}
				const trackAlbum = track.album;
				if (trackAlbum && typeof trackAlbum === 'object') {
					const hydratedTrackAlbum: Album = {
						...trackAlbum,
						artist: trackAlbum.artist ?? track.artist,
						artists:
							Array.isArray(trackAlbum.artists) && trackAlbum.artists.length > 0
								? trackAlbum.artists
								: track.artists
					};
					if (
						albumTitleMatchesQuery(hydratedTrackAlbum, albumQuery) &&
						albumMatchesArtistFilter(
							hydratedTrackAlbum,
							artistQuery ?? '',
							strictAlbumArtistMatch
						)
					) {
						registerTrackDerivedAlbum(hydratedTrackAlbum);
					}
				}
			}
		} catch {
			// Non-fatal.
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

	const seedJobs: Array<() => Promise<void>> = [];

	// Preferred path: user-provided artist query.
	if (normalizedArtistQuery.length > 0) {
		const seedQueries = buildArtistSeedQueries(artistQuery ?? '');
		for (const [index, seedQuery] of seedQueries.entries()) {
			seedJobs.push(() =>
				seedArtistsByQuery(seedQuery, Math.max(110, 180 - index * 20), index === 0 ? 12 : 8)
			);
		}
	}

	// Parse artist hints from combined free-text input such as "artist - album" or "album by artist".
	for (const hint of extractArtistHintsFromAlbumQuery(albumQuery)) {
		if (normalizeToken(hint) === normalizedArtistQuery) continue;
		seedJobs.push(() => seedArtistsByQuery(hint, 120, 6));
	}

	// Additional seed path: track search often exposes useful artist IDs even when album search is sparse.
	seedJobs.push(() => seedArtistsFromTracks(albumQuery, 110));
	if (normalizedArtistQuery.length > 0) {
		seedJobs.push(() => seedArtistsFromTracks(`${cleanedArtistQuery} ${albumQuery}`.trim(), 120, 12));
	}

	// Last fallback: discover candidate artists from album query text.
	seedJobs.push(() => seedArtistsByQuery(albumQuery, 90, 8));

	await runWithConcurrency(seedJobs, enrichmentPlan.seedQueryConcurrency, async (job) => {
		await job();
	});

	const artistIds = Array.from(candidateArtistScores.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, enrichmentPlan.maxArtistSeeds)
		.map(([artistId]) => artistId);

	if (artistIds.length === 0) {
		return Array.from(trackDerivedAlbums.values());
	}

	const enrichedAlbums: Album[] = Array.from(trackDerivedAlbums.values());
	let reachedLimit = false;
	let processedArtists = 0;
	const enrichmentDeadline = Date.now() + enrichmentPlan.timeBudgetMs;
	await runWithConcurrency(artistIds, enrichmentPlan.artistConcurrency, async (artistId) => {
		let addedAlbums = false;
		try {
			if (reachedLimit || Date.now() > enrichmentDeadline) {
				reachedLimit = true;
				return;
			}
			// getArtist includes official-discography enrichment when available in browser context.
			const artistDetails = await fetchWithRetry(() => losslessAPI.getArtist(artistId), 2, 220);
			const albums = Array.isArray(artistDetails?.albums) ? artistDetails.albums : [];
			for (const album of albums) {
				if (reachedLimit || Date.now() > enrichmentDeadline) {
					reachedLimit = true;
					break;
				}
				if (!albumTitleMatchesQuery(album, albumQuery)) continue;
				if (!albumMatchesArtistFilter(album, artistQuery ?? '', strictAlbumArtistMatch)) continue;
				enrichedAlbums.push(album);
				addedAlbums = true;
				if (enrichedAlbums.length >= enrichmentPlan.maxEnrichedAlbums) {
					reachedLimit = true;
					break;
				}
			}
		} catch {
			// Non-fatal.
		} finally {
			processedArtists += 1;
			if (onProgress && (addedAlbums || processedArtists === artistIds.length)) {
				onProgress([...enrichedAlbums], {
					processedArtists,
					totalArtists: artistIds.length
				});
			}
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
	const strictAlbumArtistMatch = options?.strictAlbumArtistMatch === true;
	// Include region in cache key to prevent result mismatches across regions
	const searchKey = `${tab}:${trimmedQuery.toLowerCase()}:${region || 'auto'}:${tab === 'albums' ? albumArtistQuery.toLowerCase() : ''}:${tab === 'albums' && strictAlbumArtistMatch ? 'strict' : 'relaxed'}`;
	const cachedResult = getCachedSearchResult(searchKey);
	if (cachedResult) {
		if (cachedResult.success && tab === 'albums' && options?.onProgress) {
			options.onProgress({
				tab: 'albums',
				phase: 'base',
				items: [...cachedResult.results.albums]
			});
		}
		return cachedResult;
	}

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
						const rawItems = Array.isArray(response?.items) ? response.items : [];
						const items = rankItemsByScore(rawItems, (track) => scoreTrackResult(track, trimmedQuery));
						results = { ...emptyResults, tracks: items };
						break;
					}
					case 'albums': {
						const baseItemsRaw = await fetchBaseAlbumsFromApi(
							trimmedQuery,
							region,
							albumArtistQuery || undefined,
							strictAlbumArtistMatch
						);
						const baseItems = mergeAlbumResults(
							baseItemsRaw,
							[],
							trimmedQuery,
							albumArtistQuery || undefined
						);
						options?.onProgress?.({
							tab: 'albums',
							phase: 'base',
							items: [...baseItems]
						});
						const enrichedItems = await fetchEnrichedAlbumsFromTidal(
							trimmedQuery,
							region,
							albumArtistQuery || undefined,
							baseItems,
							strictAlbumArtistMatch,
							(partialEnrichedItems, progress) => {
								const mergedPartialItems = mergeAlbumResults(
									baseItems,
									partialEnrichedItems,
									trimmedQuery,
									albumArtistQuery || undefined
								);
								options?.onProgress?.({
									tab: 'albums',
									phase: 'enriched',
									items: mergedPartialItems,
									processedArtists: progress.processedArtists,
									totalArtists: progress.totalArtists
								});
								}
							);
							const items = mergeAlbumResults(
								baseItems,
								enrichedItems,
								trimmedQuery,
								albumArtistQuery || undefined
							);
							results = { ...emptyResults, albums: items };
							break;
						}
					case 'artists': {
						const response = await fetchWithRetry(
							() => losslessAPI.searchArtists(trimmedQuery, region),
							3,
							220
						);
						const rawItems = Array.isArray(response?.items) ? response.items : [];
						const items = rankItemsByScore(rawItems, (artist) =>
							scoreArtistResult(artist, trimmedQuery)
						);
						results = { ...emptyResults, artists: items };
						break;
					}
					case 'playlists': {
						const response = await fetchWithRetry(
							() => losslessAPI.searchPlaylists(trimmedQuery, region),
							3,
							220
						);
						const rawItems = Array.isArray(response?.items) ? response.items : [];
						const items = rankItemsByScore(rawItems, (playlist) =>
							scorePlaylistResult(playlist, trimmedQuery)
						);
						results = { ...emptyResults, playlists: items };
						break;
					}
					default:
						results = emptyResults;
				}
				const successResult: SearchResult = { success: true, results };
				setCachedSearchResult(searchKey, successResult);
				return successResult;
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
	completedSearchCache.clear();
}
