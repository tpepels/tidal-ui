import type { Album } from '$lib/types';

export type MusicBrainzReleaseSearchOption = {
	id: string;
	title?: string;
	trackCount?: number;
	date?: string;
};

export type MusicBrainzReleaseSearchResponse = {
	success?: boolean;
	releases?: MusicBrainzReleaseSearchOption[];
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ResolveMatchOptions = {
	lookupCache: Map<string, string | null>;
	fetchImpl?: FetchLike;
};

type AlbumMusicBrainzMatchControllerOptions = {
	concurrency?: number;
	lookupLimit?: number;
	hasMatch: (albumId: number) => boolean;
	onMatch: (albumId: number, releaseId: string) => void;
	fetchImpl?: FetchLike;
};

const DEFAULT_LOOKUP_LIMIT = 24;
const DEFAULT_LOOKUP_CONCURRENCY = 5;
const MAX_LOOKUP_CONCURRENCY = 5;
const PERSISTENT_MATCH_CACHE_STORAGE_KEY = 'tidal-ui.musicbrainz.album-match-cache.v1';
const sharedLookupCache = new Map<string, string | null>();
const persistentLookupCache = new Map<string, string>();
let hasLoadedPersistentLookupCache = false;

function canUsePersistentLookupCache(): boolean {
	if (typeof window === 'undefined' || !window.localStorage) {
		return false;
	}
	if (typeof process !== 'undefined' && process.env?.VITEST) {
		return false;
	}
	return true;
}

function loadPersistentLookupCacheInto(cache: Map<string, string | null>): void {
	if (hasLoadedPersistentLookupCache || !canUsePersistentLookupCache()) {
		return;
	}
	hasLoadedPersistentLookupCache = true;

	try {
		const raw = window.localStorage.getItem(PERSISTENT_MATCH_CACHE_STORAGE_KEY);
		if (!raw) {
			return;
		}
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof key !== 'string' || typeof value !== 'string' || value.length === 0) {
				continue;
			}
			persistentLookupCache.set(key, value);
			cache.set(key, value);
		}
	} catch {
		// Ignore malformed persistent cache payloads.
	}
}

function persistLookupCacheEntry(lookupKey: string, releaseId: string): void {
	if (!canUsePersistentLookupCache() || !lookupKey || !releaseId) {
		return;
	}
	persistentLookupCache.set(lookupKey, releaseId);
	try {
		window.localStorage.setItem(
			PERSISTENT_MATCH_CACHE_STORAGE_KEY,
			JSON.stringify(Object.fromEntries(persistentLookupCache.entries()))
		);
	} catch {
		// Ignore storage quota and serialization failures.
	}
}

function clearPersistentLookupCacheStorage(): void {
	persistentLookupCache.clear();
	if (!canUsePersistentLookupCache()) {
		return;
	}
	try {
		window.localStorage.removeItem(PERSISTENT_MATCH_CACHE_STORAGE_KEY);
	} catch {
		// Ignore storage failures.
	}
}

