import { env } from '$env/dynamic/private';
import { Buffer } from 'node:buffer';
import type Redis from 'ioredis';
import type { RequestHandler } from './$types';

// Timestamp helper
const getTimestamp = () => {
	const now = new Date();
	return now.toLocaleTimeString('en-US', { hour12: false });
};

import { disableRedisClient, getRedisClient } from '$lib/server/redis';
import {
	isUpstreamHealthy,
	logUpstreamSuppressed,
	markUpstreamUnhealthy
} from '$lib/server/proxyUpstreamHealth';
import {
	createCacheKey,
	getCacheTtlSeconds,
	hasDisqualifyingCacheControl,
	isCacheableContentType,
	sanitizeHeaderEntries
} from '$lib/server/proxyCache';

const allowOrigin = (origin?: string | null): boolean => {
	void origin;
	return true;
};

const hopByHopHeaders = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade'
]);

const CACHE_NAMESPACE = 'tidal:proxy:v2:';

const DEFAULT_CACHE_TTL_SECONDS = getEnvNumber('REDIS_CACHE_TTL_SECONDS', 300);
const SEARCH_CACHE_TTL_SECONDS = getEnvNumber('REDIS_CACHE_TTL_SEARCH_SECONDS', 300);
const TRACK_CACHE_TTL_SECONDS = getEnvNumber('REDIS_CACHE_TTL_TRACK_SECONDS', 120);
const MAX_CACHE_BODY_BYTES = getEnvNumber('REDIS_CACHE_MAX_BODY_BYTES', 200_000);

const MOCK_PROXY_FLAGS = ['E2E_OFFLINE', 'MOCK_PROXY', 'MOCK_API'];
function isMockProxyEnabled(): boolean {
	return MOCK_PROXY_FLAGS.some((flag) => {
		const value = env[flag];
		return value ? ['true', '1'].includes(value.toLowerCase()) : false;
	});
}

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

const MOCK_AUDIO_BASE64 =
	'UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function mockAudioResponse(): Response {
	const audioBuffer = Buffer.from(MOCK_AUDIO_BASE64, 'base64');
	return new Response(audioBuffer, {
		status: 200,
		headers: {
			'Content-Type': 'audio/wav',
			'Content-Length': audioBuffer.byteLength.toString()
		}
	});
}

function buildMockArtist(id: number) {
	return {
		id,
		name: `Mock Artist ${id}`,
		type: 'artist',
		picture: '',
		url: `https://example.com/artist/${id}`,
		popularity: 1
	};
}

function buildMockAlbum(id: number, artist: ReturnType<typeof buildMockArtist>) {
	return {
		id,
		title: `Mock Album ${id}`,
		cover: 'mock-cover',
		videoCover: null,
		releaseDate: '2024-01-01',
		duration: 2400,
		numberOfTracks: 1,
		numberOfVideos: 0,
		numberOfVolumes: 1,
		explicit: false,
		popularity: 1,
		type: 'album',
		upc: '000000000000',
		copyright: 'Mock Label',
		artist,
		artists: [artist]
	};
}

function buildMockTrack(
	id: number,
	artist: ReturnType<typeof buildMockArtist>,
	album: ReturnType<typeof buildMockAlbum>
) {
	return {
		id,
		title: `Mock Track ${id}`,
		duration: 240,
		replayGain: 0,
		peak: 0,
		allowStreaming: true,
		streamReady: true,
		streamStartDate: '2024-01-01',
		premiumStreamingOnly: false,
		trackNumber: 1,
		volumeNumber: 1,
		version: null,
		popularity: 1,
		url: `https://example.com/track/${id}`,
		isrc: 'MOCK12345678',
		editable: false,
		explicit: false,
		audioQuality: 'LOSSLESS',
		audioModes: ['STEREO'],
		artist,
		artists: [artist],
		album,
		mixes: {},
		mediaMetadata: { tags: [] }
	};
}

