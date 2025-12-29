import { createHash } from 'node:crypto';

export type CacheTtlConfig = {
	defaultTtlSeconds: number;
	searchTtlSeconds: number;
	trackTtlSeconds: number;
};

export function sanitizeHeaderEntries(entries: Array<[string, string]>): Array<[string, string]> {
	const blocklist = new Set(['content-encoding', 'content-length', 'transfer-encoding']);
	return entries.filter(([key]) => !blocklist.has(key.toLowerCase()));
}

export function isCacheableContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
	return normalized.includes('json') || normalized.startsWith('text/');
}

export function hasDisqualifyingCacheControl(cacheControl: string | null): boolean {
	if (!cacheControl) return false;
	const normalized = cacheControl.toLowerCase();
	return normalized.includes('no-store') || normalized.includes('private');
}

export function getCacheTtlSeconds(url: URL, config: CacheTtlConfig): number {
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
	const keyMaterial = `${url.toString()}|accept=${accept}|range=${range}`;
	const hash = createHash('sha256').update(keyMaterial).digest('hex');
	return `${namespace}${hash}`;
}