export function normalizeMusicBrainzText(value: string | undefined): string {
	if (!value) return '';
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function stripTrailingBracketedSuffix(value: string | undefined): string {
	if (!value) {
		return '';
	}

	let stripped = value.trim();
	while (stripped.length > 0) {
		const next = stripped.replace(/\s*[([{][^()[\]{}]*[)\]}]\s*$/u, '').trim();
		if (next === stripped) {
			break;
		}
		stripped = next;
	}

	return stripped;
}

export function musicBrainzTitlesLikelyMatch(albumTitle: string, releaseTitle: string): boolean {
	const normalizedAlbumTitle = normalizeMusicBrainzText(albumTitle);
	const normalizedReleaseTitle = normalizeMusicBrainzText(releaseTitle);
	const normalizedAlbumTitleWithoutTrailingBracketSuffix = normalizeMusicBrainzText(
		stripTrailingBracketedSuffix(albumTitle)
	);
	const normalizedReleaseTitleWithoutTrailingBracketSuffix = normalizeMusicBrainzText(
		stripTrailingBracketedSuffix(releaseTitle)
	);
	if (!normalizedAlbumTitle || !normalizedReleaseTitle) {
		return false;
	}
	if (
		normalizedAlbumTitle === normalizedReleaseTitle ||
		normalizedAlbumTitle.includes(normalizedReleaseTitle) ||
		normalizedReleaseTitle.includes(normalizedAlbumTitle) ||
		(normalizedAlbumTitleWithoutTrailingBracketSuffix.length > 0 &&
			normalizedAlbumTitleWithoutTrailingBracketSuffix ===
				normalizedReleaseTitleWithoutTrailingBracketSuffix)
	) {
		return true;
	}

	const albumTokens = normalizedAlbumTitle.split(' ').filter((token) => token.length > 1);
	const releaseTokens = new Set(normalizedReleaseTitle.split(' ').filter((token) => token.length > 1));
	if (albumTokens.length === 0 || releaseTokens.size === 0) {
		return false;
	}
	const matchedTokens = albumTokens.filter((token) => releaseTokens.has(token)).length;
	return matchedTokens >= Math.max(1, Math.ceil(albumTokens.length * 0.75));
}

export function resolveMusicBrainzReleaseTrackCount(release: MusicBrainzReleaseSearchOption): number | null {
	const trackCount = Number(release.trackCount);
	if (!Number.isFinite(trackCount) || trackCount <= 0) {
		return null;
	}
	return Math.trunc(trackCount);
}

export function compareMusicBrainzReleaseDateDesc(
	left: MusicBrainzReleaseSearchOption,
	right: MusicBrainzReleaseSearchOption
): number {
	const leftDate = left.date?.trim() ?? '';
	const rightDate = right.date?.trim() ?? '';
	if (!leftDate && !rightDate) return 0;
	if (!leftDate) return 1;
	if (!rightDate) return -1;
	return rightDate.localeCompare(leftDate);
}

export function resolveAlbumTrackCountForMusicBrainz(album: Album): number | null {
	const value = Number(album.numberOfTracks);
	if (!Number.isFinite(value) || value <= 0) {
		return null;
	}
	return Math.trunc(value);
}

export function resolveAlbumMusicBrainzLookupKey(album: Album): string | null {
	const title = album.title?.trim() ?? '';
	const artistName = album.artist?.name?.trim() ?? '';
	const trackCount = resolveAlbumTrackCountForMusicBrainz(album);
	if (!title || !artistName) {
		return null;
	}
	const normalizedTitle = normalizeMusicBrainzText(title);
	const normalizedArtist = normalizeMusicBrainzText(artistName);
	const releaseDate = album.releaseDate?.trim() ?? '';
	const upc = album.upc?.trim() ?? '';
	return `${normalizedTitle}::${normalizedArtist}::${trackCount ?? 0}::${releaseDate}::${upc}`;
}

export async function resolveAlbumMusicBrainzReleaseMatch(
	album: Album,
	lookupKey: string,
	options: ResolveMatchOptions
): Promise<string | null> {
	if (options.lookupCache.has(lookupKey)) {
		return options.lookupCache.get(lookupKey) ?? null;
	}

	const albumTitle = album.title?.trim() ?? '';
	const artistName = album.artist?.name?.trim() ?? '';
	const trackCount = resolveAlbumTrackCountForMusicBrainz(album);
	if (!albumTitle || !artistName) {
		options.lookupCache.set(lookupKey, null);
		return null;
	}
	const fallbackAlbumTitle = stripTrailingBracketedSuffix(albumTitle);
	const albumTitlesToSearch =
		fallbackAlbumTitle && fallbackAlbumTitle !== albumTitle
			? [albumTitle, fallbackAlbumTitle]
			: [albumTitle];

	const fetchImpl = options.fetchImpl ?? fetch;
	try {
		let compatibleReleases: MusicBrainzReleaseSearchOption[] = [];

		for (const titleToSearch of albumTitlesToSearch) {
			const response = await fetchImpl('/api/metadata/musicbrainz-release-search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					albumTitle: titleToSearch,
					artistName,
					releaseDate: album.releaseDate,
					upc: album.upc,
					limit: 16
				})
			});
			const payload = (await response.json().catch(() => null)) as
				| MusicBrainzReleaseSearchResponse
				| null;
			if (!response.ok || !payload?.success || !Array.isArray(payload.releases)) {
				continue;
			}

			compatibleReleases = payload.releases
				.filter(
					(release) =>
						typeof release?.id === 'string' &&
						release.id.length > 0 &&
						typeof release.title === 'string' &&
						musicBrainzTitlesLikelyMatch(albumTitle, release.title)
				)
				.filter((release) => {
					if (trackCount === null) {
						return true;
					}
					const releaseTrackCount = resolveMusicBrainzReleaseTrackCount(release);
					return releaseTrackCount !== null && releaseTrackCount >= trackCount;
				})
				.sort((left, right) => {
					if (trackCount === null) {
						return compareMusicBrainzReleaseDateDesc(left, right);
					}
					const leftTrackCount =
						resolveMusicBrainzReleaseTrackCount(left) ?? Number.MAX_SAFE_INTEGER;
					const rightTrackCount =
						resolveMusicBrainzReleaseTrackCount(right) ?? Number.MAX_SAFE_INTEGER;
					const leftDistance = Math.abs(leftTrackCount - trackCount);
					const rightDistance = Math.abs(rightTrackCount - trackCount);
					if (leftDistance !== rightDistance) {
						return leftDistance - rightDistance;
					}
					return compareMusicBrainzReleaseDateDesc(left, right);
				});

			if (compatibleReleases.length > 0) {
				break;
			}
		}

		const matchId = compatibleReleases[0]?.id ?? null;
		options.lookupCache.set(lookupKey, matchId);
		if (matchId) {
			persistLookupCacheEntry(lookupKey, matchId);
		}
		return matchId;
	} catch {
		options.lookupCache.set(lookupKey, null);
		return null;
	}
}