function buildMockPlaylist(uuid: string) {
	const now = new Date().toISOString();
	return {
		uuid,
		title: `Mock Playlist ${uuid}`,
		description: 'Mock playlist for offline tests.',
		image: 'mock-playlist',
		squareImage: 'mock-playlist',
		duration: 240,
		numberOfTracks: 1,
		numberOfVideos: 0,
		creator: {
			id: 1,
			name: 'Mock Creator',
			picture: null
		},
		created: now,
		lastUpdated: now,
		type: 'playlist',
		publicPlaylist: true,
		url: `https://example.com/playlist/${uuid}`,
		popularity: 1
	};
}

function buildMockSearchResponse(type: 'tracks' | 'albums' | 'artists' | 'playlists') {
	const artist = buildMockArtist(456);
	const album = buildMockAlbum(123, artist);
	const track = buildMockTrack(789, artist, album);
	const playlist = buildMockPlaylist('test-uuid');

	const itemsByType = {
		tracks: [track],
		albums: [album],
		artists: [artist],
		playlists: [playlist]
	};

	return {
		items: itemsByType[type],
		limit: 1,
		offset: 0,
		totalNumberOfItems: 1
	};
}

function buildMockTrackLookup(id: number) {
	const artist = buildMockArtist(456);
	const album = buildMockAlbum(123, artist);
	const track = buildMockTrack(id, artist, album);
	const manifestPayload = Buffer.from(
		JSON.stringify({ urls: ['https://example.com/audio.mp3'] })
	).toString('base64');

	return [
		track,
		{
			trackId: id,
			audioQuality: 'LOSSLESS',
			audioMode: 'STEREO',
			manifest: manifestPayload,
			manifestMimeType: 'application/json',
			assetPresentation: 'FULL'
		}
	];
}

function buildMockProxyResponse(parsedTarget: URL): Response | null {
	const path = parsedTarget.pathname.toLowerCase();
	if (parsedTarget.hostname === 'example.com' && path === '/audio.mp3') {
		return mockAudioResponse();
	}

	if (path.includes('/search/')) {
		const params = parsedTarget.searchParams;
		if (params.has('s')) {
			return jsonResponse(buildMockSearchResponse('tracks'));
		}
		if (params.has('a')) {
			return jsonResponse(buildMockSearchResponse('artists'));
		}
		if (params.has('al')) {
			return jsonResponse(buildMockSearchResponse('albums'));
		}
		if (params.has('p')) {
			return jsonResponse(buildMockSearchResponse('playlists'));
		}
		return jsonResponse(buildMockSearchResponse('tracks'));
	}

	if (path.includes('/album/')) {
		const id = Number.parseInt(parsedTarget.searchParams.get('id') || '123', 10);
		const artist = buildMockArtist(456);
		const album = buildMockAlbum(Number.isFinite(id) ? id : 123, artist);
		const track = buildMockTrack(789, artist, album);
		return jsonResponse({
			data: {
				items: [{ item: track }]
			}
		});
	}

	if (path.includes('/artist/')) {
		const id = Number.parseInt(parsedTarget.searchParams.get('f') || '456', 10);
		const artist = buildMockArtist(Number.isFinite(id) ? id : 456);
		const album = buildMockAlbum(123, artist);
		const track = buildMockTrack(789, artist, album);
		return jsonResponse({
			...artist,
			albums: [album],
			tracks: [track]
		});
	}

	if (path.includes('/playlist/')) {
		const uuid = parsedTarget.searchParams.get('id') || 'test-uuid';
		const playlist = buildMockPlaylist(uuid);
		const artist = buildMockArtist(456);
		const album = buildMockAlbum(123, artist);
		const track = buildMockTrack(789, artist, album);
		return jsonResponse({
			playlist,
			items: [{ item: track }]
		});
	}

	if (path.includes('/track/')) {
		const id = Number.parseInt(parsedTarget.searchParams.get('id') || '789', 10);
		return jsonResponse(buildMockTrackLookup(Number.isFinite(id) ? id : 789));
	}

	if (path.includes('/url/')) {
		return jsonResponse({ url: 'https://example.com/audio.mp3' });
	}

	return null;
}

interface CachedProxyEntry {
	status: number;
	statusText: string;
	headers: [string, string][];
	bodyBase64: string;
}

