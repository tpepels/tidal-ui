import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SpyInstance } from 'vitest';
import { ApiCache } from './cache';

describe('ApiCache', () => {
	let cache: ApiCache;
	let mockNow: SpyInstance<[], number>;

	beforeEach(() => {
		vi.useFakeTimers();
		mockNow = vi.spyOn(Date, 'now').mockReturnValue(1000);
		cache = new ApiCache();
	});

	afterEach(() => {
		vi.useRealTimers();
		mockNow.mockRestore();
	});

	it('sets and gets data', () => {
		cache.set('key1', 'data1');
		expect(cache.get('key1')).toBe('data1');
	});

	it('returns null for non-existent key', () => {
		expect(cache.get('nonexistent')).toBeNull();
	});

	it('respects TTL and expires data', () => {
		cache.set('key1', 'data1', 1000); // 1 second TTL

		// Immediately after, should be valid
		expect(cache.get('key1')).toBe('data1');

		// Advance time by 999ms, still valid
		mockNow.mockReturnValue(1000 + 999);
		expect(cache.get('key1')).toBe('data1');

		// Advance by 1ms more, should expire
		mockNow.mockReturnValue(1000 + 1000 + 1);
		expect(cache.get('key1')).toBeNull();
	});

	it('evicts oldest entry when max size reached', () => {
		// Set max size to 2 for testing

		cache.set('key1', 'data1');
		cache.set('key2', 'data2');
		expect(cache.size()).toBe(2);

		// Add third, should evict key1
		cache.set('key3', 'data3');
		expect(cache.size()).toBe(2);
		expect(cache.get('key1')).toBeNull();
		expect(cache.get('key2')).toBe('data2');
		expect(cache.get('key3')).toBe('data3');
	});

	it('clears all entries', () => {
		cache.set('key1', 'data1');
		cache.set('key2', 'data2');
		expect(cache.size()).toBe(2);

		cache.clear();
		expect(cache.size()).toBe(0);
		expect(cache.get('key1')).toBeNull();
		expect(cache.get('key2')).toBeNull();
	});

	it('deletes specific key', () => {
		cache.set('key1', 'data1');
		cache.set('key2', 'data2');

		cache.delete('key1');
		expect(cache.get('key1')).toBeNull();
		expect(cache.get('key2')).toBe('data2');
		expect(cache.size()).toBe(1);
	});

	it('ignores delete for undefined key', () => {
		cache.set('key1', 'data1');
		cache.delete(undefined);
		expect(cache.get('key1')).toBe('data1');
	});

	it('returns correct size', () => {
		expect(cache.size()).toBe(0);
		cache.set('key1', 'data1');
		expect(cache.size()).toBe(1);
		cache.set('key2', 'data2');
		expect(cache.size()).toBe(2);
	});

	it('handles expired entries on get', () => {
		cache.set('key1', 'data1', 1000);
		mockNow.mockReturnValue(1000 + 1001);
		expect(cache.get('key1')).toBeNull();
		expect(cache.size()).toBe(0); // Should be removed
	});
});
