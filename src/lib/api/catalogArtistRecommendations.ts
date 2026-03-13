import { prepareAlbum, prepareArtist } from './normalizers';
import {
	deletePendingArtistRecommendationRequest,
	getPendingArtistRecommendationRequest,
	setPendingArtistRecommendationRequest
} from './catalogRequestState';
import type { CatalogApiContext } from './catalogTypes';
import type { Album, Artist, ArtistRecommendations } from '$lib/types';

type ArtistRecommendationOptions = {
	signal?: AbortSignal;
};

const MAX_RECOMMENDED_ARTISTS = 8;
const MAX_RECOMMENDED_ALBUMS = 8;
const ARTIST_MIX_PREFERRED_KEYS = ['ARTIST_MIX', 'MASTER_ARTIST_MIX', 'RADIO'] as const;

function parseArtistCandidate(value: unknown): Artist | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Record<string, unknown>;
	const rawId = candidate.id;
	const id =
		typeof rawId === 'number'
			? rawId
			: typeof rawId === 'string' && rawId.trim().length > 0
				? Number(rawId)
				: Number.NaN;
	if (!Number.isFinite(id)) return null;
	const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
	if (!name) return null;
	const rawType = typeof candidate.type === 'string' ? candidate.type.trim() : '';
	const fallbackType = Array.isArray(candidate.artistTypes)
		? candidate.artistTypes.find((entry) => typeof entry === 'string' && entry.trim().length > 0)
		: undefined;
	return prepareArtist({
		...(candidate as Partial<Artist>),
		id,
		name,
		type: rawType || fallbackType || 'ARTIST'
	} as Artist);
}

function parseAlbumCandidate(value: unknown): Album | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Record<string, unknown>;
	const rawId = candidate.id;
	const id =
		typeof rawId === 'number'
			? rawId
			: typeof rawId === 'string' && rawId.trim().length > 0
				? Number(rawId)
				: Number.NaN;
	if (!Number.isFinite(id)) return null;
	const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
	if (!title) return null;
	const cover = typeof candidate.cover === 'string' ? candidate.cover : '';
	const videoCover =
		typeof candidate.videoCover === 'string' || candidate.videoCover === null
			? candidate.videoCover
			: null;
	return prepareAlbum({
		...(candidate as Partial<Album>),
		id,
		title,
		cover,
		videoCover
	} as Album);
}

function extractArtistFromArtistLookupPayload(payload: unknown): Artist | null {
	const container = Array.isArray(payload) ? payload[0] : payload;
	if (!container || typeof container !== 'object') return null;
	const objectRef = container as Record<string, unknown>;
	if (objectRef.artist && typeof objectRef.artist === 'object') {
		return parseArtistCandidate(objectRef.artist);
	}
	return parseArtistCandidate(container);
}

function extractArtistMixId(mixes: unknown): string | null {
	if (!mixes || typeof mixes !== 'object') return null;
	const mixMap = mixes as Record<string, unknown>;
	for (const key of ARTIST_MIX_PREFERRED_KEYS) {
		const candidate = mixMap[key];
		if (typeof candidate === 'string' && candidate.trim().length > 0) {
			return candidate.trim();
		}
	}
	for (const value of Object.values(mixMap)) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
}

function extractMixItems(payload: unknown): unknown[] {
	if (!payload || typeof payload !== 'object') {
		return [];
	}
	const objectRef = payload as Record<string, unknown>;
	if (Array.isArray(objectRef.items)) {
		return objectRef.items;
	}
	if (Array.isArray(objectRef.rows)) {
		return objectRef.rows;
	}
	if (objectRef.pagedList && typeof objectRef.pagedList === 'object') {
		const pagedItems = (objectRef.pagedList as { items?: unknown }).items;
		if (Array.isArray(pagedItems)) {
			return pagedItems;
		}
	}
	return [];
}

function getArtistAggregationKey(artist: Artist): string {
	return Number.isFinite(artist.id) ? `id:${artist.id}` : `name:${artist.name.toLowerCase()}`;
}

function getAlbumAggregationKey(album: Album): string {
	if (Number.isFinite(album.id)) {
		return `id:${album.id}`;
	}
	return `title:${album.title.trim().toLowerCase()}`;
}

function sortArtistsByScore(
	entries: Array<{ artist: Artist; score: number }>,
	limit: number
): Artist[] {
	return entries
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			const popularityA = a.artist.popularity ?? 0;
			const popularityB = b.artist.popularity ?? 0;
			if (popularityB !== popularityA) return popularityB - popularityA;
			return a.artist.name.localeCompare(b.artist.name);
		})
		.slice(0, limit)
		.map((entry) => entry.artist);
}

