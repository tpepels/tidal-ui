import type {
	MusicBrainzLookupOptions,
	MusicBrainzLookupTrack,
	MusicBrainzRelease
} from './musicBrainzTypes';
import { buildMusicBrainzCacheKey } from './musicBrainzHelpers';
import type { CachedMusicBrainzTrackLookup } from '../features/track/trackMusicBrainzModel';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 800;

interface CacheEntry {
	expiresAt: number;
	lookup: CachedMusicBrainzTrackLookup;
}

interface ReleaseCacheEntry {
	expiresAt: number;
	release: MusicBrainzRelease | null;
}

const lookupCache = new Map<string, CacheEntry>();
const preferredReleaseCache = new Map<string, ReleaseCacheEntry>();

function pruneCacheIfNeeded(cache: Map<string, CacheEntry | ReleaseCacheEntry>): void {
	if (cache.size <= MAX_CACHE_ENTRIES) return;
	while (cache.size > MAX_CACHE_ENTRIES) {
		const firstKey = cache.keys().next().value;
		if (!firstKey) break;
		cache.delete(firstKey);
	}
}

export function buildCacheKey(
	track: MusicBrainzLookupTrack,
	options?: MusicBrainzLookupOptions
): string {
	return buildMusicBrainzCacheKey(track, options);
}

export function readLookupCache(cacheKey: string): CachedMusicBrainzTrackLookup | null {
	const cached = lookupCache.get(cacheKey);
	if (!cached) return null;
	if (cached.expiresAt <= Date.now()) {
		lookupCache.delete(cacheKey);
		return null;
	}
	return {
		...cached.lookup,
		tags: { ...cached.lookup.tags },
		match: cached.lookup.match
	};
}

export function writeLookupCache(cacheKey: string, lookup: CachedMusicBrainzTrackLookup): void {
	lookupCache.set(cacheKey, {
		expiresAt: Date.now() + CACHE_TTL_MS,
		lookup: {
			...lookup,
			tags: { ...lookup.tags },
			match: lookup.match
		}
	});
	pruneCacheIfNeeded(lookupCache);
}

export function readPreferredReleaseCache(
	releaseId: string
): MusicBrainzRelease | null | undefined {
	const cached = preferredReleaseCache.get(releaseId);
	if (!cached) return undefined;
	if (cached.expiresAt <= Date.now()) {
		preferredReleaseCache.delete(releaseId);
		return undefined;
	}
	return cached.release;
}

export function writePreferredReleaseCache(
	releaseId: string,
	release: MusicBrainzRelease | null
): void {
	preferredReleaseCache.set(releaseId, {
		expiresAt: Date.now() + CACHE_TTL_MS,
		release
	});
	pruneCacheIfNeeded(preferredReleaseCache);
}
