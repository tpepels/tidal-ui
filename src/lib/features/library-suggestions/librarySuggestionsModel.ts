import type {
	MediaLibraryAlbumSuggestion,
	MediaLibraryArtistSuggestion
} from '$lib/utils/mediaLibraryClient';
import type { Album, Artist } from '$lib/types';

export type SeedArtist = {
	artist: Artist;
	source: MediaLibraryArtistSuggestion;
	weight: number;
};

export type ScoredArtist = {
	artist: Artist;
	score: number;
	seedMatches: number;
};

export type ScoredAlbum = {
	album: Album;
	score: number;
	seedMatches: number;
};

export type SuggestionsCacheSnapshot = {
	localArtists: MediaLibraryArtistSuggestion[];
	localAlbums: MediaLibraryAlbumSuggestion[];
	scannedAt: number | null;
	seedArtists: SeedArtist[];
	smartArtists: ScoredArtist[];
	smartAlbums: ScoredAlbum[];
	localError: string | null;
	smartError: string | null;
	suggestionSeed: number | null;
	smartGeneratedAt: number | null;
};

export type SuggestionsState = SuggestionsCacheSnapshot;

export type RandomFn = () => number;

export const LOCAL_ARTIST_LIMIT = 25;
export const LOCAL_ALBUM_LIMIT = 25;
export const SMART_SEED_LIMIT = 8;
export const SMART_ARTIST_LIMIT = 20;
export const SMART_ALBUM_LIMIT = 20;

export function createSuggestionsSnapshot(state: SuggestionsState): SuggestionsCacheSnapshot {
	return {
		localArtists: [...state.localArtists],
		localAlbums: [...state.localAlbums],
		scannedAt: state.scannedAt,
		seedArtists: [...state.seedArtists],
		smartArtists: [...state.smartArtists],
		smartAlbums: [...state.smartAlbums],
		localError: state.localError,
		smartError: state.smartError,
		suggestionSeed: state.suggestionSeed,
		smartGeneratedAt: state.smartGeneratedAt
	};
}

export function normalizeSuggestionsSnapshot(
	snapshot: SuggestionsCacheSnapshot
): SuggestionsCacheSnapshot {
	return {
		localArtists: Array.isArray(snapshot.localArtists) ? snapshot.localArtists : [],
		localAlbums: Array.isArray(snapshot.localAlbums) ? snapshot.localAlbums : [],
		scannedAt:
			typeof snapshot.scannedAt === 'number' && Number.isFinite(snapshot.scannedAt)
				? snapshot.scannedAt
				: null,
		seedArtists: Array.isArray(snapshot.seedArtists) ? snapshot.seedArtists : [],
		smartArtists: Array.isArray(snapshot.smartArtists) ? snapshot.smartArtists : [],
		smartAlbums: Array.isArray(snapshot.smartAlbums) ? snapshot.smartAlbums : [],
		localError: snapshot.localError ?? null,
		smartError: snapshot.smartError ?? null,
		suggestionSeed:
			typeof snapshot.suggestionSeed === 'number' && Number.isFinite(snapshot.suggestionSeed)
				? snapshot.suggestionSeed
				: null,
		smartGeneratedAt:
			typeof snapshot.smartGeneratedAt === 'number' && Number.isFinite(snapshot.smartGeneratedAt)
				? snapshot.smartGeneratedAt
				: null
	};
}

export function parseSuggestionsSnapshot(
	raw: string | null | undefined
): SuggestionsCacheSnapshot | null {
	if (!raw) {
		return null;
	}
	const parsed = JSON.parse(raw) as SuggestionsCacheSnapshot | null;
	if (!parsed || typeof parsed !== 'object') {
		return null;
	}
	const normalized = normalizeSuggestionsSnapshot(parsed);
	const hasRenderableState =
		normalized.localArtists.length > 0 ||
		normalized.localAlbums.length > 0 ||
		normalized.smartArtists.length > 0 ||
		normalized.smartAlbums.length > 0 ||
		(typeof normalized.scannedAt === 'number' && Number.isFinite(normalized.scannedAt)) ||
		(typeof normalized.suggestionSeed === 'number' &&
			Number.isFinite(normalized.suggestionSeed)) ||
		typeof normalized.localError === 'string' ||
		typeof normalized.smartError === 'string';
	return hasRenderableState ? normalized : null;
}