function getEnvNumber(name: string, fallback: number): number {
	const raw = env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const cacheTtlConfig = {
	defaultTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
	searchTtlSeconds: SEARCH_CACHE_TTL_SECONDS,
	trackTtlSeconds: TRACK_CACHE_TTL_SECONDS
};

function applyProxyHeaders(sourceHeaders: Array<[string, string]>, origin: string | null): Headers {
	const headers = new Headers();
	const sanitized = sanitizeHeaderEntries(sourceHeaders);
	for (const [key, value] of sanitized) {
		headers.append(key, value);
	}
	headers.set('Access-Control-Allow-Origin', origin ?? '*');
	headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Content-Type, Range');
	headers.set('Vary', ensureVaryIncludesOrigin(headers.get('vary')));

	// Don't cache audio/video content
	const contentType = headers.get('content-type') || '';
	const isMediaContent = contentType.includes('audio/') || contentType.includes('video/');

	if (!headers.has('Cache-Control') && !isMediaContent) {
		headers.set('Cache-Control', 'public, max-age=300');
	}
	return headers;
}

function isCachedProxyEntry(value: unknown): value is CachedProxyEntry {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<CachedProxyEntry>;
	return (
		typeof candidate.status === 'number' &&
		typeof candidate.statusText === 'string' &&
		Array.isArray(candidate.headers) &&
		typeof candidate.bodyBase64 === 'string'
	);
}

function base64ToUint8Array(base64: string): Uint8Array {
	return Uint8Array.from(Buffer.from(base64, 'base64'));
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

async function bufferReadableStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const arrayBuffer = await new Response(stream).arrayBuffer();
	return new Uint8Array(arrayBuffer);
}

async function readCachedResponse(
	redis: Redis,
	key: string,
	onFailure?: () => void
): Promise<CachedProxyEntry | null> {
	try {
		const raw = await redis.get(key);
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw) as unknown;
		return isCachedProxyEntry(parsed) ? (parsed as CachedProxyEntry) : null;
	} catch (error) {
		console.error(`[${getTimestamp()}] Failed to read proxy cache entry:`, error);
		onFailure?.();
		disableRedisClient(error);
		return null;
	}
}

async function writeCachedResponse(
	redis: Redis,
	key: string,
	entry: CachedProxyEntry,
	ttlSeconds: number,
	onFailure?: () => void
): Promise<void> {
	if (ttlSeconds <= 0) return;
	try {
		await redis.set(key, JSON.stringify(entry), 'EX', ttlSeconds);
	} catch (error) {
		console.error(`[${getTimestamp()}] Failed to store proxy cache entry:`, error);
		onFailure?.();
		disableRedisClient(error);
	}
}

const ensureVaryIncludesOrigin = (value: string | null): string => {
	const entries = value
		? value
				.split(',')
				.map((v) => v.trim())
				.filter(Boolean)
		: [];
	if (!entries.includes('Origin')) {
		entries.push('Origin');
	}
	return entries.join(', ');
};

const RETRYABLE_PATH_SEGMENTS = ['/track/', '/search/'];

const TOKEN_INVALID_MESSAGE = 'token has invalid payload';

const MAX_RETRY_ATTEMPTS = 2;

function isRetryEligibleTarget(url: URL): boolean {
	const path = url.pathname.toLowerCase();
	return RETRYABLE_PATH_SEGMENTS.some((segment) => path.includes(segment));
}

