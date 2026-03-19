import { API_CONFIG, fetchWithCORS, selectApiTargetForRegion } from '$lib/config';
import type { RegionOption } from '$lib/stores/region';
import { getAlbum, getArtist, getArtistRecommendations, getPlaylist } from '$lib/api/catalog';
import { searchAlbums, searchArtists, searchPlaylists, searchTracks } from '$lib/api/search';

function ensureNotRateLimited(response: Response): void {
	if (response.status === 429) {
		throw new Error('Too Many Requests. Please wait a moment and try again.');
	}
}

function buildRegionalUrl(path: string, region: RegionOption = 'auto'): string {
	const target = selectApiTargetForRegion(region);
	const base = target.baseUrl.replace(/\/+$/, '');
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	return `${base}${normalizedPath}`;
}

function getCatalogContext() {
	return {
		baseUrl: API_CONFIG.baseUrl,
		fetch: (url: string, options?: RequestInit) => fetchWithCORS(url, options),
		ensureNotRateLimited
	};
}

function getSearchContext() {
	return {
		buildRegionalUrl,
		fetch: (url: string) => fetchWithCORS(url),
		ensureNotRateLimited
	};
}

export async function fetchCatalogAlbum(id: number, signal?: AbortSignal) {
	return getAlbum(getCatalogContext(), id, { signal });
}

export async function fetchCatalogPlaylist(id: string) {
	return getPlaylist(getCatalogContext(), id);
}

export async function fetchCatalogArtist(
	id: number,
	options?: {
		signal?: AbortSignal;
		officialOrigin?: string;
	}
) {
	return getArtist(getCatalogContext(), id, {
		signal: options?.signal,
		officialEnrichment: Boolean(options?.officialOrigin),
		officialOrigin: options?.officialOrigin
	});
}

export async function fetchCatalogArtistRecommendations(id: number, signal?: AbortSignal) {
	return getArtistRecommendations(getCatalogContext(), id, { signal });
}

export async function searchCatalog(
	type: 'tracks' | 'albums' | 'artists' | 'playlists',
	query: string,
	options?: {
		region?: RegionOption;
		artistQuery?: string;
	}
) {
	const context = getSearchContext();
	const region = options?.region ?? 'auto';
	switch (type) {
		case 'tracks':
			return searchTracks(context, query, region);
		case 'albums':
			return searchAlbums(context, query, region, options?.artistQuery);
		case 'artists':
			return searchArtists(context, query, region);
		case 'playlists':
			return searchPlaylists(context, query, region);
	}
}