export async function getArtistRecommendations(
	context: CatalogApiContext,
	artistId: number,
	options?: ArtistRecommendationOptions
): Promise<ArtistRecommendations> {
	const requestKey = `${context.baseUrl}|recommendations|${artistId}`;
	const canDedupe = !options?.signal;
	if (canDedupe) {
		const pending = getPendingArtistRecommendationRequest(requestKey);
		if (pending) {
			return pending;
		}
	}

	const requestPromise = (async (): Promise<ArtistRecommendations> => {
		const baseArtistResponse = await context.fetch(`${context.baseUrl}/artist/?id=${artistId}`, {
			signal: options?.signal
		});
		context.ensureNotRateLimited(baseArtistResponse);
		if (!baseArtistResponse.ok) {
			return {
				source: 'none',
				reason: `artist_lookup_http_${baseArtistResponse.status}`,
				artists: [],
				albums: []
			};
		}

		const baseArtistPayload = await baseArtistResponse.json();
		const baseArtist = extractArtistFromArtistLookupPayload(baseArtistPayload);
		if (!baseArtist) {
			return {
				source: 'none',
				reason: 'artist_lookup_missing_artist',
				artists: [],
				albums: []
			};
		}

		const mixId = extractArtistMixId((baseArtist as { mixes?: unknown }).mixes);
		if (!mixId) {
			return {
				source: 'none',
				reason: 'artist_lookup_missing_mix',
				artists: [],
				albums: []
			};
		}

		const mixResponse = await context.fetch(
			`${context.baseUrl}/mix/?id=${encodeURIComponent(mixId)}`,
			{ signal: options?.signal }
		);
		context.ensureNotRateLimited(mixResponse);
		if (!mixResponse.ok) {
			return {
				source: 'none',
				reason: `mix_lookup_http_${mixResponse.status}`,
				mixId,
				artists: [],
				albums: []
			};
		}

		const mixPayload = await mixResponse.json();
		const mixObject =
			mixPayload && typeof mixPayload === 'object'
				? ((mixPayload as { mix?: unknown }).mix as Record<string, unknown> | undefined)
				: undefined;
		const mixTitle = typeof mixObject?.title === 'string' ? mixObject.title : undefined;
		const mixSubtitle = typeof mixObject?.subTitle === 'string' ? mixObject.subTitle : undefined;

		const mixItems = extractMixItems(mixPayload);
		if (mixItems.length === 0) {
			return {
				source: 'artist-mix',
				reason: 'mix_empty',
				mixId,
				mixTitle,
				mixSubtitle,
				artists: [],
				albums: []
			};
		}

		const artistScores = new Map<string, { artist: Artist; score: number }>();
		const albumScores = new Map<
			string,
			{
				album: Album;
				score: number;
				artistScores: Map<string, { artist: Artist; score: number }>;
			}
		>();

		for (const rawItem of mixItems) {
			const candidate =
				rawItem && typeof rawItem === 'object' && 'item' in rawItem
					? (rawItem as { item?: unknown }).item
					: rawItem;
			if (!candidate || typeof candidate !== 'object') {
				continue;
			}

			const trackCandidate = candidate as Record<string, unknown>;
			const rawArtists = Array.isArray(trackCandidate.artists) ? trackCandidate.artists : [];
			const trackArtists: Artist[] = [];
			const seenTrackArtists = new Set<string>();

			for (const rawArtist of rawArtists) {
				const artist = parseArtistCandidate(rawArtist);
				if (!artist) continue;
				const key = getArtistAggregationKey(artist);
				if (seenTrackArtists.has(key)) continue;
				seenTrackArtists.add(key);
				trackArtists.push(artist);
			}

			const nonSourceArtists = trackArtists.filter((artist) => artist.id !== artistId);
			for (const recommendationArtist of nonSourceArtists) {
				const key = getArtistAggregationKey(recommendationArtist);
				const existing = artistScores.get(key);
				if (existing) {
					existing.score += 1;
				} else {
					artistScores.set(key, { artist: recommendationArtist, score: 1 });
				}
			}

			const album = parseAlbumCandidate(trackCandidate.album);
			if (!album) continue;
			const albumKey = getAlbumAggregationKey(album);
			const albumEntry = albumScores.get(albumKey) ?? {
				album,
				score: 0,
				artistScores: new Map<string, { artist: Artist; score: number }>()
			};
			albumEntry.score += 1;
			const contributingArtists = nonSourceArtists.length > 0 ? nonSourceArtists : trackArtists;
			for (const recommendationArtist of contributingArtists) {
				const key = getArtistAggregationKey(recommendationArtist);
				const existing = albumEntry.artistScores.get(key);
				if (existing) {
					existing.score += 1;
				} else {
					albumEntry.artistScores.set(key, { artist: recommendationArtist, score: 1 });
				}
			}
			albumScores.set(albumKey, albumEntry);
		}

		const artists = sortArtistsByScore(Array.from(artistScores.values()), MAX_RECOMMENDED_ARTISTS);

		const rankedAlbums: Array<{ score: number; album: Album }> = [];
		for (const entry of albumScores.values()) {
			const rankedArtists = sortArtistsByScore(
				Array.from(entry.artistScores.values()),
				MAX_RECOMMENDED_ARTISTS
			);
			const bestArtist = rankedArtists.find((candidate) => candidate.id !== artistId);
			if (!bestArtist) {
				continue;
			}
			rankedAlbums.push({
				score: entry.score,
				album: {
					...entry.album,
					artist: bestArtist,
					artists: [bestArtist]
				}
			});
		}

		const albums = rankedAlbums
			.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				const popularityA = a.album.popularity ?? 0;
				const popularityB = b.album.popularity ?? 0;
				if (popularityB !== popularityA) return popularityB - popularityA;
				return a.album.title.localeCompare(b.album.title);
			})
			.slice(0, MAX_RECOMMENDED_ALBUMS)
			.map((entry) => entry.album);

		return {
			source: 'artist-mix',
			mixId,
			mixTitle,
			mixSubtitle,
			artists,
			albums,
			reason:
				artists.length === 0 && albums.length === 0
					? 'mix_contains_no_non_source_recommendations'
					: undefined
		};
	})();

	if (canDedupe) {
		setPendingArtistRecommendationRequest(requestKey, requestPromise);
	}

	try {
		return await requestPromise;
	} finally {
		if (canDedupe) {
			deletePendingArtistRecommendationRequest(requestKey);
		}
	}
}
