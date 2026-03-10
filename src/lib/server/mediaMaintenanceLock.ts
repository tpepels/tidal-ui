import { getConnectedRedis } from './redis';

const MEDIA_MAINTENANCE_LOCK_KEY =
	process.env.MEDIA_LIBRARY_MAINTENANCE_LOCK_KEY || 'tidal:media-library:maintenance-lock';
const MEDIA_MAINTENANCE_LOCK_TTL_MS = Math.max(
	15_000,
	Number(process.env.MEDIA_LIBRARY_MAINTENANCE_LOCK_TTL_MS || 120_000)
);
const MEDIA_MAINTENANCE_LOCK_HEARTBEAT_MS = Math.max(
	2_000,
	Number(process.env.MEDIA_LIBRARY_MAINTENANCE_LOCK_HEARTBEAT_MS || 10_000)
);
const MEDIA_MAINTENANCE_LOCK_ACQUIRE_POLL_MS = Math.max(
	100,
	Number(process.env.MEDIA_LIBRARY_MAINTENANCE_LOCK_ACQUIRE_POLL_MS || 500)
);

type LockPayload = {
	lockId: string;
	owner: string;
	acquiredAt: number;
};

type InMemoryLockState = LockPayload & {
	expiresAt: number;
};

let inMemoryLock: InMemoryLockState | null = null;

export type MediaMaintenanceLockHolder = {
	lockId: string;
	owner: string;
	acquiredAt: number;
	expiresAt?: number;
	ttlMs?: number;
	source: 'redis' | 'memory';
};

export type MediaMaintenanceLockHandle = {
	lockId: string;
	owner: string;
	acquiredAt: number;
	source: 'redis' | 'memory';
	release: () => Promise<void>;
};

