import type { ArtistDetails } from '$lib/types';

type ArtistCacheEntry = {
	artist: ArtistDetails;
	expiresAt: number;
	sizeBytes: number;
	lastAccessedAt: number;
};

type PersistedArtistCacheEntry = {
	artist: ArtistDetails;
	expiresAt: number;
	sizeBytes: number;
	lastAccessedAt: number;
};

const artistCache = new Map<number, ArtistCacheEntry>();
const STORAGE_KEY = 'tidal-ui:artist-cache';
const isBrowserEnvironment = (): boolean => typeof window !== 'undefined';
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_TELEMETRY_LOG_THROTTLE_MS = 30_000;

export const ARTIST_CACHE_MAX_ENTRIES = 80;
export const ARTIST_CACHE_MAX_TOTAL_BYTES = 3_000_000;

let hasHydratedFromSession = false;
let accessTick = 0;
const telemetryLastLogAt = new Map<string, number>();

const normalizeCover = (value: string | null | undefined): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

function nextAccessTick(): number {
	accessTick += 1;
	return accessTick;
}

function logCacheTelemetry(event: string, message: string, details?: Record<string, unknown>): void {
	const now = Date.now();
	const lastLog = telemetryLastLogAt.get(event) ?? 0;
	if (now - lastLog < CACHE_TELEMETRY_LOG_THROTTLE_MS) {
		return;
	}
	telemetryLastLogAt.set(event, now);
	if (details) {
		console.warn(`[artistCache] ${message}`, details);
		return;
	}
	console.warn(`[artistCache] ${message}`);
}

function estimateArtistSizeBytes(artist: ArtistDetails): number {
	try {
		const serialized = JSON.stringify(artist);
		if (typeof TextEncoder !== 'undefined') {
			return new TextEncoder().encode(serialized).byteLength;
		}
		return serialized.length;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

function getTotalCacheBytes(): number {
	let total = 0;
	for (const entry of artistCache.values()) {
		total += entry.sizeBytes;
	}
	return total;
}

function removeExpiredEntries(now = Date.now()): boolean {
	let removed = false;
	for (const [artistId, entry] of artistCache.entries()) {
		if (entry.expiresAt > now) {
			continue;
		}
		artistCache.delete(artistId);
		removed = true;
	}
	return removed;
}

function findLeastRecentlyUsedArtistId(): number | null {
	let lruArtistId: number | null = null;
	let lruAccessTick = Number.POSITIVE_INFINITY;
	for (const [artistId, entry] of artistCache.entries()) {
		if (entry.lastAccessedAt < lruAccessTick) {
			lruArtistId = artistId;
			lruAccessTick = entry.lastAccessedAt;
		}
	}
	return lruArtistId;
}

function enforceCacheBounds(): void {
	removeExpiredEntries();
	let totalBytes = getTotalCacheBytes();
	let evictedEntries = 0;

	while (
		artistCache.size > 0 &&
		(artistCache.size > ARTIST_CACHE_MAX_ENTRIES || totalBytes > ARTIST_CACHE_MAX_TOTAL_BYTES)
	) {
		const lruArtistId = findLeastRecentlyUsedArtistId();
		if (lruArtistId === null) {
			break;
		}
		const removed = artistCache.get(lruArtistId);
		artistCache.delete(lruArtistId);
		if (removed) {
			totalBytes = Math.max(0, totalBytes - removed.sizeBytes);
			evictedEntries += 1;
		}
	}

	if (evictedEntries > 0) {
		logCacheTelemetry('eviction', 'Evicted artist cache entries due bounded policy', {
			evictedEntries,
			totalEntries: artistCache.size,
			totalBytes
		});
	}
}

function createCacheEntry(
	artist: ArtistDetails,
	expiresAt = Date.now() + CACHE_TTL_MS
): ArtistCacheEntry | null {
	const sizeBytes = estimateArtistSizeBytes(artist);
	if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
		logCacheTelemetry('invalid-size', 'Skipped artist cache write due invalid size estimate', {
			artistId: artist.id
		});
		return null;
	}

	if (sizeBytes > ARTIST_CACHE_MAX_TOTAL_BYTES) {
		logCacheTelemetry('oversized-entry', 'Skipped artist cache write due oversized entry', {
			artistId: artist.id,
			sizeBytes,
			maxBytes: ARTIST_CACHE_MAX_TOTAL_BYTES
		});
		return null;
	}

	return {
		artist,
		expiresAt,
		sizeBytes,
		lastAccessedAt: nextAccessTick()
	};
}

function writeEntry(artistId: number, artist: ArtistDetails, expiresAt?: number): boolean {
	const entry = createCacheEntry(artist, expiresAt);
	if (!entry) {
		artistCache.delete(artistId);
		return false;
	}
	artistCache.set(artistId, entry);
	enforceCacheBounds();
	return artistCache.has(artistId);
}

function normalizeStoredEntry(value: unknown, now: number): ArtistCacheEntry | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Partial<PersistedArtistCacheEntry> & { artist?: unknown };
	const rawArtist =
		candidate.artist && typeof candidate.artist === 'object'
			? (candidate.artist as ArtistDetails)
			: (value as ArtistDetails);

	if (!rawArtist || typeof rawArtist !== 'object') {
		return null;
	}

	const artistId = Number((rawArtist as { id?: unknown }).id);
	if (!Number.isFinite(artistId) || artistId <= 0) {
		return null;
	}

	const expiresAt =
		typeof candidate.expiresAt === 'number' && Number.isFinite(candidate.expiresAt)
			? candidate.expiresAt
			: now + CACHE_TTL_MS;

	if (expiresAt <= now) {
		return null;
	}

	const sizeBytes =
		typeof candidate.sizeBytes === 'number' && Number.isFinite(candidate.sizeBytes)
			? candidate.sizeBytes
			: estimateArtistSizeBytes(rawArtist);

	if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > ARTIST_CACHE_MAX_TOTAL_BYTES) {
		return null;
	}

	const lastAccessedAt =
		typeof candidate.lastAccessedAt === 'number' && Number.isFinite(candidate.lastAccessedAt)
			? candidate.lastAccessedAt
			: nextAccessTick();

	return {
		artist: rawArtist,
		expiresAt,
		sizeBytes,
		lastAccessedAt
	};
}

