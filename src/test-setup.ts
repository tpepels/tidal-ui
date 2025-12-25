// Test setup for vitest
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/svelte';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend expect with jest-dom matchers
expect.extend(matchers);

// Redis is assumed to be available as infrastructure
// Try to use real Redis first, fall back to mocks only if unavailable
let redisAvailable = false;

try {
	// Test Redis connection synchronously (this will throw if Redis not available)
	// We'll do this in a way that doesn't block the test setup
	const testRedisConnection = async () => {
		try {
			const { default: Redis } = await import('ioredis');
			const redis = new Redis({
				host: 'localhost',
				port: 6379,
				lazyConnect: true,
				connectTimeout: 1000, // 1 second timeout
				maxRetriesPerRequest: 0
			});

			await redis.connect();
			await redis.ping();
			await redis.quit();
			return true;
		} catch (error) {
			console.warn(
				'Redis not available for tests, using mocks:',
				error instanceof Error ? error.message : String(error)
			);
			return false;
		}
	};

	// Run connection test
	redisAvailable = await testRedisConnection();
} catch (error) {
	console.warn(
		'Error testing Redis connection, using mocks:',
		error instanceof Error ? error.message : String(error)
	);
	redisAvailable = false;
}

if (!redisAvailable) {
	console.log('🔄 Using Redis mocks for tests (Redis not available)');

	// Mock ioredis when Redis is not available
	vi.mock('ioredis', () => ({
		default: vi.fn().mockImplementation(() => ({
			get: vi.fn(),
			set: vi.fn(),
			del: vi.fn(),
			ping: vi.fn().mockResolvedValue('PONG'),
			on: vi.fn(),
			connect: vi.fn(),
			disconnect: vi.fn(),
			quit: vi.fn()
		}))
	}));
} else {
	console.log('✅ Using real Redis for tests');

	// Don't mock ioredis when Redis is available
	vi.unmock('ioredis');
}

// Mock SvelteKit $lib and $app imports
vi.mock('$lib/utils/audioQuality', () => ({
	deriveTrackQuality: vi.fn(() => 'LOSSLESS')
}));

vi.mock('$lib/utils/urlParser', () => ({
	parseTidalUrl: vi.fn(() => ({ type: 'track', id: '123' }))
}));

vi.mock('$lib/utils', () => ({
	formatArtistsForMetadata: vi.fn(() => 'Artist'),
	formatArtists: vi.fn(() => 'Artist')
}));

vi.mock('$lib/stores/region', () => ({
	type: 'RegionOption',
	defaultRegion: { code: 'US', name: 'United States' }
}));

vi.mock('$lib/config', () => ({
	API_CONFIG: {
		baseUrl: 'http://localhost:3000',
		targets: [{ name: 'local', baseUrl: 'http://localhost:3000', weight: 1 }],
		useProxy: false,
		proxyUrl: ''
	},
	fetchWithCORS: vi.fn(),
	selectApiTargetForRegion: vi.fn(() => ({
		name: 'local',
		baseUrl: 'http://localhost:3000',
		weight: 1
	}))
}));

vi.mock('$lib/version', () => ({
	APP_VERSION: 'v3.3'
}));

vi.mock('$app/environment', () => ({
	dev: false,
	browser: false,
	building: false,
	version: '3.3'
}));

// Cleanup after each test
afterEach(() => {
	cleanup();
});
