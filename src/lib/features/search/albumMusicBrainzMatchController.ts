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
const DEFAULT_LOOKUP_CONCURRENCY = 3;

export function normalizeMusicBrainzText(value: string | undefined): string {
	if (!value) return '';
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function musicBrainzTitlesLikelyMatch(albumTitle: string, releaseTitle: string): boolean {
	const normalizedAlbumTitle = normalizeMusicBrainzText(albumTitle);
	const normalizedReleaseTitle = normalizeMusicBrainzText(releaseTitle);
	if (!normalizedAlbumTitle || !normalizedReleaseTitle) {
		return false;
	}
	if (
		normalizedAlbumTitle === normalizedReleaseTitle ||
		normalizedAlbumTitle.includes(normalizedReleaseTitle) ||
		normalizedReleaseTitle.includes(normalizedAlbumTitle)
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
	if (!title || !artistName || !trackCount) {
		return null;
	}
	const normalizedTitle = normalizeMusicBrainzText(title);
	const normalizedArtist = normalizeMusicBrainzText(artistName);
	const releaseDate = album.releaseDate?.trim() ?? '';
	const upc = album.upc?.trim() ?? '';
	return `${normalizedTitle}::${normalizedArtist}::${trackCount}::${releaseDate}::${upc}`;
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
	if (!albumTitle || !artistName || !trackCount) {
		options.lookupCache.set(lookupKey, null);
		return null;
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	try {
		const response = await fetchImpl('/api/metadata/musicbrainz-release-search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				albumTitle,
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
			options.lookupCache.set(lookupKey, null);
			return null;
		}

		const compatibleReleases = payload.releases
			.filter(
				(release) =>
					typeof release?.id === 'string' &&
					release.id.length > 0 &&
					typeof release.title === 'string' &&
					musicBrainzTitlesLikelyMatch(albumTitle, release.title)
			)
			.filter((release) => {
				const releaseTrackCount = resolveMusicBrainzReleaseTrackCount(release);
				return releaseTrackCount !== null && releaseTrackCount >= trackCount;
			})
			.sort((left, right) => {
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

		const matchId = compatibleReleases[0]?.id ?? null;
		options.lookupCache.set(lookupKey, matchId);
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
	const concurrency = options.concurrency ?? DEFAULT_LOOKUP_CONCURRENCY;
	const lookupCache = new Map<string, string | null>();
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
					!options.hasMatch(entry.album.id) &&
					!lookupCache.has(entry.lookupKey)
			)
			.slice(0, lookupLimit);

		if (candidates.length === 0) {
			return;
		}

		const token = ++lookupToken;
		const queue = [...candidates];
		const workerCount = Math.min(concurrency, queue.length);

		const workers = Array.from({ length: workerCount }, async () => {
			while (queue.length > 0) {
				const next = queue.shift();
				if (!next) return;

				const releaseId = await resolveAlbumMusicBrainzReleaseMatch(next.album, next.lookupKey, {
					lookupCache,
					fetchImpl: options.fetchImpl
				});
				if (token !== lookupToken) {
					return;
				}
				if (!releaseId || options.hasMatch(next.album.id)) {
					continue;
				}
				options.onMatch(next.album.id, releaseId);
			}
		});

		await Promise.all(workers);
	}

	function invalidate(): void {
		lookupToken += 1;
	}

	function clearCache(): void {
		lookupCache.clear();
	}

	return {
		hydrate,
		invalidate,
		clearCache
	};
}
