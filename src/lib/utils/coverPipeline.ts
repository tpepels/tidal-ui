import { losslessAPI } from '$lib/api';

type CachedResolvedEntry = {
	url: string;
	expiresAt: number;
};

type CachedFailureEntry = {
	expiresAt: number;
	failures: number;
};

const RESOLVED_TTL_MS = Math.max(
	60_000,
	Number(import.meta.env.VITE_COVER_RESOLVED_TTL_MS || 24 * 60 * 60 * 1000)
);
const FAILURE_TTL_MS = Math.max(
	5_000,
	Number(import.meta.env.VITE_COVER_FAILURE_TTL_MS || 15 * 60 * 1000)
);
const PREFETCH_CONCURRENCY = 4;
export type CoverImageSize = '1280' | '640' | '320' | '160' | '80';

const resolvedCoverCache = new Map<string, CachedResolvedEntry>();
const failedCoverCache = new Map<string, CachedFailureEntry>();
const inFlightPrefetch = new Set<string>();

function now(): number {
	return Date.now();
}

function pruneCoverCaches(): void {
	const current = now();
	for (const [key, entry] of resolvedCoverCache.entries()) {
		if (entry.expiresAt <= current) {
			resolvedCoverCache.delete(key);
		}
	}
	for (const [key, entry] of failedCoverCache.entries()) {
		if (entry.expiresAt <= current) {
			failedCoverCache.delete(key);
		}
	}
}

export function getCoverCacheKey(options: {
	coverId?: string | null;
	size: CoverImageSize;
	proxy?: boolean;
	overrideKey?: string;
}): string {
	if (options.overrideKey && options.overrideKey.trim().length > 0) {
		return options.overrideKey.trim();
	}
	const id = (options.coverId ?? '').trim();
	const proxyToken = options.proxy ? 'proxy' : 'direct';
	return `${proxyToken}:${options.size}:${id}`;
}

export function getUnifiedCoverCandidates(options: {
	coverId?: string | null;
	size: CoverImageSize;
	proxy?: boolean;
	includeLowerSizes?: boolean;
}): string[] {
	const coverId = (options.coverId ?? '').trim();
	if (!coverId) return [];
	return losslessAPI.getCoverUrlFallbacks(coverId, options.size, {
		proxy: Boolean(options.proxy),
		includeLowerSizes: options.includeLowerSizes !== false
	});
}

export function getResolvedCoverUrl(cacheKey: string): string | null {
	pruneCoverCaches();
	const entry = resolvedCoverCache.get(cacheKey);
	if (!entry) return null;
	return entry.url;
}

export function isCoverInFailureBackoff(cacheKey: string): boolean {
	pruneCoverCaches();
	const entry = failedCoverCache.get(cacheKey);
	return Boolean(entry && entry.expiresAt > now());
}

export function markCoverResolved(cacheKey: string, url: string): void {
	if (!cacheKey || !url) return;
	resolvedCoverCache.set(cacheKey, {
		url,
		expiresAt: now() + RESOLVED_TTL_MS
	});
	failedCoverCache.delete(cacheKey);
}

export function markCoverFailed(cacheKey: string): void {
	if (!cacheKey) return;
	const previous = failedCoverCache.get(cacheKey);
	failedCoverCache.set(cacheKey, {
		failures: (previous?.failures ?? 0) + 1,
		expiresAt: now() + FAILURE_TTL_MS
	});
}

async function tryPrefetchCandidates(cacheKey: string, candidates: string[]): Promise<void> {
	if (candidates.length === 0) {
		return;
	}
	if (getResolvedCoverUrl(cacheKey)) {
		return;
	}
	if (isCoverInFailureBackoff(cacheKey)) {
		return;
	}

	for (const candidate of candidates) {
		if (!candidate || typeof Image === 'undefined') {
			continue;
		}
		const loaded = await new Promise<boolean>((resolve) => {
			const image = new Image();
			image.onload = () => resolve(true);
			image.onerror = () => resolve(false);
			image.src = candidate;
		});
		if (loaded) {
			markCoverResolved(cacheKey, candidate);
			return;
		}
	}

	markCoverFailed(cacheKey);
}

export async function prefetchCoverCandidates(
	items: Array<{ cacheKey: string; candidates: string[] }>
): Promise<void> {
	if (typeof window === 'undefined' || items.length === 0) {
		return;
	}

	const queue = items.filter(
		(item) =>
			item.cacheKey &&
			item.candidates.length > 0 &&
			!inFlightPrefetch.has(item.cacheKey) &&
			!getResolvedCoverUrl(item.cacheKey) &&
			!isCoverInFailureBackoff(item.cacheKey)
	);
	if (queue.length === 0) {
		return;
	}

	const workerCount = Math.min(PREFETCH_CONCURRENCY, queue.length);
	const workers = Array.from({ length: workerCount }, async (_, workerIndex) => {
		for (let i = workerIndex; i < queue.length; i += workerCount) {
			const item = queue[i]!;
			inFlightPrefetch.add(item.cacheKey);
			try {
				await tryPrefetchCandidates(item.cacheKey, item.candidates);
			} finally {
				inFlightPrefetch.delete(item.cacheKey);
			}
		}
	});

	await Promise.all(workers);
}

export function clearCoverPipelineCaches(): void {
	resolvedCoverCache.clear();
	failedCoverCache.clear();
	inFlightPrefetch.clear();
}