export type AcquireMediaMaintenanceLockOptions = {
	owner: string;
	ttlMs?: number;
	heartbeatMs?: number;
	waitTimeoutMs?: number;
	pollIntervalMs?: number;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomLockId(): string {
	return `mlock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parsePayload(value: string | null | undefined): LockPayload | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value) as Partial<LockPayload>;
		if (
			parsed &&
			typeof parsed.lockId === 'string' &&
			typeof parsed.owner === 'string' &&
			typeof parsed.acquiredAt === 'number'
		) {
			return {
				lockId: parsed.lockId,
				owner: parsed.owner,
				acquiredAt: parsed.acquiredAt
			};
		}
	} catch {
		// Ignore malformed payloads.
	}
	return null;
}

function pruneExpiredMemoryLock(now = Date.now()): void {
	if (!inMemoryLock) return;
	if (inMemoryLock.expiresAt <= now) {
		inMemoryLock = null;
	}
}

function tryAcquireMemoryLock(payload: LockPayload, ttlMs: number): boolean {
	pruneExpiredMemoryLock();
	if (inMemoryLock) {
		return false;
	}
	inMemoryLock = {
		...payload,
		expiresAt: Date.now() + ttlMs
	};
	return true;
}

function renewMemoryLock(lockId: string, ttlMs: number): boolean {
	pruneExpiredMemoryLock();
	if (!inMemoryLock || inMemoryLock.lockId !== lockId) {
		return false;
	}
	inMemoryLock.expiresAt = Date.now() + ttlMs;
	return true;
}

function releaseMemoryLock(lockId: string): void {
	if (!inMemoryLock) return;
	if (inMemoryLock.lockId !== lockId) return;
	inMemoryLock = null;
}

function getMemoryLockHolder(): MediaMaintenanceLockHolder | null {
	pruneExpiredMemoryLock();
	if (!inMemoryLock) return null;
	return {
		lockId: inMemoryLock.lockId,
		owner: inMemoryLock.owner,
		acquiredAt: inMemoryLock.acquiredAt,
		expiresAt: inMemoryLock.expiresAt,
		ttlMs: Math.max(0, inMemoryLock.expiresAt - Date.now()),
		source: 'memory'
	};
}

export async function getMediaMaintenanceLockHolder(): Promise<MediaMaintenanceLockHolder | null> {
	const redis = await getConnectedRedis();
	if (redis) {
		try {
			const raw = await redis.get(MEDIA_MAINTENANCE_LOCK_KEY);
			const payload = parsePayload(raw);
			if (!payload) {
				return null;
			}
			const pttl = await redis.pttl(MEDIA_MAINTENANCE_LOCK_KEY);
			const ttlMs = pttl > 0 ? pttl : undefined;
			return {
				lockId: payload.lockId,
				owner: payload.owner,
				acquiredAt: payload.acquiredAt,
				expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
				ttlMs,
				source: 'redis'
			};
		} catch {
			// Fall back to in-memory state.
		}
	}
	return getMemoryLockHolder();
}

async function tryAcquireRedisLock(payload: LockPayload, ttlMs: number): Promise<boolean> {
	const redis = await getConnectedRedis();
	if (!redis) return false;
	const serialized = JSON.stringify(payload);
	try {
		const result = await redis.set(
			MEDIA_MAINTENANCE_LOCK_KEY,
			serialized,
			'PX',
			ttlMs,
			'NX'
		);
		return result === 'OK';
	} catch {
		return false;
	}
}

async function renewRedisLock(expectedValue: string, ttlMs: number): Promise<boolean> {
	const redis = await getConnectedRedis();
	if (!redis) return false;
	const script = `
		if redis.call("GET", KEYS[1]) == ARGV[1] then
			return redis.call("PEXPIRE", KEYS[1], ARGV[2])
		end
		return 0
	`;
	try {
		const result = await redis.eval(
			script,
			1,
			MEDIA_MAINTENANCE_LOCK_KEY,
			expectedValue,
			String(ttlMs)
		);
		return Number(result) === 1;
	} catch {
		return false;
	}
}

async function releaseRedisLock(expectedValue: string): Promise<void> {
	const redis = await getConnectedRedis();
	if (!redis) return;
	const script = `
		if redis.call("GET", KEYS[1]) == ARGV[1] then
			return redis.call("DEL", KEYS[1])
		end
		return 0
	`;
	try {
		await redis.eval(script, 1, MEDIA_MAINTENANCE_LOCK_KEY, expectedValue);
	} catch {
		// Ignore release failures (lease expiration eventually unlocks).
	}
}

function createLockHandle(options: {
	payload: LockPayload;
	source: 'redis' | 'memory';
	ttlMs: number;
	heartbeatMs: number;
}): MediaMaintenanceLockHandle {
	let released = false;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	const { payload, source, ttlMs, heartbeatMs } = options;
	const expectedRedisValue = JSON.stringify(payload);

	const renew = async (): Promise<boolean> => {
		if (source === 'redis') {
			return renewRedisLock(expectedRedisValue, ttlMs);
		}
		return renewMemoryLock(payload.lockId, ttlMs);
	};

	if (heartbeatMs > 0) {
		heartbeatTimer = setInterval(() => {
			void renew().then((stillHeld) => {
				if (!stillHeld && heartbeatTimer) {
					clearInterval(heartbeatTimer);
					heartbeatTimer = null;
				}
			});
		}, heartbeatMs);
		heartbeatTimer.unref?.();
	}

	return {
		lockId: payload.lockId,
		owner: payload.owner,
		acquiredAt: payload.acquiredAt,
		source,
		release: async () => {
			if (released) return;
			released = true;
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = null;
			}
			if (source === 'redis') {
				await releaseRedisLock(expectedRedisValue);
				return;
			}
			releaseMemoryLock(payload.lockId);
		}
	};
}

export async function acquireMediaMaintenanceLock(
	options: AcquireMediaMaintenanceLockOptions
): Promise<MediaMaintenanceLockHandle | null> {
	const owner = options.owner.trim();
	if (!owner) {
		throw new Error('Media maintenance lock owner is required');
	}
	const ttlMs = Math.max(10_000, Math.trunc(options.ttlMs ?? MEDIA_MAINTENANCE_LOCK_TTL_MS));
	const heartbeatMs = Math.min(
		Math.max(0, Math.trunc(options.heartbeatMs ?? MEDIA_MAINTENANCE_LOCK_HEARTBEAT_MS)),
		Math.max(0, ttlMs - 1_000)
	);
	const waitTimeoutMs = Math.max(0, Math.trunc(options.waitTimeoutMs ?? 0));
	const pollIntervalMs = Math.max(
		100,
		Math.trunc(options.pollIntervalMs ?? MEDIA_MAINTENANCE_LOCK_ACQUIRE_POLL_MS)
	);
	const deadline = Date.now() + waitTimeoutMs;

	while (true) {
		const payload: LockPayload = {
			lockId: randomLockId(),
			owner,
			acquiredAt: Date.now()
		};
		const redis = await getConnectedRedis();
		if (redis) {
			const acquired = await tryAcquireRedisLock(payload, ttlMs);
			if (acquired) {
				return createLockHandle({
					payload,
					source: 'redis',
					ttlMs,
					heartbeatMs
				});
			}
		} else if (tryAcquireMemoryLock(payload, ttlMs)) {
			return createLockHandle({
				payload,
				source: 'memory',
				ttlMs,
				heartbeatMs
			});
		}

		if (Date.now() >= deadline) {
			return null;
		}
		await sleep(pollIntervalMs);
	}
}
