import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type Redis from 'ioredis';
import { getConnectedRedis } from '$lib/server/redis';
import {
	clearOfficialDiscographyMemoryCache,
	clearOfficialDiscographyRedisCache
} from '$lib/server/catalogCache';

const PROXY_CACHE_PREFIX = 'tidal:proxy:v2:';
const SCAN_BATCH_SIZE = 200;

async function scanDeleteByPrefix(redis: Redis, prefix: string): Promise<number> {
	let cursor = '0';
	let deleted = 0;
	do {
		const [nextCursor, keys] = await redis.scan(
			cursor,
			'MATCH',
			`${prefix}*`,
			'COUNT',
			`${SCAN_BATCH_SIZE}`
		);
		if (keys.length > 0) {
			deleted += await redis.del(...keys);
		}
		cursor = nextCursor;
	} while (cursor !== '0');
	return deleted;
}

export const POST: RequestHandler = async () => {
	const officialMemoryCleared = clearOfficialDiscographyMemoryCache();
	const officialRedisCleared = await clearOfficialDiscographyRedisCache();

	let proxyRedisCleared = 0;
	const redis = await getConnectedRedis();
	if (redis) {
		try {
			proxyRedisCleared = await scanDeleteByPrefix(redis, PROXY_CACHE_PREFIX);
		} catch (error) {
			console.warn('[CacheClear] Failed to clear proxy Redis cache:', error);
		}
	}

	return json({
		ok: true,
		cleared: {
			officialMemoryCleared,
			officialRedisCleared,
			proxyRedisCleared
		}
	});
};

