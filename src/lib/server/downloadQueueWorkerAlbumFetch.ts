import { API_CONFIG } from '$lib/config';
import { refreshApiTargetsIfStale } from '$lib/config/targets';
import { isNativeTidalApiEnabled, nativeGetAlbum } from '$lib/api/tidalNativeClient';
import * as rateLimiter from './rateLimiter';
import { rotateTargets } from './downloadQueueWorkerPolicy';
import { parseAlbumResponse } from './downloadQueueWorkerAlbumResponse';
import { shouldStopJob } from './downloadQueueWorkerControl';

const HEALTH_BACKOFF_MS = {
	rateLimit: 5 * 60 * 1000,
	serverError: 3 * 60 * 1000,
	timeout: 2 * 60 * 1000
};

const ALBUM_TARGET_TIMEOUT_MS = 10_000;
const ALBUM_LOOKUP_LIMIT = 500;
const ALBUM_LOOKUP_OFFSET = 0;
let albumTargetCursor = 0;
const targetHealth = new Map<string, number>();

type AlbumPayload = {
	album: Record<string, unknown>;
	tracks: Array<Record<string, unknown>>;
};

export type AlbumFetchResult =
	| { stopState: 'cancelled' | 'paused' }
	| ({ stopState?: undefined } & AlbumPayload);

function isTargetTemporarilyDown(name: string): boolean {
	const downUntil = targetHealth.get(name);
	return !!downUntil && downUntil > Date.now();
}

function markTargetDown(name: string, reason: string, timeoutMs: number): void {
	const until = Date.now() + timeoutMs;
	targetHealth.set(name, until);
	const seconds = Math.round(timeoutMs / 1000);
	console.warn(`[Worker] Marking target ${name} down for ${seconds}s (${reason})`);
}

async function fetchAlbumFromNativeTidal(
	jobId: string,
	albumId: number
): Promise<AlbumFetchResult | null> {
	if (!isNativeTidalApiEnabled()) {
		return null;
	}

	const requestedStop = await shouldStopJob(jobId);
	if (requestedStop) {
		return { stopState: requestedStop };
	}

	try {
		console.log(`[Worker] Album ${albumId}: Trying native TIDAL metadata`);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), ALBUM_TARGET_TIMEOUT_MS);
		let nativeAlbum: Awaited<ReturnType<typeof nativeGetAlbum>>;
		try {
			nativeAlbum = await nativeGetAlbum(albumId, { signal: controller.signal });
		} finally {
			clearTimeout(timeout);
		}
		if (nativeAlbum.tracks.length === 0) {
			throw new Error('Native TIDAL album metadata returned no tracks');
		}
		console.log(`[Worker] Album ${albumId}: Successfully fetched from native TIDAL metadata`);
		return {
			album: nativeAlbum.album as unknown as Record<string, unknown>,
			tracks: nativeAlbum.tracks as unknown as Array<Record<string, unknown>>
		};
	} catch (error) {
		console.warn('[Worker] Native TIDAL album metadata failed; using hifi-api fallback:', {
			albumId,
			error: error instanceof Error ? error.message : String(error)
		});
		return null;
	}
}