async function shouldRetryInvalidToken(response: Response, targetUrl: URL): Promise<boolean> {
	if (response.status !== 401) {
		return false;
	}

	if (!isRetryEligibleTarget(targetUrl)) {
		return false;
	}

	const contentType = response.headers.get('content-type');
	if (!contentType || !contentType.toLowerCase().includes('application/json')) {
		return false;
	}

	try {
		const payload = (await response.clone().json()) as {
			subStatus?: unknown;
			userMessage?: unknown;
			detail?: unknown;
		};
		const rawSubStatus =
			typeof payload?.subStatus === 'number'
				? payload.subStatus
				: typeof payload?.subStatus === 'string'
					? Number.parseInt(payload.subStatus, 10)
					: undefined;
		const subStatus =
			typeof rawSubStatus === 'number' && Number.isFinite(rawSubStatus) ? rawSubStatus : undefined;
		const combinedMessage = [payload?.userMessage, payload?.detail]
			.filter((value): value is string => typeof value === 'string')
			.join(' ')
			.toLowerCase();

		if (subStatus === 11002) {
			return true;
		}

		if (combinedMessage.includes(TOKEN_INVALID_MESSAGE)) {
			return true;
		}
	} catch (error) {
		console.debug('Proxy retry check failed to parse response', error);
	}

	return false;
}

async function fetchWithRetry(
	url: URL,
	options: RequestInit,
	fetchFn: typeof fetch
): Promise<Response> {
	let response: Response | null = null;

	for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
		response = await fetchFn(url.toString(), options);
		if (attempt < MAX_RETRY_ATTEMPTS && (await shouldRetryInvalidToken(response, url))) {
			// Cancel the body if it exists to free resources before retrying
			try {
				if (response.body && typeof response.body.cancel === 'function') {
					await response.body.cancel();
				}
			} catch (error) {
				console.debug('Failed to cancel upstream response body before retry', error);
			}
			continue;
		}
		return response;
	}

	// Fallback: return the last response if all attempts exhausted without early return
	if (response) {
		return response;
	}

	return fetchFn(url.toString(), options);
}

