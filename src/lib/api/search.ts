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

const parseNumericId = (value: unknown): number | null => {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
};

const dedupeByKey = <T>(items: T[], keyFn: (item: T) => string): T[] => {
	const seen = new Set<string>();
	const deduped: T[] = [];
	for (const item of items) {
		const key = keyFn(item);
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(item);
	}
	return deduped;
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

		safeValidateApiResponse(normalized, TrackSearchResponseSchema, {
			endpoint: 'search.tracks',
			allowUnvalidated: true
		});

		const result = {
			...normalized,
			items: dedupeByKey(
				normalized.items.map((track) => {
					const prepared = prepareTrack(track);
					const parsedId = parseNumericId((prepared as { id?: unknown }).id);
					return parsedId !== null ? { ...prepared, id: parsedId } : prepared;
				}),
				(track) => {
					const parsedId = parseNumericId((track as { id?: unknown }).id);
					return parsedId !== null ? `id:${parsedId}` : `fallback:${(track as { title?: string }).title ?? ''}`;
				}
			)
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

	safeValidateApiResponse(normalized, ArtistSearchResponseSchema, {
		endpoint: 'search.artists',
		allowUnvalidated: true
	});

	return {
		...normalized,
		items: dedupeByKey(
			normalized.items.map((artist) => {
				const prepared = prepareArtist(artist);
				const parsedId = parseNumericId((prepared as { id?: unknown }).id);
				return parsedId !== null ? { ...prepared, id: parsedId } : prepared;
			}),
			(artist) => {
				const parsedId = parseNumericId((artist as { id?: unknown }).id);
				return parsedId !== null
					? `id:${parsedId}`
					: `fallback:${((artist as { name?: string }).name ?? '').trim().toLowerCase()}`;
			}
		)
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

	safeValidateApiResponse(normalized, AlbumSearchResponseSchema, {
		endpoint: 'search.albums',
		allowUnvalidated: true
	});

	return {
		...normalized,
		items: dedupeByKey(
			normalized.items.map((album) => {
				const prepared = prepareAlbum(album);
				const parsedId = parseNumericId((prepared as { id?: unknown }).id);
				return parsedId !== null ? { ...prepared, id: parsedId } : prepared;
			}),
			(album) => {
				const candidate = album as {
					id?: unknown;
					upc?: unknown;
					url?: unknown;
					title?: unknown;
					releaseDate?: unknown;
					artist?: { name?: unknown } | undefined;
				};
				const parsedId = parseNumericId(candidate.id);
				if (parsedId !== null) {
					return `id:${parsedId}`;
				}
				if (typeof candidate.url === 'string' && candidate.url.trim().length > 0) {
					return `url:${candidate.url.trim().toLowerCase()}`;
				}
				if (typeof candidate.upc === 'string' && candidate.upc.trim().length > 0) {
					return `upc:${candidate.upc.trim().toLowerCase()}`;
				}
				const title = typeof candidate.title === 'string' ? candidate.title.trim().toLowerCase() : '';
				const year =
					typeof candidate.releaseDate === 'string' && candidate.releaseDate.length >= 4
						? candidate.releaseDate.slice(0, 4)
						: '';
				const artistName =
					typeof candidate.artist?.name === 'string'
						? candidate.artist.name.trim().toLowerCase()
						: '';
				return `fallback:${artistName}|${title}|${year}`;
			}
		)
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

	safeValidateApiResponse(normalized, PlaylistSearchResponseSchema, {
		endpoint: 'search.playlists',
		allowUnvalidated: true
	});

	return normalized;
}
