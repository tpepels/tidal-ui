import { logger } from '$lib/core/logger';
import { performanceMonitor } from '$lib/core/performance';
import { normalizeSearchResponse, prepareAlbum, prepareArtist, prepareTrack } from './normalizers';
import {
	AlbumSearchResponseSchema,
	ArtistSearchResponseSchema,
	PlaylistSearchResponseSchema,
	TrackSearchResponseSchema,
	safeValidateApiResponse
} from '$lib/utils/schemas';
import type { Album, Artist, Playlist, SearchResponse, Track } from '$lib/types';
import type { RegionOption } from '$lib/stores/region';

export type SearchApiContext = {
	buildRegionalUrl: (path: string, region?: RegionOption) => string;
	fetch: (url: string) => Promise<Response>;
	ensureNotRateLimited: (response: Response) => void;
};

export async function searchTracks(
	context: SearchApiContext,
	query: string,
	region: RegionOption = 'auto'
): Promise<SearchResponse<Track>> {
	const operation = logger.startOperation('searchTracks', {
		component: 'api',
		query,
		region
	});

	try {
		const url = context.buildRegionalUrl(`/search/?s=${encodeURIComponent(query)}`, region);

		logger.logAPIRequest('GET', url, { component: 'api', operation: 'searchTracks' });

		const response = await performanceMonitor.measureAsyncOperation(
			'api_response_time',
			() => context.fetch(url),
			{ operation: 'searchTracks', method: 'GET', endpoint: 'search' }
		);

		// Record response time separately for API monitoring
		const responseTime = performance.now();
		performanceMonitor.recordMetric('api_response_time', responseTime, {
			operation: 'searchTracks',
			status: response.status.toString(),
			region: region || 'auto'
		});

		logger.logAPIResponse('GET', url, response.status, responseTime, {
			component: 'api',
			operation: 'searchTracks'
		});

		context.ensureNotRateLimited(response);
		if (!response.ok) {
			operation.fail(new Error(`HTTP ${response.status}: Failed to search tracks`));
			throw new Error('Failed to search tracks');
		}

		const data = await response.json();
		const normalized = normalizeSearchResponse<Track>(data, 'tracks');

		const validationResult = safeValidateApiResponse(normalized, TrackSearchResponseSchema);
		if (!validationResult.success) {
			logger.warn('Track search response validation failed, proceeding with unvalidated data', {
				component: 'api',
				operation: 'searchTracks',
				validationError: validationResult.error,
				query
			});
		}

		const result = {
			...normalized,
			items: normalized.items.map((track) => prepareTrack(track))
		};

		operation.complete(result);
		return result;
	} catch (error) {
		operation.fail(error instanceof Error ? error : new Error(String(error)));
		throw error;
	}
}

export async function searchArtists(
	context: SearchApiContext,
	query: string,
	region: RegionOption = 'auto'
): Promise<SearchResponse<Artist>> {
	const response = await context.fetch(
		context.buildRegionalUrl(`/search/?a=${encodeURIComponent(query)}`, region)
	);
	context.ensureNotRateLimited(response);
	if (!response.ok) throw new Error('Failed to search artists');
	const data = await response.json();
	const normalized = normalizeSearchResponse<Artist>(data, 'artists');

	const validationResult = safeValidateApiResponse(normalized, ArtistSearchResponseSchema);
	if (!validationResult.success) {
		console.warn(
			'Artist search response validation failed, proceeding with unvalidated data:',
			validationResult.error
		);
	}

	return {
		...normalized,
		items: normalized.items.map((artist) => prepareArtist(artist))
	};
}

export async function searchAlbums(
	context: SearchApiContext,
	query: string,
	region: RegionOption = 'auto'
): Promise<SearchResponse<Album>> {
	const response = await context.fetch(
		context.buildRegionalUrl(`/search/?al=${encodeURIComponent(query)}`, region)
	);
	context.ensureNotRateLimited(response);
	if (!response.ok) throw new Error('Failed to search albums');
	const data = await response.json();
	const normalized = normalizeSearchResponse<Album>(data, 'albums');

	const validationResult = safeValidateApiResponse(normalized, AlbumSearchResponseSchema);
	if (!validationResult.success) {
		console.warn(
			'Album search response validation failed, proceeding with unvalidated data:',
			validationResult.error
		);
	}

	return {
		...normalized,
		items: normalized.items.map((album) => prepareAlbum(album))
	};
}

export async function searchPlaylists(
	context: SearchApiContext,
	query: string,
	region: RegionOption = 'auto'
): Promise<SearchResponse<Playlist>> {
	const response = await context.fetch(
		context.buildRegionalUrl(`/search/?p=${encodeURIComponent(query)}`, region)
	);
	context.ensureNotRateLimited(response);
	if (!response.ok) throw new Error('Failed to search playlists');
	const data = await response.json();
	const normalized = normalizeSearchResponse<Playlist>(data, 'playlists');

	const validationResult = safeValidateApiResponse(normalized, PlaylistSearchResponseSchema);
	if (!validationResult.success) {
		console.warn(
			'Playlist search response validation failed, proceeding with unvalidated data:',
			validationResult.error
		);
	}

	return normalized;
}
