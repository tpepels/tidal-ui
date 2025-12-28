import Redis, { type RedisOptions } from 'ioredis';
import { env } from '$env/dynamic/private';

let client: Redis | null | undefined;
let redisUnavailable = false;
let hasLoggedError = false;

function isRedisDisabled(): boolean {
	const flag = (env.REDIS_DISABLED || '').toLowerCase();
	return flag === 'true' || flag === '1';
}

function markRedisUnavailable(error: unknown): void {
	logRedisError(error);
	redisUnavailable = true;
	if (client) {
		try {
			client.disconnect();
		} catch {
			// ignore disconnect errors
		}
		client = null;
	}
}

export function disableRedisClient(error?: unknown): void {
	markRedisUnavailable(error);
}

function logRedisError(error: unknown): void {
	if (hasLoggedError) return;
	hasLoggedError = true;
	console.error('Redis connection error:', error);
}

function buildOptions(): RedisOptions | string | null {
	const url = env.REDIS_URL || env.REDIS_CONNECTION_STRING;
	if (url) {
		return url;
	}

	const host = env.REDIS_HOST || 'localhost';
	const port = env.REDIS_PORT ? Number.parseInt(env.REDIS_PORT, 10) : 6379;
	const tlsEnabled = (env.REDIS_TLS || '').toLowerCase() === 'true';

	const options: RedisOptions = {
		host,
		port,
		password: env.REDIS_PASSWORD,
		username: env.REDIS_USERNAME,
		lazyConnect: true
	};

	if (tlsEnabled) {
		options.tls = {};
	}

	return options;
}

export function getRedisClient(): Redis | null {
	if (client !== undefined) {
		return client;
	}

	if (isRedisDisabled()) {
		client = null;
		return client;
	}

	if (redisUnavailable) {
		client = null;
		return client;
	}

	const options = buildOptions();
	if (!options) {
		client = null;
		return client;
	}

	try {
		client =
			typeof options === 'string'
				? new Redis(options, {
						lazyConnect: true,
						maxRetriesPerRequest: 0,
						enableOfflineQueue: false,
						connectTimeout: 1000
					})
				: new Redis({
						...options,
						lazyConnect: true,
						maxRetriesPerRequest: 0,
						enableOfflineQueue: false,
						connectTimeout: 1000
					});
		client.on('error', markRedisUnavailable);
		return client;
	} catch (error) {
		markRedisUnavailable(error);
		return client;
	}
}

export function isRedisEnabled(): boolean {
	if (isRedisDisabled()) {
		return false;
	}

	if (redisUnavailable) {
		return false;
	}

	return getRedisClient() !== null;
}