export const GET: RequestHandler = async ({ url, request, fetch }) => {
	const target = url.searchParams.get('url');
	const origin = request.headers.get('origin');

	console.log(`[${getTimestamp()}] ========== PROXY REQUEST START ==========`);
	console.log(`[${getTimestamp()}] [Proxy] Target URL:`, target);
	console.log(`[${getTimestamp()}] [Proxy] Origin:`, origin);
	console.log(`[${getTimestamp()}] [Proxy] Request headers:`, Object.fromEntries(request.headers.entries()));

	if (!allowOrigin(origin)) {
		console.log(`[${getTimestamp()}] Proxy request blocked by origin check`);
		return new Response('Forbidden', { status: 403 });
	}

	if (!target) {
		console.log(`[${getTimestamp()}] Proxy request missing url parameter`);
		return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let parsedTarget: URL;

	try {
		parsedTarget = new URL(target);
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid target URL' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!isUpstreamHealthy(parsedTarget.origin)) {
		logUpstreamSuppressed(parsedTarget.origin);
		return new Response(
			JSON.stringify({
				error: 'Upstream temporarily unavailable',
				target: parsedTarget.origin
			}),
			{
				status: 503,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}

	if (isMockProxyEnabled()) {
		const mockResponse = buildMockProxyResponse(parsedTarget);
		if (mockResponse) {
			return mockResponse;
		}
	}

	const upstreamHeaders = new Headers();
	let hasRangeRequest = false;
	let hasAuthorizationHeader = false;
	let hasCookieHeader = false;

	request.headers.forEach((value, key) => {
		const lowerKey = key.toLowerCase();
		if (hopByHopHeaders.has(lowerKey) || lowerKey === 'host') {
			return;
		}
		if (lowerKey === 'range') {
			hasRangeRequest = true;
		}
		if (lowerKey === 'authorization') {
			hasAuthorizationHeader = true;
		}
		if (lowerKey === 'cookie') {
			hasCookieHeader = true;
		}
		upstreamHeaders.set(key, value);
	});

	if (!upstreamHeaders.has('User-Agent')) {
		upstreamHeaders.set(
			'User-Agent',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
		);
	}
	if (!upstreamHeaders.has('Referer')) {
		upstreamHeaders.set('Referer', 'https://tidal.com/');
	}

	// Force identity encoding so the upstream sends plain data that Node can forward without zstd artifacts.
	upstreamHeaders.set('Accept-Encoding', 'identity');

	const shouldUseCache = !hasRangeRequest && !hasAuthorizationHeader && !hasCookieHeader;
	const redis = shouldUseCache ? getRedisClient() : null;
	let redisHealthy = Boolean(redis && redis.status === 'ready');
	const cacheKey = redisHealthy ? createCacheKey(parsedTarget, upstreamHeaders, CACHE_NAMESPACE) : null;

	if (redisHealthy && cacheKey && redis) {
		const cached = await readCachedResponse(redis, cacheKey, () => {
			redisHealthy = false;
		});
		if (cached) {
			const headers = applyProxyHeaders(cached.headers, origin);
			const bodyBytes = base64ToUint8Array(cached.bodyBase64);
			headers.set('Content-Length', String(bodyBytes.byteLength));
			return new Response(toArrayBuffer(bodyBytes), {
				status: cached.status,
				statusText: cached.statusText,
				headers
			});
		}
	}

		try {
				console.log(`[${getTimestamp()}] [Proxy] ========== UPSTREAM FETCH START ==========`);
			console.log(`[${getTimestamp()}] [Proxy] Fetching:`, parsedTarget.toString());
			console.log(`[${getTimestamp()}] [Proxy] Request headers:`, Object.fromEntries(upstreamHeaders.entries()));
			
			const upstreamFetchStart = Date.now();
			let upstream = await fetchWithRetry(
				parsedTarget,
				{
					headers: upstreamHeaders,
					redirect: 'follow'
				},
				fetch
			);
			const upstreamFetchDuration = Date.now() - upstreamFetchStart;
			
			if (upstream.status === 416 && hasRangeRequest) {
				const retryHeaders = new Headers(upstreamHeaders);
				retryHeaders.delete('range');
				console.warn(`[${getTimestamp()}] [Proxy] Received 416, retrying without Range header`);
				upstream = await fetchWithRetry(
					parsedTarget,
					{
						headers: retryHeaders,
						redirect: 'follow'
					},
					fetch
				);
			}
			
			console.log(`[${getTimestamp()}] [Proxy] Upstream fetch completed in`, upstreamFetchDuration, 'ms');
			console.log(`[${getTimestamp()}] [Proxy] Response status:`, upstream.status, upstream.statusText);
			console.log(`[${getTimestamp()}] [Proxy] Response headers:`, Object.fromEntries(upstream.headers.entries()));
			
		const upstreamHeaderEntries = Array.from(upstream.headers.entries());
		const sanitizedHeaderEntries = sanitizeHeaderEntries(upstreamHeaderEntries);
		const headers = applyProxyHeaders(sanitizedHeaderEntries, origin);

		const upstreamCacheControl = upstream.headers.get('cache-control');
		const upstreamContentLength = upstream.headers.get('content-length');
		const upstreamContentType = upstream.headers.get('content-type');
		
		console.log(`[${getTimestamp()}] [Proxy] Content-Type:`, upstreamContentType);
		console.log(`[${getTimestamp()}] [Proxy] Content-Length:`, upstreamContentLength);
		console.log(`[${getTimestamp()}] [Proxy] Cache-Control:`, upstreamCacheControl);
		console.log(`[${getTimestamp()}] [Proxy] ========== UPSTREAM FETCH END ==========`);
		const canStream =
			Boolean(upstream.body) &&
			!hasRangeRequest &&
			Boolean(upstreamContentType && isCacheableContentType(upstreamContentType));

		if (canStream && upstream.body) {
			const [streamForClient, streamForCache] = upstream.body.tee();
			if (upstreamContentLength) {
				headers.set('Content-Length', upstreamContentLength);
			}

			if (redisHealthy && cacheKey && redis) {
				void (async () => {
					try {
						const bodyBytes = await bufferReadableStream(streamForCache);
						const ttlSeconds = getCacheTtlSeconds(parsedTarget, cacheTtlConfig);
						const cacheable =
							upstream.status === 200 &&
							ttlSeconds > 0 &&
							!hasDisqualifyingCacheControl(upstreamCacheControl) &&
							isCacheableContentType(upstreamContentType) &&
							bodyBytes.byteLength <= MAX_CACHE_BODY_BYTES;
						if (cacheable) {
							const entry: CachedProxyEntry = {
								status: upstream.status,
								statusText: upstream.statusText,
								headers: sanitizedHeaderEntries,
								bodyBase64: uint8ArrayToBase64(bodyBytes)
							};
							await writeCachedResponse(redis, cacheKey, entry, ttlSeconds, () => {
								redisHealthy = false;
							});
						}
					} catch (error) {
								console.error(`[${getTimestamp()}] Failed to buffer streamed proxy response:`, error);
					}
				})();
			} else {
				void bufferReadableStream(streamForCache).catch((error) => {
						console.error(`[${getTimestamp()}] Failed to drain streamed proxy response:`, error);
				});
			}

			return new Response(streamForClient, {
				status: upstream.status,
				statusText: upstream.statusText,
				headers
			});
		}

		const bodyArrayBuffer = await upstream.arrayBuffer();
		console.log(`[${getTimestamp()}] Proxy response body size:`, bodyArrayBuffer.byteLength);
		const bodyBytes = new Uint8Array(bodyArrayBuffer);

		if (redisHealthy && cacheKey && redis) {
			const ttlSeconds = getCacheTtlSeconds(parsedTarget, cacheTtlConfig);
			const contentType = upstreamContentType;
			const cacheControl = upstreamCacheControl;
			const byteLength = bodyBytes.byteLength;
			const cacheable =
				upstream.status === 200 &&
				ttlSeconds > 0 &&
				!hasDisqualifyingCacheControl(cacheControl) &&
				isCacheableContentType(contentType) &&
				byteLength <= MAX_CACHE_BODY_BYTES;

			if (cacheable) {
				const entry: CachedProxyEntry = {
					status: upstream.status,
					statusText: upstream.statusText,
					headers: sanitizedHeaderEntries,
					bodyBase64: uint8ArrayToBase64(bodyBytes)
				};
				await writeCachedResponse(redis, cacheKey, entry, ttlSeconds, () => {
					redisHealthy = false;
				});
			}
		}

		headers.set('Content-Length', String(bodyBytes.byteLength));

		// Force 200 for media content that returns 206 (some servers incorrectly return 206 without range requests)
		let responseStatus = upstream.status;
		let responseStatusText = upstream.statusText;
		const contentType = upstream.headers.get('content-type') || '';
		if (
			(contentType.includes('audio/') || contentType.includes('video/')) &&
			upstream.status === 206
		) {
			responseStatus = 200;
			responseStatusText = 'OK';
		}

		return new Response(bodyArrayBuffer, {
			status: responseStatus,
			statusText: responseStatusText,
			headers
		});
	} catch (error) {
		console.error(`[${getTimestamp()}] [Proxy] ========== PROXY ERROR ==========`);
		console.error(`[${getTimestamp()}] [Proxy] Error type:`, error?.constructor?.name);
		console.error(`[${getTimestamp()}] [Proxy] Error message:`, error instanceof Error ? error.message : 'Unknown');
		console.error(`[${getTimestamp()}] [Proxy] Error code:`, (error as any)?.code);
		console.error(`[${getTimestamp()}] [Proxy] Error cause:`, (error as any)?.cause);
		console.error(`[${getTimestamp()}] [Proxy] Error stack:`, error instanceof Error ? error.stack : 'No stack');
		console.error(`[${getTimestamp()}] [Proxy] Target URL:`, parsedTarget.toString());
		console.error(`[${getTimestamp()}] [Proxy] =====================================`);
		markUpstreamUnhealthy(parsedTarget.origin);
		return new Response(
			JSON.stringify({
				error: 'Proxy request failed',
				message: error instanceof Error ? error.message : 'Unknown error'
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}
};

export const OPTIONS: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');

	if (!allowOrigin(origin)) {
		return new Response(null, { status: 403 });
	}

	const headers = new Headers();
	headers.set('Access-Control-Allow-Origin', origin ?? '*');
	headers.set('Vary', 'Origin');
	headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Content-Type, Range');
	headers.set('Access-Control-Max-Age', '86400');

	return new Response(null, {
		status: 204,
		headers
	});
};
