import type { SearchResult, SearchResults, SearchTab, RegionOption } from './searchTypes';

const SEARCH_RESULT_CACHE_TTL_MS = 45_000;

const inFlightSearches = new Map<string, Promise<SearchResult>>();
const completedSearchCache = new Map<string, { expiresAt: number; result: SearchResult }>();

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

export function buildSearchKey(params: {
	query: string;
	tab: SearchTab;
	region?: RegionOption;
	albumArtistQuery?: string;
	strictAlbumArtistMatch?: boolean;
}): string {
	const trimmedQuery = params.query.trim().toLowerCase();
	const albumArtistQuery = params.albumArtistQuery?.trim().toLowerCase() ?? '';
	return `${params.tab}:${trimmedQuery}:${params.region || 'auto'}:${params.tab === 'albums' ? albumArtistQuery : ''}:${params.tab === 'albums' && params.strictAlbumArtistMatch ? 'strict' : 'relaxed'}`;
}

export function getCachedSearchResult(searchKey: string): SearchResult | null {
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

export function setCachedSearchResult(searchKey: string, result: SearchResult): void {
	completedSearchCache.set(searchKey, {
		expiresAt: Date.now() + SEARCH_RESULT_CACHE_TTL_MS,
		result: cloneSearchResult(result)
	});
}

export function getInFlightSearch(searchKey: string): Promise<SearchResult> | undefined {
	return inFlightSearches.get(searchKey);
}

export function setInFlightSearch(searchKey: string, pending: Promise<SearchResult>): void {
	inFlightSearches.set(searchKey, pending);
}

export function deleteInFlightSearchIfSame(
	searchKey: string,
	pending: Promise<SearchResult>
): void {
	if (inFlightSearches.get(searchKey) === pending) {
		inFlightSearches.delete(searchKey);
	}
}

export function clearSearchCache(): void {
	inFlightSearches.clear();
	completedSearchCache.clear();
}
