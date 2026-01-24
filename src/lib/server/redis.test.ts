import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

const loadRedisModule = async (env: Record<string, string | undefined>, redisInstance?: object) => {
	vi.resetModules();
	process.env = { ...originalEnv, ...env };
	if (env.REDIS_DISABLED === undefined) {
		delete process.env.REDIS_DISABLED;
	}
	const constructor = vi.fn(() => redisInstance ?? { on: vi.fn(), disconnect: vi.fn() });
	vi.doMock('ioredis', () => ({ default: constructor }));
	const module = await vi.importActual<typeof import('./redis')>('./redis');
	return { module, constructor };
};

afterEach(() => {
	process.env = { ...originalEnv };
	vi.restoreAllMocks();
});

describe('redis server helpers', () => {
	it('returns null when redis is disabled via env', async () => {
		const { module } = await loadRedisModule({ REDIS_DISABLED: 'true' });
		expect(module.getRedisClient()).toBeNull();
		expect(module.isRedisEnabled()).toBe(false);
	});

	it('constructs a client from REDIS_URL and reports enabled', async () => {
		const { module, constructor } = await loadRedisModule({
			REDIS_URL: 'redis://localhost:6379'
		});
		const client = module.getRedisClient();
		expect(client).not.toBeNull();
		expect(constructor).toHaveBeenCalledWith('redis://localhost:6379', expect.any(Object));
		expect(module.isRedisEnabled()).toBe(true);
	});

	it('disables redis after manual disable call', async () => {
		const { module } = await loadRedisModule({ REDIS_URL: 'redis://localhost:6379' });
		expect(module.isRedisEnabled()).toBe(true);
		module.disableRedisClient(new Error('fail'));
		expect(module.isRedisEnabled()).toBe(false);
	});
});
