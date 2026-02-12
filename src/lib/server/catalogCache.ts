import { env } from '$env/dynamic/private';
import type Redis from 'ioredis';
import type { Album } from '$lib/types';
import { getConnectedRedis } from '$lib/server/redis';

const OFFICIAL_CACHE_PREFIX = 'tidal:catalog:official-discography:v1:';
const DEFAULT_CACHE_TTL_SECONDS = getEnvNumber('TIDAL_OFFICIAL_DISCOGRAPHY_CACHE_TTL_SECONDS', 172800);
const EMPTY_CACHE_TTL_SECONDS = getEnvNumber('TIDAL_OFFICIAL_DISCOGRAPHY_EMPTY_TTL_SECONDS', 172800);
const MEMORY_CACHE_MAX_ENTRIES = getEnvNumber('TIDAL_OFFICIAL_DISCOGRAPHY_MEMORY_MAX_ENTRIES', 500);
const SCAN_BATCH_SIZE = 200;

type OfficialDiscographyCacheEntry = {
	albums: Album[];
	expiresAt: number;
};

const memoryCache = new Map<string, OfficialDiscographyCacheEntry>();

function getEnvNumber(name: string, fallback: number): number {
	const raw = env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toCacheKey(artistId: number, countryCode: string): string {
	return `${OFFICIAL_CACHE_PREFIX}${countryCode.toUpperCase()}:${artistId}`;
}

function nowMs(): number {
	return Date.now();
}

function getTtlSecondsForAlbums(albums: Album[]): number {
	return albums.length > 0 ? DEFAULT_CACHE_TTL_SECONDS : EMPTY_CACHE_TTL_SECONDS;
}

function getFromMemory(cacheKey: string): Album[] | null {
	const entry = memoryCache.get(cacheKey);
	if (!entry) return null;
	if (entry.expiresAt <= nowMs()) {
		memoryCache.delete(cacheKey);
		return null;
	}
	return entry.albums;
}

function setInMemory(cacheKey: string, albums: Album[], ttlSeconds: number): void {
	if (ttlSeconds <= 0) {
		memoryCache.delete(cacheKey);
		return;
	}
	if (memoryCache.has(cacheKey)) {
		memoryCache.delete(cacheKey);
	}
	memoryCache.set(cacheKey, {
		albums,
		expiresAt: nowMs() + ttlSeconds * 1000
	});
	while (memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
		const oldest = memoryCache.keys().next().value;
		if (!oldest) break;
		memoryCache.delete(oldest);
	}
}

export async function getCachedOfficialArtistAlbums(
	artistId: number,
	countryCode: string
): Promise<Album[] | null> {
	const cacheKey = toCacheKey(artistId, countryCode);
	const cached = getFromMemory(cacheKey);
	if (cached) {
		return cached;
	}

	const redis = await getConnectedRedis();
	if (!redis) {
		return null;
	}

	try {
		const raw = await redis.get(cacheKey);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<OfficialDiscographyCacheEntry>;
		if (!Array.isArray(parsed.albums) || typeof parsed.expiresAt !== 'number') {
			await redis.del(cacheKey);
			return null;
		}
		const remainingMs = parsed.expiresAt - nowMs();
		if (remainingMs <= 0) {
			await redis.del(cacheKey);
			return null;
		}
		setInMemory(cacheKey, parsed.albums as Album[], Math.ceil(remainingMs / 1000));
		return parsed.albums as Album[];
	} catch (error) {
		console.warn('[CatalogCache] Failed to read official discography cache:', error);
		return null;
	}
}

export async function setCachedOfficialArtistAlbums(
	artistId: number,
	countryCode: string,
	albums: Album[]
): Promise<void> {
	const ttlSeconds = getTtlSecondsForAlbums(albums);
	const cacheKey = toCacheKey(artistId, countryCode);
	setInMemory(cacheKey, albums, ttlSeconds);

	const redis = await getConnectedRedis();
	if (!redis) {
		return;
	}

	try {
		const payload: OfficialDiscographyCacheEntry = {
			albums,
			expiresAt: nowMs() + ttlSeconds * 1000
		};
		await redis.set(cacheKey, JSON.stringify(payload), 'EX', ttlSeconds);
	} catch (error) {
		console.warn('[CatalogCache] Failed to persist official discography cache:', error);
	}
}

export function clearOfficialDiscographyMemoryCache(): number {
	const count = memoryCache.size;
	memoryCache.clear();
	return count;
}

async function scanDeleteByPrefix(redis: Redis, prefix: string): Promise<number> {
	let cursor = '0';
	let deleted = 0;
	do {
		const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', `${SCAN_BATCH_SIZE}`);
		if (keys.length > 0) {
			deleted += await redis.del(...keys);
		}
		cursor = nextCursor;
	} while (cursor !== '0');
	return deleted;
}

export async function clearOfficialDiscographyRedisCache(): Promise<number> {
	const redis = await getConnectedRedis();
	if (!redis) return 0;
	try {
		return await scanDeleteByPrefix(redis, OFFICIAL_CACHE_PREFIX);
	} catch (error) {
		console.warn('[CatalogCache] Failed to clear official discography Redis cache:', error);
		return 0;
	}
}
