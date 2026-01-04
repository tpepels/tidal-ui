import { describe, expect, it } from 'vitest';
import {
	createCacheKey,
	getCacheTtlSeconds,
	hasDisqualifyingCacheControl,
	isCacheableContentType,
	sanitizeHeaderEntries
} from './proxyCache';

describe('proxyCache', () => {
	it('sanitizes unsafe headers', () => {
		const entries: Array<[string, string]> = [
			['Content-Encoding', 'gzip'],
			['Content-Length', '123'],
			['Cache-Control', 'max-age=60']
		];
		expect(sanitizeHeaderEntries(entries)).toEqual([['Cache-Control', 'max-age=60']]);
	});

	it('classifies cacheable content types and cache-control', () => {
		expect(isCacheableContentType('application/json; charset=utf-8')).toBe(true);
		expect(isCacheableContentType('text/html')).toBe(true);
		expect(isCacheableContentType('image/png')).toBe(false);
		expect(hasDisqualifyingCacheControl('no-store')).toBe(true);
		expect(hasDisqualifyingCacheControl('private, max-age=0')).toBe(true);
		expect(hasDisqualifyingCacheControl('public, max-age=60')).toBe(false);
	});

	it('selects TTL based on URL path', () => {
		const config = { defaultTtlSeconds: 60, searchTtlSeconds: 10, trackTtlSeconds: 5 };
		expect(getCacheTtlSeconds(new URL('https://api.test/track/1'), config)).toBe(5);
		expect(getCacheTtlSeconds(new URL('https://api.test/search/items?q=1'), config)).toBe(10);
		expect(getCacheTtlSeconds(new URL('https://api.test/album/1'), config)).toBe(60);
	});

	it('creates deterministic cache keys', () => {
		const url = new URL('https://api.test/track/1');
		const headers = new Headers({ accept: 'application/json', range: 'bytes=0-10' });
		const key = createCacheKey(url, headers, 'ns:');
		expect(key.startsWith('ns:')).toBe(true);
	});
});
