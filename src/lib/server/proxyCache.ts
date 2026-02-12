import { createHash } from 'node:crypto';

export type CacheTtlConfig = {
	defaultTtlSeconds: number;
	searchTtlSeconds: number;
	trackTtlSeconds: number;
	imageTtlSeconds: number;
};

export type CacheabilityInput = {
	status: number;
	ttlSeconds: number;
	cacheControl: string | null;
	contentType: string | null;
	bodyBytes: number;
	maxBodyBytes: number;
	maxImageBodyBytes: number;
};

export function sanitizeHeaderEntries(entries: Array<[string, string]>): Array<[string, string]> {
	const blocklist = new Set([
		'content-encoding',
		'content-length',
		'transfer-encoding',
		'connection',
		'keep-alive',
		'proxy-authenticate',
		'proxy-authorization',
		'set-cookie',
		'set-cookie2',
		'te',
		'trailer',
		'upgrade'
	]);
	return entries.filter(([key]) => !blocklist.has(key.toLowerCase()));
}

export function isCacheableContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
	return (
		normalized.includes('json') ||
		normalized.startsWith('text/') ||
		normalized.startsWith('image/')
	);
}

export function hasDisqualifyingCacheControl(cacheControl: string | null): boolean {
	if (!cacheControl) return false;
	const normalized = cacheControl.toLowerCase();
	return normalized.includes('no-store') || normalized.includes('private');
}

export function getCacheBodyByteLimit(
	contentType: string | null,
	maxBodyBytes: number,
	maxImageBodyBytes: number
): number {
	const normalized = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
	if (normalized.startsWith('image/')) {
		return maxImageBodyBytes;
	}
	return maxBodyBytes;
}

export function isCacheableResponsePayload(input: CacheabilityInput): boolean {
	if (input.status !== 200 || input.ttlSeconds <= 0) {
		return false;
	}

	if (hasDisqualifyingCacheControl(input.cacheControl)) {
		return false;
	}

	if (!isCacheableContentType(input.contentType)) {
		return false;
	}

	const bodyLimit = getCacheBodyByteLimit(
		input.contentType,
		input.maxBodyBytes,
		input.maxImageBodyBytes
	);

	return input.bodyBytes <= bodyLimit;
}

export function getCacheTtlSeconds(url: URL, config: CacheTtlConfig): number {
	if (url.hostname === 'resources.tidal.com' && url.pathname.toLowerCase().includes('/images/')) {
		return config.imageTtlSeconds;
	}

	const path = url.pathname.toLowerCase();
	if (path.includes('/track/') || path.includes('/song/')) {
		return config.trackTtlSeconds;
	}
	if (path.includes('/search/')) {
		return config.searchTtlSeconds;
	}
	if (path.includes('/album/') || path.includes('/artist/') || path.includes('/playlist/')) {
		return config.defaultTtlSeconds;
	}
	return config.defaultTtlSeconds;
}

export function createCacheKey(url: URL, headers: Headers, namespace: string): string {
	const accept = headers.get('accept') ?? '';
	const range = headers.get('range') ?? '';
	const ifNoneMatch = headers.get('if-none-match') ?? '';
	const ifModifiedSince = headers.get('if-modified-since') ?? '';
	const keyMaterial = `${url.toString()}|accept=${accept}|range=${range}|ifNoneMatch=${ifNoneMatch}|ifModifiedSince=${ifModifiedSince}`;
	const hash = createHash('sha256').update(keyMaterial).digest('hex');
	return `${namespace}${hash}`;
}