export function normalizeToken(value: string | null | undefined): string {
	if (!value) return '';
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function buildSearchHref(query: string, tab: 'artists' | 'albums'): string {
	const normalizedQuery = query.trim();
	if (!normalizedQuery) return '/';
	const params = new URLSearchParams({ q: normalizedQuery, tab });
	return `/?${params.toString()}`;
}

export function scoreArtistMatch(candidate: Artist, expectedArtistName: string): number {
	const expected = normalizeToken(expectedArtistName);
	const candidateName = normalizeToken(candidate.name);
	if (!candidateName) return Number.NEGATIVE_INFINITY;
	let score = 0;
	if (expected.length > 0) {
		if (candidateName === expected) {
			score += 1000;
		} else if (candidateName.startsWith(expected) || expected.startsWith(candidateName)) {
			score += 420;
		} else if (candidateName.includes(expected) || expected.includes(candidateName)) {
			score += 210;
		}
	}
	score += Math.max(0, Math.trunc((candidate.popularity ?? 0) / 5));
	return score;
}

export function pickBestArtistMatch(
	items: Artist[],
	expectedArtistName: string
): Artist | null {
	if (!Array.isArray(items) || items.length === 0) {
		return null;
	}
	let best: Artist | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const item of items) {
		const score = scoreArtistMatch(item, expectedArtistName);
		if (score > bestScore) {
			best = item;
			bestScore = score;
		}
	}
	return best;
}

export function getAlbumLibraryKey(
	artistName: string | null | undefined,
	albumTitle: string | null | undefined
): string {
	return `${normalizeToken(artistName)}::${normalizeToken(albumTitle)}`;
}

export function createSuggestionSeed(): number {
	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		const seedBuffer = new Uint32Array(1);
		crypto.getRandomValues(seedBuffer);
		return seedBuffer[0] >>> 0;
	}
	return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}

export function createSeededRandom(seed: number): RandomFn {
	let t = seed >>> 0;
	return () => {
		t += 0x6d2b79f5;
		let result = Math.imul(t ^ (t >>> 15), 1 | t);
		result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
		return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
	};
}

function randomInt(maxExclusive: number, random: RandomFn): number {
	if (maxExclusive <= 1) return 0;
	return Math.floor(random() * maxExclusive);
}

function pickWeightedRandomIndex(weights: number[], random: RandomFn): number {
	if (weights.length === 0) return -1;
	const totalWeight = weights.reduce(
		(total, weight) => total + (Number.isFinite(weight) && weight > 0 ? weight : 0),
		0
	);
	if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
		return randomInt(weights.length, random);
	}
	let threshold = random() * totalWeight;
	for (let index = 0; index < weights.length; index += 1) {
		const candidateWeight = weights[index];
		const weight =
			typeof candidateWeight === 'number' && Number.isFinite(candidateWeight) && candidateWeight > 0
				? candidateWeight
				: 0;
		threshold -= weight;
		if (threshold <= 0) {
			return index;
		}
	}
	return weights.length - 1;
}

function sampleSeedArtistCandidates(
	artists: MediaLibraryArtistSuggestion[],
	limit: number,
	random: RandomFn
): MediaLibraryArtistSuggestion[] {
	const candidatePool = [...artists]
		.map((candidate) => ({
			candidate,
			baseWeight: Math.max(1, candidate.trackCount) + Math.max(0, candidate.albumCount) * 1.5
		}))
		.sort((a, b) => {
			if (b.baseWeight !== a.baseWeight) return b.baseWeight - a.baseWeight;
			return a.candidate.artistName.localeCompare(b.candidate.artistName);
		})
		.slice(0, Math.max(limit * 2, SMART_SEED_LIMIT * 4));

	const selected: MediaLibraryArtistSuggestion[] = [];
	const workingPool = [...candidatePool];
	while (selected.length < limit && workingPool.length > 0) {
		const weights = workingPool.map((entry, index) => {
			const rankFactor = (workingPool.length - index) / workingPool.length;
			const randomJitter = random() * Math.max(2, entry.baseWeight * 0.35);
			return entry.baseWeight * (0.75 + rankFactor * 0.5) + randomJitter;
		});
		const pickedIndex = pickWeightedRandomIndex(weights, random);
		if (pickedIndex < 0 || pickedIndex >= workingPool.length) {
			break;
		}
		selected.push(workingPool[pickedIndex]?.candidate ?? workingPool[0].candidate);
		workingPool.splice(pickedIndex, 1);
	}
	return selected;
}

export async function resolveSeedArtists(
	artists: MediaLibraryArtistSuggestion[],
	random: RandomFn,
	searchArtists: (query: string) => Promise<{ items?: Artist[] }>
): Promise<SeedArtist[]> {
	const rankedCandidates = sampleSeedArtistCandidates(artists, SMART_SEED_LIMIT * 4, random);
	const resolved: SeedArtist[] = [];
	const seenArtistIds = new Set<number>();
	for (const candidate of rankedCandidates) {
		if (resolved.length >= SMART_SEED_LIMIT) {
			break;
		}
		const query = (candidate.searchQuery || candidate.artistName || '').trim();
		if (!query) {
			continue;
		}
		try {
			const response = await searchArtists(query);
			const match = pickBestArtistMatch(response.items ?? [], candidate.artistName);
			if (!match || !Number.isFinite(match.id) || seenArtistIds.has(match.id)) {
				continue;
			}
			seenArtistIds.add(match.id);
			const weight = Math.max(1, candidate.trackCount) + Math.max(0, candidate.albumCount) * 1.5;
			resolved.push({
				artist: match,
				source: candidate,
				weight
			});
		} catch (error) {
			console.warn(`[Library Suggestions] Failed to resolve seed artist "${query}":`, error);
		}
	}
	return resolved;
}

