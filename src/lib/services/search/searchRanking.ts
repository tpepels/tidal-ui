import type { Album, Artist, Playlist, SonglinkTrack, Track } from '$lib/types';
import {
	hasWildcardPattern,
	normalizeToken,
	queryMatchesArtistName,
	splitTokens,
	stripWildcardOperators
} from './searchQuery';

export function getAlbumArtistNames(album: Album): string[] {
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

export function scoreTextRelevance(primaryText: string, query: string): number {
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

export function rankItemsByScore<T>(items: T[], scorer: (item: T) => number): T[] {
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

export function scoreTrackResult(track: Track | SonglinkTrack, query: string): number {
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

export function scoreArtistResult(artist: Artist, query: string): number {
	let score = scoreTextRelevance(artist.name ?? '', query) * 1.6;
	if (typeof artist.popularity === 'number' && Number.isFinite(artist.popularity)) {
		score += Math.min(34, Math.max(0, artist.popularity / 3));
	}
	return score;
}

export function scorePlaylistResult(playlist: Playlist, query: string): number {
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

export function albumTitleMatchesQuery(album: Album, albumQuery: string): boolean {
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

export function albumMatchesArtistFilter(album: Album, artistQuery: string, strict = false): boolean {
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

export function scoreAlbumResult(album: Album, albumQuery: string, artistQuery?: string): number {
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

export function albumDedupeKey(album: Album): string {
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

export function mergeAlbumResults(
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

export function dedupeAlbumList(albums: Album[]): Album[] {
	const deduped = new Map<string, Album>();
	for (const album of albums) {
		const key = albumDedupeKey(album);
		if (!deduped.has(key)) {
			deduped.set(key, album);
		}
	}
	return Array.from(deduped.values());
}
