import type { ArtistDetails, ArtistRecommendations } from '$lib/types';
import type { CatalogAlbumLookupResult, CatalogHttpError } from './catalogTypes';

const ALBUM_NOT_FOUND_CACHE_TTL_MS = 5 * 60 * 1000;
const ALBUM_NOT_FOUND_CACHE_MAX_ENTRIES = 500;

const pendingAlbumRequests = new Map<string, Promise<CatalogAlbumLookupResult>>();
const pendingArtistRequests = new Map<string, Promise<ArtistDetails>>();
const pendingArtistRecommendationRequests = new Map<string, Promise<ArtistRecommendations>>();
const albumNotFoundCache = new Map<string, number>();

function isLocalBrowserRuntime(): boolean {
	if (typeof process !== 'undefined' && process.env?.LOCAL_MODE === 'false') {
		return false;
	}
	if (typeof window === 'undefined' || typeof window.location?.hostname !== 'string') {
		return false;
	}
	const hostname = window.location.hostname;
	return (
		hostname === 'localhost' ||
		hostname === '127.0.0.1' ||
		/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
		/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
		/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)
	);
}

function pruneAlbumNotFoundCache(now: number = Date.now()): void {
	for (const [cacheKey, expiresAt] of albumNotFoundCache.entries()) {
		if (expiresAt <= now) {
			albumNotFoundCache.delete(cacheKey);
		}
	}

	if (albumNotFoundCache.size <= ALBUM_NOT_FOUND_CACHE_MAX_ENTRIES) {
		return;
	}

	const overflow = albumNotFoundCache.size - ALBUM_NOT_FOUND_CACHE_MAX_ENTRIES;
	let removed = 0;
	for (const cacheKey of albumNotFoundCache.keys()) {
		albumNotFoundCache.delete(cacheKey);
		removed += 1;
		if (removed >= overflow) {
			break;
		}
	}
}

export function buildAlbumRequestCacheKey(baseUrl: string, id: number): string {
	return `${baseUrl}|${id}`;
}

export function createHttpStatusError(
	message: string,
	status: number,
	options?: { cached?: boolean }
): CatalogHttpError {
	const error = new Error(message) as CatalogHttpError;
	error.status = status;
	if (options?.cached) {
		error.cached = true;
	}
	return error;
}

export function getCachedAlbumNotFoundError(
	cacheKey: string,
	now: number = Date.now()
): CatalogHttpError | null {
	if (isLocalBrowserRuntime()) {
		return null;
	}
	const expiresAt = albumNotFoundCache.get(cacheKey);
	if (!expiresAt) {
		return null;
	}
	if (expiresAt <= now) {
		albumNotFoundCache.delete(cacheKey);
		return null;
	}
	return createHttpStatusError('Album not found', 404, { cached: true });
}

export function cacheAlbumNotFound(cacheKey: string, now: number = Date.now()): void {
	if (isLocalBrowserRuntime()) {
		return;
	}
	albumNotFoundCache.set(cacheKey, now + ALBUM_NOT_FOUND_CACHE_TTL_MS);
	pruneAlbumNotFoundCache(now);
}

export function clearCachedAlbumNotFound(cacheKey: string): void {
	albumNotFoundCache.delete(cacheKey);
}

export function getPendingAlbumRequest(
	cacheKey: string
): Promise<CatalogAlbumLookupResult> | undefined {
	return pendingAlbumRequests.get(cacheKey);
}

export function setPendingAlbumRequest(
	cacheKey: string,
	pending: Promise<CatalogAlbumLookupResult>
): void {
	pendingAlbumRequests.set(cacheKey, pending);
}

export function deletePendingAlbumRequest(cacheKey: string): void {
	pendingAlbumRequests.delete(cacheKey);
}

export function getPendingArtistRequest(requestKey: string): Promise<ArtistDetails> | undefined {
	return pendingArtistRequests.get(requestKey);
}

export function setPendingArtistRequest(
	requestKey: string,
	pending: Promise<ArtistDetails>
): void {
	pendingArtistRequests.set(requestKey, pending);
}

export function deletePendingArtistRequest(requestKey: string): void {
	pendingArtistRequests.delete(requestKey);
}

export function getPendingArtistRecommendationRequest(
	requestKey: string
): Promise<ArtistRecommendations> | undefined {
	return pendingArtistRecommendationRequests.get(requestKey);
}

export function setPendingArtistRecommendationRequest(
	requestKey: string,
	pending: Promise<ArtistRecommendations>
): void {
	pendingArtistRecommendationRequests.set(requestKey, pending);
}

export function deletePendingArtistRecommendationRequest(requestKey: string): void {
	pendingArtistRecommendationRequests.delete(requestKey);
}