export async function buildSmartSuggestions(args: {
	artists: MediaLibraryArtistSuggestion[];
	albums: MediaLibraryAlbumSuggestion[];
	seed: number;
	searchArtists: (query: string) => Promise<{ items?: Artist[] }>;
	getArtistRecommendations: (artistId: number) => Promise<{
		artists?: Artist[];
		albums?: Album[];
	}>;
}): Promise<{
	seedArtists: SeedArtist[];
	smartArtists: ScoredArtist[];
	smartAlbums: ScoredAlbum[];
	suggestionSeed: number;
	smartGeneratedAt: number;
	smartError: string | null;
}> {
	const random = createSeededRandom(args.seed);
	const resolvedSeeds = await resolveSeedArtists(args.artists, random, args.searchArtists);
	const suggestionSeed = args.seed >>> 0;
	const smartGeneratedAt = Date.now();
	if (resolvedSeeds.length === 0) {
		return {
			seedArtists: [],
			smartArtists: [],
			smartAlbums: [],
			suggestionSeed,
			smartGeneratedAt,
			smartError: 'No reliable seed artists found in your library yet.'
		};
	}

	const localArtistNames = new Set(args.artists.map((entry) => normalizeToken(entry.artistName)));
	const localAlbumKeys = new Set(
		args.albums.map((entry) => getAlbumLibraryKey(entry.artistName, entry.albumTitle))
	);
	const artistScores = new Map<number, ScoredArtist>();
	const albumScores = new Map<number, ScoredAlbum>();
	let successfulSeeds = 0;

	for (const seed of resolvedSeeds) {
		try {
			const recommendations = await args.getArtistRecommendations(seed.artist.id);
			successfulSeeds += 1;
			const weight = Math.max(1, seed.weight);
			for (const recommendationArtist of recommendations.artists ?? []) {
				if (!Number.isFinite(recommendationArtist.id)) continue;
				if (recommendationArtist.id === seed.artist.id) continue;
				if (localArtistNames.has(normalizeToken(recommendationArtist.name))) continue;
				const current = artistScores.get(recommendationArtist.id);
				if (current) {
					current.score += weight;
					current.seedMatches += 1;
				} else {
					artistScores.set(recommendationArtist.id, {
						artist: recommendationArtist,
						score: weight,
						seedMatches: 1
					});
				}
			}
			for (const recommendationAlbum of recommendations.albums ?? []) {
				if (!Number.isFinite(recommendationAlbum.id)) continue;
				const artistName =
					recommendationAlbum.artist?.name ?? recommendationAlbum.artists?.[0]?.name ?? '';
				const albumKey = getAlbumLibraryKey(artistName, recommendationAlbum.title);
				if (localAlbumKeys.has(albumKey)) continue;
				const current = albumScores.get(recommendationAlbum.id);
				if (current) {
					current.score += weight;
					current.seedMatches += 1;
				} else {
					albumScores.set(recommendationAlbum.id, {
						album: recommendationAlbum,
						score: weight,
						seedMatches: 1
					});
				}
			}
		} catch (error) {
			console.warn(
				`[Library Suggestions] Failed to load recommendations for seed artist ${seed.artist.id}:`,
				error
			);
		}
	}

	const rankedArtists = Array.from(artistScores.values()).sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		const popularityA = a.artist.popularity ?? 0;
		const popularityB = b.artist.popularity ?? 0;
		if (popularityB !== popularityA) return popularityB - popularityA;
		return a.artist.name.localeCompare(b.artist.name);
	});
	const rankedAlbums = Array.from(albumScores.values()).sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		const popularityA = a.album.popularity ?? 0;
		const popularityB = b.album.popularity ?? 0;
		if (popularityB !== popularityA) return popularityB - popularityA;
		return a.album.title.localeCompare(b.album.title);
	});

	let smartError: string | null = null;
	if (successfulSeeds === 0) {
		smartError = 'API recommendations are currently unavailable.';
	} else if (rankedArtists.length === 0 && rankedAlbums.length === 0) {
		smartError = 'No new recommendations available from current seed artists.';
	}

	return {
		seedArtists: resolvedSeeds,
		smartArtists: rankedArtists.slice(0, SMART_ARTIST_LIMIT),
		smartAlbums: rankedAlbums.slice(0, SMART_ALBUM_LIMIT),
		suggestionSeed,
		smartGeneratedAt,
		smartError
	};
}
