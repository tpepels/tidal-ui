import { describe, expect, it, vi } from 'vitest';

vi.mock('./redis', () => ({
	getConnectedRedis: vi.fn(async () => null)
}));

import {
	acquireMediaMaintenanceLock,
	getMediaMaintenanceLockHolder
} from './mediaMaintenanceLock';

describe('mediaMaintenanceLock (memory fallback)', () => {
	it('returns conflict while lock is held, then allows acquire after release', async () => {
		const first = await acquireMediaMaintenanceLock({
			owner: 'test:first',
			ttlMs: 5_000,
			heartbeatMs: 0,
			waitTimeoutMs: 0
		});
		expect(first).toBeTruthy();
		expect(first?.source).toBe('memory');

		const second = await acquireMediaMaintenanceLock({
			owner: 'test:second',
			ttlMs: 5_000,
			heartbeatMs: 0,
			waitTimeoutMs: 0
		});
		expect(second).toBeNull();

		const holder = await getMediaMaintenanceLockHolder();
		expect(holder?.owner).toBe('test:first');

		await first?.release();

		const third = await acquireMediaMaintenanceLock({
			owner: 'test:third',
			ttlMs: 5_000,
			heartbeatMs: 0,
			waitTimeoutMs: 0
		});
		expect(third).toBeTruthy();
		await third?.release();
	});
});