export async function fetchAlbumWithTargetRotation(
	jobId: string,
	albumId: number
): Promise<AlbumFetchResult> {
	const nativeAlbum = await fetchAlbumFromNativeTidal(jobId, albumId);
	if (nativeAlbum) {
		return nativeAlbum;
	}

	try {
		await refreshApiTargetsIfStale();
	} catch (refreshError) {
		console.warn('[Worker] API target refresh failed, continuing with cached targets:', refreshError);
	}

	const targets =
		API_CONFIG.targets.length > 0
			? API_CONFIG.targets
			: [
					{
						name: 'default',
						baseUrl: API_CONFIG.baseUrl || 'https://triton.squid.wtf',
						weight: 1,
						requiresProxy: false,
						category: 'auto-only' as const
					}
				];

	const healthyTargets = targets.filter((target) => !isTargetTemporarilyDown(target.name));
	const selectedTargets = healthyTargets.length > 0 ? healthyTargets : targets;
	const rateAllowedTargets = selectedTargets.filter((target) =>
		rateLimiter.isRequestAllowed(target.name)
	);
	if (rateAllowedTargets.length === 0 && selectedTargets.length > 0) {
		console.warn('[Worker] All API targets are rate-limited; falling back to full list.');
	}

	if (selectedTargets.length === 0) {
		throw new Error('No API targets available for album fetch');
	}

	let albumData: AlbumPayload | null = null;
	let lastError: Error | null = null;
	const rotatedTargets = rotateTargets(
		rateAllowedTargets.length > 0 ? rateAllowedTargets : selectedTargets,
		albumTargetCursor++
	);

	const maxAttempts = rotatedTargets.length;
	for (let index = 0; index < maxAttempts; index += 1) {
		const requestedStop = await shouldStopJob(jobId);
		if (requestedStop) {
			return { stopState: requestedStop };
		}

		const target = rotatedTargets[index];
		try {
			const albumParams = new URLSearchParams({
				id: String(albumId),
				limit: String(ALBUM_LOOKUP_LIMIT),
				offset: String(ALBUM_LOOKUP_OFFSET)
			});
			const albumUrl = `${target.baseUrl}/album/?${albumParams.toString()}`;
			console.log(`[Worker] Album ${albumId}: Trying ${target.name} (${target.baseUrl})`);

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), ALBUM_TARGET_TIMEOUT_MS);

			let albumResponse: Response;
			try {
				albumResponse = await globalThis.fetch(albumUrl, { signal: controller.signal });
			} finally {
				clearTimeout(timeout);
			}

			if (!albumResponse.ok) {
				const statusText = albumResponse.statusText || '';
				const errorBody = await albumResponse.text().catch(() => '');
				const bodySnippet = errorBody.trim().slice(0, 300);
				const statusSummary = `HTTP ${albumResponse.status}${statusText ? ` ${statusText}` : ''} from ${target.name}`;
				const logSummary = bodySnippet
					? `${statusSummary}: ${bodySnippet}`
					: `${statusSummary} (no body)`;
				console.warn(`[Worker] ${logSummary}`);
				lastError = new Error(statusSummary);

				if (albumResponse.status === 429) {
					const { backoffMs } = rateLimiter.recordError(target.name, 'rate_limit');
					markTargetDown(
						target.name,
						'rate limited',
						backoffMs > 0 ? backoffMs : HEALTH_BACKOFF_MS.rateLimit
					);
				} else if (albumResponse.status >= 500) {
					const { backoffMs } = rateLimiter.recordError(target.name, 'server_error');
					markTargetDown(
						target.name,
						'server error',
						backoffMs > 0 ? backoffMs : HEALTH_BACKOFF_MS.serverError
					);
				}

				continue;
			}

			const responseData = await albumResponse.json();
			albumData = parseAlbumResponse(responseData);
			rateLimiter.recordSuccess(target.name);
			console.log(`[Worker] Album ${albumId}: Successfully fetched from ${target.name}`);
			break;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			console.warn(`[Worker] Target ${target.name} failed: ${lastError.message}`);

			if (lastError.name === 'AbortError') {
				const { backoffMs } = rateLimiter.recordError(target.name, 'network');
				markTargetDown(
					target.name,
					'timeout',
					backoffMs > 0 ? backoffMs : HEALTH_BACKOFF_MS.timeout
				);
			} else {
				const { backoffMs } = rateLimiter.recordError(target.name, 'network');
				markTargetDown(
					target.name,
					'network error',
					backoffMs > 0 ? backoffMs : HEALTH_BACKOFF_MS.serverError
				);
			}
		}
	}

	if (!albumData) {
		throw lastError || new Error('All targets failed to fetch album');
	}

	return albumData;
}