const patchEntryAlbumCover = (
	entry: ArtistCacheEntry,
	albumId: number,
	cover: string
): ArtistCacheEntry | null => {
	let changed = false;

	const albums = entry.artist.albums.map((album) => {
		if (album.id !== albumId) return album;
		if (album.cover === cover) return album;
		changed = true;
		return { ...album, cover };
	});

	const tracks = entry.artist.tracks.map((track) => {
		if (!track.album || track.album.id !== albumId) return track;
		if (track.album.cover === cover) return track;
		changed = true;
		return {
			...track,
			album: {
				...track.album,
				cover
			}
		};
	});

	if (!changed) {
		return null;
	}

	const patchedArtist: ArtistDetails = {
		...entry.artist,
		albums,
		tracks
	};

	const patchedEntry = createCacheEntry(patchedArtist, entry.expiresAt);
	if (!patchedEntry) {
		return null;
	}

	return patchedEntry;
};

const hydrateFromSession = () => {
	if (!isBrowserEnvironment() || hasHydratedFromSession) {
		return;
	}

	hasHydratedFromSession = true;

	try {
		const stored = sessionStorage.getItem(STORAGE_KEY);
		if (!stored) return;
		const parsed = JSON.parse(stored) as Record<string, unknown>;
		const now = Date.now();
		for (const [id, value] of Object.entries(parsed)) {
			const numericId = Number(id);
			if (!Number.isFinite(numericId) || numericId <= 0) continue;
			const entry = normalizeStoredEntry(value, now);
			if (!entry) continue;
			artistCache.set(numericId, entry);
		}
		enforceCacheBounds();
	} catch (error) {
		logCacheTelemetry('hydrate-failed', 'Failed to hydrate artist cache from session storage', {
			errorName:
				error instanceof Error ? error.name : typeof error === 'object' && error ? 'Object' : 'Unknown'
		});
	}
};

const persistToSession = () => {
	if (!isBrowserEnvironment()) return;
	try {
		enforceCacheBounds();
		removeExpiredEntries();
		const payload: Record<string, PersistedArtistCacheEntry> = {};
		for (const [id, entry] of artistCache.entries()) {
			payload[id.toString()] = {
				artist: entry.artist,
				expiresAt: entry.expiresAt,
				sizeBytes: entry.sizeBytes,
				lastAccessedAt: entry.lastAccessedAt
			};
		}
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch (error) {
		const quotaExceeded =
			error instanceof DOMException &&
			(error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');

		logCacheTelemetry(
			quotaExceeded ? 'persist-quota' : 'persist-failed',
			quotaExceeded
				? 'Session storage quota exceeded while persisting artist cache'
				: 'Failed to persist artist cache to session storage',
			{
				entries: artistCache.size,
				totalBytes: getTotalCacheBytes()
			}
		);
	}
};

export const artistCacheStore = {
	get(id: number): ArtistDetails | undefined {
		hydrateFromSession();
		const entry = artistCache.get(id);
		if (!entry) return undefined;
		if (entry.expiresAt <= Date.now()) {
			artistCache.delete(id);
			persistToSession();
			return undefined;
		}
		entry.lastAccessedAt = nextAccessTick();
		return entry.artist;
	},
	set(artist: ArtistDetails): void {
		hydrateFromSession();
		const artistId = Number(artist.id);
		if (!Number.isFinite(artistId) || artistId <= 0) {
			return;
		}
		writeEntry(artistId, artist);
		persistToSession();
	},
	upsertAlbumCover(artistId: number, albumId: number, cover: string): void {
		hydrateFromSession();
		const normalizedCover = normalizeCover(cover);
		if (!normalizedCover || !Number.isFinite(artistId) || !Number.isFinite(albumId)) {
			return;
		}

		const entry = artistCache.get(artistId);
		if (!entry || entry.expiresAt <= Date.now()) {
			return;
		}

		const patched = patchEntryAlbumCover(entry, albumId, normalizedCover);
		if (!patched) {
			return;
		}

		artistCache.set(artistId, patched);
		enforceCacheBounds();
		persistToSession();
	},
	upsertAlbumCoverGlobally(albumId: number, cover: string): void {
		hydrateFromSession();
		const normalizedCover = normalizeCover(cover);
		if (!normalizedCover || !Number.isFinite(albumId)) {
			return;
		}

		const now = Date.now();
		let changed = false;
		for (const [artistId, entry] of artistCache.entries()) {
			if (entry.expiresAt <= now) {
				artistCache.delete(artistId);
				changed = true;
				continue;
			}

			const patched = patchEntryAlbumCover(entry, albumId, normalizedCover);
			if (!patched) {
				continue;
			}
			artistCache.set(artistId, patched);
			changed = true;
		}

		if (changed) {
			enforceCacheBounds();
			persistToSession();
		}
	},
	clear(): void {
		artistCache.clear();
		hasHydratedFromSession = true;
		if (!isBrowserEnvironment()) return;
		try {
			sessionStorage.removeItem(STORAGE_KEY);
		} catch {
			// Ignore session storage cache errors.
		}
	}
};
