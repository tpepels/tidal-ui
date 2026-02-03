// Test setup for vitest
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/svelte';
import * as matchers from '@testing-library/jest-dom/matchers';
import { existsSync, writeFileSync } from 'node:fs';

const LOCAL_STORAGE_FILE = '.node-localstorage';
const ensureLocalStorageFlag = (argv: string[]) => {
	const flag = '--localstorage-file';
	const prefix = `${flag}=`;
	const flagIndex = argv.indexOf(flag);
	if (flagIndex !== -1) {
		const nextArg = argv[flagIndex + 1];
		const hasValidPath = Boolean(nextArg) && !nextArg.startsWith('-');
		if (!hasValidPath) {
			argv.splice(flagIndex + 1, nextArg ? 1 : 0, LOCAL_STORAGE_FILE);
		}
		return;
	}
	const prefixedIndex = argv.findIndex((arg) => arg.startsWith(prefix));
	if (prefixedIndex !== -1) {
		const value = argv[prefixedIndex].slice(prefix.length);
		if (!value || value.startsWith('-')) {
			argv[prefixedIndex] = `${prefix}${LOCAL_STORAGE_FILE}`;
		}
	}
};

if (!existsSync(LOCAL_STORAGE_FILE)) {
	writeFileSync(LOCAL_STORAGE_FILE, '');
}

ensureLocalStorageFlag(process.execArgv);
ensureLocalStorageFlag(process.argv);

// Extend expect with jest-dom matchers
expect.extend(matchers);

// Redis is assumed to be available as infrastructure
// Try to use real Redis first, fall back to mocks only if unavailable
const redisProbeState = globalThis as {
	__REDIS_AVAILABLE?: boolean;
	__REDIS_LOGGED?: boolean;
};
let redisAvailable = redisProbeState.__REDIS_AVAILABLE ?? false;

try {
	if (redisProbeState.__REDIS_AVAILABLE === undefined) {
		// Test Redis connection synchronously (this will throw if Redis not available)
		// We'll do this in a way that doesn't block the test setup
		const testRedisConnection = async () => {
			try {
				const { default: Redis } = await import('ioredis');
				const tryConnect = async (url: string) => {
					const redis = new Redis(url, {
						lazyConnect: true,
						connectTimeout: 1000, // 1 second timeout
						maxRetriesPerRequest: 0,
						enableOfflineQueue: false
					});
					redis.on('error', () => {
						// Swallow connection errors during availability probe.
					});
					try {
						await redis.connect();
						await redis.ping();
						await redis.quit();
						return true;
					} catch {
						try {
							redis.disconnect();
						} catch {
							// ignore disconnect errors
						}
						return false;
					}
				};

				const envUrl = process.env.REDIS_URL;
				const primaryUrl = envUrl || 'redis://127.0.0.1:6379';
				if (await tryConnect(primaryUrl)) {
					process.env.REDIS_URL ??= primaryUrl;
					return true;
				}
				if (envUrl) {
					const fallbackUrl = 'redis://127.0.0.1:6379';
					if (await tryConnect(fallbackUrl)) {
						process.env.REDIS_URL = fallbackUrl;
						return true;
					}
				}
				return false;
			} catch (error) {
				if (!redisProbeState.__REDIS_LOGGED) {
					console.info(
						'Redis not available for tests, using mocks:',
						error instanceof Error ? error.message : String(error)
					);
					redisProbeState.__REDIS_LOGGED = true;
				}
				return false;
			}
		};

		// Run connection test
		redisAvailable = await testRedisConnection();
		redisProbeState.__REDIS_AVAILABLE = redisAvailable;
	}
} catch (error) {
	if (!redisProbeState.__REDIS_LOGGED) {
		console.info(
			'Error testing Redis connection, using mocks:',
			error instanceof Error ? error.message : String(error)
		);
		redisProbeState.__REDIS_LOGGED = true;
	}
	redisAvailable = false;
}

if (!redisAvailable) {
	if (!redisProbeState.__REDIS_LOGGED) {
		console.log('🔄 Using Redis mocks for tests (Redis not available)');
		redisProbeState.__REDIS_LOGGED = true;
	}
	process.env.REDIS_DISABLED = 'true';
	(globalThis as { __REDIS_AVAILABLE?: boolean }).__REDIS_AVAILABLE = false;

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
	(globalThis as { __REDIS_AVAILABLE?: boolean }).__REDIS_AVAILABLE = true;

	// Don't mock ioredis when Redis is available
	vi.unmock('ioredis');
}

// Mock SvelteKit $lib and $app imports
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
	fetchWithCORS: vi.fn((url: string, options?: RequestInit) => fetch(url, options)),
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
	browser: typeof window !== 'undefined',
	building: false,
	version: '3.3'
}));

const storage = new Map<string, string>();
const localStorageMock = {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => {
		storage.set(key, String(value));
	},
	removeItem: (key: string) => {
		storage.delete(key);
	},
	clear: () => {
		storage.clear();
	},
	key: (index: number) => Array.from(storage.keys())[index] ?? null,
	get length() {
		return storage.size;
	}
};

Object.defineProperty(globalThis, 'localStorage', {
	value: localStorageMock,
	writable: true,
	configurable: true
});

// Cleanup after each test
afterEach(() => {
	cleanup();
});