export function createAlbumMusicBrainzMatchController(
	options: AlbumMusicBrainzMatchControllerOptions
) {
	const lookupLimit = options.lookupLimit ?? DEFAULT_LOOKUP_LIMIT;
	const concurrency = Math.min(
		MAX_LOOKUP_CONCURRENCY,
		Math.max(1, options.concurrency ?? DEFAULT_LOOKUP_CONCURRENCY)
	);
	const lookupCache = sharedLookupCache;
	loadPersistentLookupCacheInto(lookupCache);
	let lookupToken = 0;

	async function hydrate(albums: Album[]): Promise<void> {
		if (albums.length === 0) {
			lookupToken += 1;
			return;
		}

		const candidates = albums
			.map((album) => {
				const lookupKey = resolveAlbumMusicBrainzLookupKey(album);
				return { album, lookupKey };
			})
			.filter(
				(entry): entry is { album: Album; lookupKey: string } =>
					typeof entry.lookupKey === 'string' &&
					!options.hasMatch(entry.album.id)
			)
			.slice(0, lookupLimit);

		if (candidates.length === 0) {
			return;
		}

		const token = ++lookupToken;

		for (let batchStart = 0; batchStart < candidates.length; batchStart += concurrency) {
			if (token !== lookupToken) {
				return;
			}

			const batch = candidates.slice(batchStart, batchStart + concurrency);
			const resolvedBatch = await Promise.all(
				batch.map(async (entry) => {
					const releaseId = await resolveAlbumMusicBrainzReleaseMatch(entry.album, entry.lookupKey, {
						lookupCache,
						fetchImpl: options.fetchImpl
					});
					return { albumId: entry.album.id, releaseId };
				})
			);

			if (token !== lookupToken) {
				return;
			}

			for (const result of resolvedBatch) {
				if (!result.releaseId || options.hasMatch(result.albumId)) {
					continue;
				}
				options.onMatch(result.albumId, result.releaseId);
			}
		}
	}

	function invalidate(): void {
		lookupToken += 1;
	}

	function clearCache(): void {
		lookupCache.clear();
		clearPersistentLookupCacheStorage();
	}

	return {
		hydrate,
		invalidate,
		clearCache
	};
}
