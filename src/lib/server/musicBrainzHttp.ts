import { delay } from './musicBrainzHelpers';

export const MUSICBRAINZ_API_BASE = 'https://musicbrainz.org/ws/2';

const MUSICBRAINZ_TIMEOUT_MS = 7_500;
const MUSICBRAINZ_MIN_INTERVAL_MS = 1_100;
const MUSICBRAINZ_MAX_RETRIES = 2;
const MUSICBRAINZ_RETRY_BASE_MS = 900;

export class MusicBrainzHttpError extends Error {
	status: number;
	url: string;
	retryAfterMs?: number;

	constructor(status: number, url: string, retryAfterMs?: number) {
		super(`MusicBrainz HTTP ${status}`);
		this.name = 'MusicBrainzHttpError';
		this.status = status;
		this.url = url;
		this.retryAfterMs = retryAfterMs;
	}
}

let nextRequestAt = 0;
let requestChain: Promise<void> = Promise.resolve();

function parseRetryAfterMs(value: string | null): number | undefined {
	if (!value) return undefined;
	const numericSeconds = Number.parseInt(value.trim(), 10);
	if (Number.isFinite(numericSeconds) && numericSeconds > 0) {
		return numericSeconds * 1000;
	}
	const targetDateMs = Date.parse(value);
	if (Number.isFinite(targetDateMs)) {
		const delta = targetDateMs - Date.now();
		if (delta > 0) {
			return delta;
		}
	}
	return undefined;
}

function shouldRetryMusicBrainzError(error: unknown): boolean {
	if (error instanceof MusicBrainzHttpError) {
		return error.status === 429 || error.status === 408 || (error.status >= 500 && error.status < 600);
	}
	if (error instanceof DOMException && error.name === 'AbortError') {
		return true;
	}
	if (error instanceof TypeError) {
		return true;
	}
	return false;
}

function retryDelayMsForMusicBrainz(error: unknown, attempt: number): number {
	if (error instanceof MusicBrainzHttpError && error.retryAfterMs) {
		return Math.min(15_000, Math.max(MUSICBRAINZ_RETRY_BASE_MS, error.retryAfterMs));
	}
	const multiplier = Math.max(1, attempt + 1);
	return Math.min(10_000, MUSICBRAINZ_RETRY_BASE_MS * multiplier);
}

async function scheduleRateLimited<T>(request: () => Promise<T>): Promise<T> {
	const runner = async (): Promise<T> => {
		const waitMs = nextRequestAt - Date.now();
		if (waitMs > 0) {
			await delay(waitMs);
		}
		nextRequestAt = Date.now() + MUSICBRAINZ_MIN_INTERVAL_MS;
		return request();
	};

	const resultPromise = requestChain.then(runner, runner);
	requestChain = resultPromise.then(
		() => undefined,
		() => undefined
	);
	return resultPromise;
}

function musicBrainzUserAgent(): string {
	const envAgent = process.env.MUSICBRAINZ_USER_AGENT;
	if (typeof envAgent === 'string' && envAgent.trim().length > 0) {
		return envAgent.trim();
	}
	return 'BiniLossless/1.0 (+https://music.binimum.org)';
}

export async function fetchMusicBrainzJson<T>(url: string): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= MUSICBRAINZ_MAX_RETRIES; attempt += 1) {
		try {
			return await scheduleRateLimited(async () => {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), MUSICBRAINZ_TIMEOUT_MS);
				try {
					const response = await fetch(url, {
						headers: {
							Accept: 'application/json',
							'User-Agent': musicBrainzUserAgent()
						},
						signal: controller.signal
					});
					if (!response.ok) {
						const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
						throw new MusicBrainzHttpError(response.status, url, retryAfterMs);
					}
					return (await response.json()) as T;
				} finally {
					clearTimeout(timeout);
				}
			});
		} catch (error) {
			lastError = error;
			if (attempt >= MUSICBRAINZ_MAX_RETRIES || !shouldRetryMusicBrainzError(error)) {
				throw error;
			}
			await delay(retryDelayMsForMusicBrainz(error, attempt));
		}
	}
	throw lastError instanceof Error ? lastError : new Error('MusicBrainz request failed');
}
