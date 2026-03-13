import { losslessAPI } from '$lib/api';
import type { Album } from '$lib/types';
import { fetchWithRetry } from './searchErrors';
import {
	buildArtistSeedQueries,
	extractArtistHintsFromAlbumQuery,
	expandAlbumQueryVariants,
	normalizeToken,
	stripWildcardOperators
} from './searchQuery';
import { albumDedupeKey, albumMatchesArtistFilter, albumTitleMatchesQuery, dedupeAlbumList } from './searchRanking';
import type { RegionOption } from './searchTypes';

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

function buildAlbumQueryAttempts(
	albumQuery: string,
	artistQuery?: string
): Array<{ query: string; artistQuery?: string }> {
	const attempts: Array<{ query: string; artistQuery?: string }> = [];
	const normalizedArtistQuery = stripWildcardOperators(artistQuery ?? '');
	const pushAttempt = (query: string, optionalArtistQuery?: string): void => {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) return;
		const trimmedArtist = optionalArtistQuery?.trim();
		const key = `${trimmedQuery.toLowerCase()}::${(trimmedArtist ?? '').toLowerCase()}`;
		if (
			attempts.some(
				(attempt) =>
					`${attempt.query.toLowerCase()}::${(attempt.artistQuery ?? '').toLowerCase()}` === key
			)
		) {
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

export async function fetchBaseAlbumsFromApi(
	albumQuery: string,
	region: RegionOption | undefined,
	artistQuery?: string,
	strictAlbumArtistMatch = false
): Promise<Album[]> {
	const attempts = buildAlbumQueryAttempts(albumQuery, artistQuery);
	const allAlbums: Album[] = [];
	let firstError: unknown = null;
	let hasSuccess = false;

	for (let index = 0; index < attempts.length; index += BASE_ALBUM_ATTEMPT_BATCH_SIZE) {
		const batch = attempts.slice(index, index + BASE_ALBUM_ATTEMPT_BATCH_SIZE);
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

export async function fetchEnrichedAlbumsFromTidal(
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

	if (normalizedArtistQuery.length > 0) {
		const seedQueries = buildArtistSeedQueries(artistQuery ?? '');
		for (const [index, seedQuery] of seedQueries.entries()) {
			seedJobs.push(() =>
				seedArtistsByQuery(seedQuery, Math.max(110, 180 - index * 20), index === 0 ? 12 : 8)
			);
		}
	}

	for (const hint of extractArtistHintsFromAlbumQuery(albumQuery)) {
		if (normalizeToken(hint) === normalizedArtistQuery) continue;
		seedJobs.push(() => seedArtistsByQuery(hint, 120, 6));
	}

	seedJobs.push(() => seedArtistsFromTracks(albumQuery, 110));
	if (normalizedArtistQuery.length > 0) {
		seedJobs.push(() => seedArtistsFromTracks(`${cleanedArtistQuery} ${albumQuery}`.trim(), 120, 12));
	}

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
