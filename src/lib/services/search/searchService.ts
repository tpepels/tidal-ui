import { losslessAPI } from '$lib/api';
import { deleteInFlightSearchIfSame, buildSearchKey, clearSearchCache as clearSearchCacheStore, getCachedSearchResult, getInFlightSearch, setCachedSearchResult, setInFlightSearch } from './searchCache';
import { fetchBaseAlbumsFromApi, fetchEnrichedAlbumsFromTidal } from './searchAlbumEnrichment';
import { classifySearchError, fetchWithRetry } from './searchErrors';
import { mergeAlbumResults, rankItemsByScore, scoreArtistResult, scorePlaylistResult, scoreTrackResult } from './searchRanking';
import { createEmptySearchResults, type RegionOption, type SearchExecutionOptions, type SearchResult, type SearchResults, type SearchTab } from './searchTypes';

export type {
	RegionOption,
	SearchExecutionOptions,
	SearchError,
	SearchProgressUpdate,
	SearchResult,
	SearchResults,
	SearchTab
} from './searchTypes';

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

	const emptyResults: SearchResults = createEmptySearchResults();
	const albumArtistQuery = options?.albumArtistQuery?.trim() ?? '';
	const strictAlbumArtistMatch = options?.strictAlbumArtistMatch === true;
	const searchKey = buildSearchKey({
		query: trimmedQuery,
		tab,
		region,
		albumArtistQuery,
		strictAlbumArtistMatch
	});
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

	let pending = getInFlightSearch(searchKey);

	if (!pending) {
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

		setInFlightSearch(searchKey, pending);
	}

	try {
		return await pending;
	} finally {
		deleteInFlightSearchIfSame(searchKey, pending);
	}
}

export function clearSearchCache(): void {
	clearSearchCacheStore();
}
