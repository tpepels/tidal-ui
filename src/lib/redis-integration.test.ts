import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Redis integration tests - Redis is now assumed available as infrastructure
describe('Redis Integration Tests', () => {
	let Redis: any;
	let redis: any;

	beforeAll(async () => {
		try {
			// Import Redis dynamically to avoid issues when not available
			const redisModule = await import('ioredis');
			Redis = redisModule.default;

			redis = new Redis({
				host: 'localhost',
				port: 6379,
				lazyConnect: true
			});
			await redis.connect();
			const pong = await redis.ping(); // Test connection
			console.log('Redis connected:', pong);
		} catch (error) {
			console.warn('Redis not available for integration tests:', error);
			throw error;
		}
	});

	afterAll(async () => {
		if (redis) {
			await redis.quit();
		}
	});

	describe('Redis Operations', () => {
		it('should connect to Valkey/Redis', async () => {
			const pong = await redis.ping();
			expect(pong).toBe('PONG');
		});

		it('should set and get values', async () => {
			const key = 'test:key';
			const value = 'test-value';

			console.log('Setting key:', key, 'value:', value);
			const setResult = await redis.set(key, value);
			console.log('Set result:', setResult);

			const retrieved = await redis.get(key);
			console.log('Retrieved value:', retrieved);

			expect(retrieved).toBe(value);

			// Cleanup
			await redis.del(key);
		});

		it('should handle JSON serialization', async () => {
			const key = 'test:json';
			const obj = { test: 'data', number: 42, array: [1, 2, 3] };

			await redis.set(key, JSON.stringify(obj));
			const retrieved = await redis.get(key);
			const parsed = JSON.parse(retrieved);

			expect(parsed).toEqual(obj);

			// Cleanup
			await redis.del(key);
		});

		it('should handle expiration', async () => {
			const key = 'test:expire';
			const value = 'expires';

			await redis.set(key, value, 'EX', 1); // Expire in 1 second
			let retrieved = await redis.get(key);
			expect(retrieved).toBe(value);

			// Wait for expiration
			await new Promise((resolve) => setTimeout(resolve, 1100));

			retrieved = await redis.get(key);
			expect(retrieved).toBeNull();
		});
	});

	describe('Upload State Persistence', () => {
		it('should persist upload state to Redis', async () => {
			const key = 'tidal:uploadState';
			const testState = {
				pendingUploads: {
					'upload-1': {
						trackId: 123,
						quality: 'LOSSLESS',
						albumTitle: 'Test Album',
						artistName: 'Test Artist',
						trackTitle: 'Test Track',
						timestamp: Date.now(),
						totalSize: 1000000
					}
				},
				chunkUploads: {},
				activeUploads: ['upload-1'],
				timestamp: Date.now(),
				version: 1
			};

			// Set state
			await redis.set(key, JSON.stringify(testState));

			// Retrieve and verify
			const retrieved = await redis.get(key);
			const parsed = JSON.parse(retrieved);

			expect(parsed).toEqual(testState);
			expect(parsed.activeUploads).toContain('upload-1');

			// Cleanup
			await redis.del(key);
		});

		it('should handle concurrent Redis operations', async () => {
			const operations = [];
			const keyPrefix = 'test:concurrent:';

			// Create multiple concurrent operations
			for (let i = 0; i < 10; i++) {
				const key = `${keyPrefix}${i}`;
				const value = `value-${i}`;

				operations.push(redis.set(key, value).then(() => redis.get(key)));
			}

			const results = await Promise.all(operations);

			// Verify all operations completed
			results.forEach((result, index) => {
				expect(result).toBe(`value-${index}`);
			});

			// Cleanup
			const cleanupOps = [];
			for (let i = 0; i < 10; i++) {
				cleanupOps.push(redis.del(`${keyPrefix}${i}`));
			}
			await Promise.all(cleanupOps);
		});
	});
});
