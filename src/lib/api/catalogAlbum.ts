import { parseAlbumLookupPayload, warnIfAlbumTrackListIncomplete } from './catalogAlbumResponse';
import {
	buildAlbumRequestCacheKey,
	cacheAlbumNotFound,
	clearCachedAlbumNotFound,
	createHttpStatusError,
	deletePendingAlbumRequest,
	getCachedAlbumNotFoundError,
	getPendingAlbumRequest,
	setPendingAlbumRequest
} from './catalogRequestState';
import type { CatalogAlbumLookupResult, CatalogApiContext } from './catalogTypes';

export async function getAlbum(
	context: CatalogApiContext,
	id: number,
	options?: { signal?: AbortSignal }
): Promise<CatalogAlbumLookupResult> {
	const cacheKey = buildAlbumRequestCacheKey(context.baseUrl, id);
	const cachedNotFound = getCachedAlbumNotFoundError(cacheKey);
	if (cachedNotFound) {
		throw cachedNotFound;
	}

	const shouldUsePendingCache = !options?.signal;
	if (shouldUsePendingCache) {
		const pendingRequest = getPendingAlbumRequest(cacheKey);
		if (pendingRequest) {
			return pendingRequest;
		}
	}

	const lookupPromise = (async () => {
		const response = await context.fetch(`${context.baseUrl}/album/?id=${id}`, {
			signal: options?.signal
		});
		context.ensureNotRateLimited(response);
		if (!response.ok) {
			if (response.status === 404) {
				cacheAlbumNotFound(cacheKey);
			}
			throw createHttpStatusError('Failed to get album', response.status);
		}

		const data = await response.json();
		const result = parseAlbumLookupPayload(data);
		if (!result) {
			cacheAlbumNotFound(cacheKey);
			throw createHttpStatusError('Album not found', 404);
		}

		warnIfAlbumTrackListIncomplete(id, result.album, result.tracks);
		return result;
	})();

	if (shouldUsePendingCache) {
		setPendingAlbumRequest(cacheKey, lookupPromise);
	}

	try {
		const result = await lookupPromise;
		clearCachedAlbumNotFound(cacheKey);
		return result;
	} finally {
		if (shouldUsePendingCache) {
			deletePendingAlbumRequest(cacheKey);
		}
	}
}
