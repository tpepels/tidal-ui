import { z } from 'zod';
import { normalizeSearchResponse, prepareAlbum, prepareArtist, prepareTrack } from './normalizers';
import { scoreAlbumForSelection } from '$lib/utils/albumSelection';
import { sortTopTracks } from '$lib/utils/topTracks';
import {
	AlbumWithTracksSchema,
	ApiV2ContainerSchema,
	CoverImageSchema,
	LyricsSchema,
	PlaylistWithTracksSchema,
	safeValidateApiResponse
} from '$lib/utils/schemas';
import type {
	Album,
	Artist,
	ArtistDetails,
	ArtistRecommendations,
	CoverImage,
	Lyrics,
	Playlist,
	Track
} from '$lib/types';

export type CatalogApiContext = {
	baseUrl: string;
	fetch: (url: string, options?: RequestInit) => Promise<Response>;
	ensureNotRateLimited: (response: Response) => void;
};

type CatalogHttpError = Error & { status?: number; cached?: boolean };

const ALBUM_NOT_FOUND_CACHE_TTL_MS = 5 * 60 * 1000;
const ALBUM_NOT_FOUND_CACHE_MAX_ENTRIES = 500;

const pendingAlbumRequests = new Map<string, Promise<{ album: Album; tracks: Track[] }>>();
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

function buildAlbumRequestCacheKey(context: CatalogApiContext, id: number): string {
	return `${context.baseUrl}|${id}`;
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

function cacheAlbumNotFound(cacheKey: string, now: number = Date.now()): void {
	if (isLocalBrowserRuntime()) {
		return;
	}
	albumNotFoundCache.set(cacheKey, now + ALBUM_NOT_FOUND_CACHE_TTL_MS);
	pruneAlbumNotFoundCache(now);
}

function createHttpStatusError(
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

function summarizeMissingAlbumTrackNumbers(
	album: Album,
	tracks: Track[]
): {
	expectedCount: number | null;
	missingTrackNumbers: number[];
} {
	const rawExpectedCount = Number(album.numberOfTracks);
	const expectedCount =
		Number.isFinite(rawExpectedCount) && rawExpectedCount > 0 ? Math.trunc(rawExpectedCount) : null;
	if (!expectedCount) {
		return { expectedCount: null, missingTrackNumbers: [] };
	}

	const observedTrackNumbers = new Set<number>();
	for (const track of tracks) {
		const trackNumber = Number(track.trackNumber);
		if (Number.isFinite(trackNumber) && trackNumber > 0) {
			observedTrackNumbers.add(Math.trunc(trackNumber));
		}
	}

	const missingTrackNumbers: number[] = [];
	for (let expected = 1; expected <= expectedCount; expected += 1) {
		if (!observedTrackNumbers.has(expected)) {
			missingTrackNumbers.push(expected);
		}
	}

	return { expectedCount, missingTrackNumbers };
}

function warnIfAlbumTrackListIncomplete(albumId: number, album: Album, tracks: Track[]): void {
	const { expectedCount, missingTrackNumbers } = summarizeMissingAlbumTrackNumbers(album, tracks);
	if (!expectedCount) {
		return;
	}
	if (tracks.length >= expectedCount && missingTrackNumbers.length === 0) {
		return;
	}

	const missingPart =
		missingTrackNumbers.length > 0
			? ` Missing track number(s): ${missingTrackNumbers.join(', ')}.`
			: '';
	console.warn(
		`[Catalog] Album ${albumId} returned ${tracks.length}/${expectedCount} track item(s).${missingPart}`
	);
}

function getCachedAlbumNotFoundError(
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

export async function getAlbum(
	context: CatalogApiContext,
	id: number,
	options?: { signal?: AbortSignal }
): Promise<{ album: Album; tracks: Track[] }> {
	const cacheKey = buildAlbumRequestCacheKey(context, id);
	const cachedNotFound = getCachedAlbumNotFoundError(cacheKey);
	if (cachedNotFound) {
		throw cachedNotFound;
	}

	const shouldUsePendingCache = !options?.signal;
	if (shouldUsePendingCache) {
		const pendingRequest = pendingAlbumRequests.get(cacheKey);
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

		safeValidateApiResponse({ data }, ApiV2ContainerSchema, {
			endpoint: 'catalog.album.container',
			allowUnvalidated: true
		});

		if (data && typeof data === 'object' && 'data' in data && 'items' in data.data) {
			const items = data.data.items;
			if (Array.isArray(items) && items.length > 0) {
				const firstItem = items[0];
				const firstTrack = firstItem.item || firstItem;

				if (firstTrack && firstTrack.album) {
					let albumEntry = prepareAlbum(firstTrack.album);

					if (!albumEntry.artist && firstTrack.artist) {
						albumEntry = { ...albumEntry, artist: firstTrack.artist };
					}

					const tracks = items
						.map((i: unknown) => {
							if (!i || typeof i !== 'object') return null;
							const itemObj = i as { item?: unknown };
							const t = (itemObj.item || itemObj) as Track;

							if (!t) return null;
							return prepareTrack({ ...t, album: albumEntry });
						})
						.filter((t): t is Track => t !== null);

					const result = { album: albumEntry, tracks };

					const finalValidation = safeValidateApiResponse(result, AlbumWithTracksSchema, {
						endpoint: 'catalog.album'
					});
					if (!finalValidation.success) {
						throw new Error('Album response validation failed');
					}

					warnIfAlbumTrackListIncomplete(id, result.album, result.tracks);

					return result;
				}
			}
		}

		const entries = Array.isArray(data) ? data : [data];

		let albumEntry: Album | undefined;
		let trackCollection: { items?: unknown[] } | undefined;

		for (const entry of entries) {
			if (!entry || typeof entry !== 'object') continue;

			if (!albumEntry && 'title' in entry && 'id' in entry && 'cover' in entry) {
				albumEntry = prepareAlbum(entry as Album);
				continue;
			}

			if (
				!trackCollection &&
				'items' in entry &&
				Array.isArray((entry as { items?: unknown[] }).items)
			) {
				trackCollection = entry as { items?: unknown[] };
			}
		}

		if (!albumEntry) {
			cacheAlbumNotFound(cacheKey);
			throw createHttpStatusError('Album not found', 404);
		}

		const tracks: Track[] = [];
		if (trackCollection?.items) {
			for (const rawItem of trackCollection.items) {
				if (!rawItem || typeof rawItem !== 'object') continue;

				let trackCandidate: Track | undefined;
				if ('item' in rawItem && rawItem.item && typeof rawItem.item === 'object') {
					trackCandidate = rawItem.item as Track;
				} else {
					trackCandidate = rawItem as Track;
				}

				if (!trackCandidate) continue;

				const candidateWithAlbum = trackCandidate.album
					? trackCandidate
					: ({ ...trackCandidate, album: albumEntry } as Track);
				tracks.push(prepareTrack(candidateWithAlbum));
			}
		}

		const result = { album: albumEntry, tracks };

		const finalValidation = safeValidateApiResponse(result, AlbumWithTracksSchema, {
			endpoint: 'catalog.album'
		});
		if (!finalValidation.success) {
			throw new Error('Album response validation failed');
		}

		warnIfAlbumTrackListIncomplete(id, result.album, result.tracks);

		return result;
	})();

	if (shouldUsePendingCache) {
		pendingAlbumRequests.set(cacheKey, lookupPromise);
	}

	try {
		const result = await lookupPromise;
		albumNotFoundCache.delete(cacheKey);
		return result;
	} finally {
		if (shouldUsePendingCache) {
			pendingAlbumRequests.delete(cacheKey);
		}
	}
}

export async function getPlaylist(
	context: CatalogApiContext,
	uuid: string
): Promise<{ playlist: Playlist; items: Array<{ item: Track }> }> {
	const response = await context.fetch(`${context.baseUrl}/playlist/?id=${uuid}`);
	context.ensureNotRateLimited(response);
	if (!response.ok) throw new Error('Failed to get playlist');
	const data = await response.json();

	let result: { playlist: Playlist; items: Array<{ item: Track }> };

	if (data && typeof data === 'object' && 'playlist' in data && 'items' in data) {
		result = {
			playlist: data.playlist as Playlist,
			items: data.items as Array<{ item: Track }>
		};
	} else {
		result = {
			playlist: Array.isArray(data) ? (data[0] as Playlist) : (data as Playlist),
			items: Array.isArray(data) && data[1] ? (data[1].items as Array<{ item: Track }>) : []
		};
	}

	const validationResult = safeValidateApiResponse(result, PlaylistWithTracksSchema, {
		endpoint: 'catalog.playlist'
	});
	if (!validationResult.success) {
		throw new Error('Playlist response validation failed');
	}

	return result;
}

export type ArtistFetchProgress = {
	receivedBytes: number;
	totalBytes?: number;
	percent?: number;
};

type ArtistFetchOptions = {
	onProgress?: (progress: ArtistFetchProgress) => void;
	officialEnrichment?: boolean;
	officialOrigin?: string;
	signal?: AbortSignal;
};

type OfficialDiscographyResponse = {
	enabled?: boolean;
	albums?: Album[];
	error?: string;
	reason?: string;
	count?: number;
};

type OfficialDiscographyFetchResult = {
	status: 'disabled' | 'error' | 'ok';
	albums: Album[];
	detail?: string;
};

async function fetchOfficialDiscography(
	artistId: number,
	options?: ArtistFetchOptions
): Promise<OfficialDiscographyFetchResult> {
	if (!options?.officialEnrichment) {
		return { status: 'disabled', albums: [], detail: 'disabled' };
	}

	const origin = options.officialOrigin?.trim();
	if (!origin) {
		return { status: 'disabled', albums: [], detail: 'missing_origin' };
	}

	try {
		const response = await fetch(`${origin}/api/artist/${artistId}/official-discography`, {
			signal: options?.signal
		});
		if (!response.ok) {
			return { status: 'error', albums: [], detail: `http_${response.status}` };
		}
		const payload = (await response.json()) as OfficialDiscographyResponse;
		if (!payload.enabled) {
			return { status: 'disabled', albums: [], detail: payload.reason ?? 'not_enabled' };
		}
		if (!Array.isArray(payload.albums)) {
			return { status: 'error', albums: [], detail: 'malformed_payload' };
		}
		return { status: 'ok', albums: payload.albums };
	} catch (error) {
		const detail = error instanceof Error ? error.message : 'fetch_failed';
		return { status: 'error', albums: [], detail };
	}
}

async function readJsonWithProgress(
	response: Response,
	onProgress?: (progress: ArtistFetchProgress) => void
): Promise<unknown> {
	if (!onProgress) {
		return response.json();
	}
	if (!response.body || typeof response.body.getReader !== 'function') {
		const text = await response.text();
		const receivedBytes = new TextEncoder().encode(text).byteLength;
		if (receivedBytes > 0) {
			onProgress({ receivedBytes, totalBytes: receivedBytes, percent: 1 });
		}
		return text ? JSON.parse(text) : null;
	}

	const contentLength = response.headers.get('content-length');
	const totalBytes = contentLength ? Number(contentLength) : undefined;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let receivedBytes = 0;
	// Always report initial progress, even without total bytes known
	if (onProgress) {
		onProgress({ receivedBytes, totalBytes, percent: totalBytes ? 0 : undefined });
	}

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			receivedBytes += value.byteLength;
			onProgress({
				receivedBytes,
				totalBytes,
				percent: totalBytes ? Math.min(1, receivedBytes / totalBytes) : undefined
			});
		}
	}

	if (totalBytes) {
		onProgress({ receivedBytes, totalBytes, percent: 1 });
	} else if (receivedBytes > 0) {
		onProgress({ receivedBytes, totalBytes: receivedBytes, percent: 1 });
	}

	const merged = new Uint8Array(receivedBytes);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}

	const text = new TextDecoder('utf-8').decode(merged);
	return text ? JSON.parse(text) : null;
}

export async function getArtist(
	context: CatalogApiContext,
	id: number,
	options?: ArtistFetchOptions
): Promise<ArtistDetails> {
	const requestKey = `${context.baseUrl}|${id}|${options?.officialEnrichment ? 'official' : 'default'}|${options?.officialOrigin ?? ''}`;
	const canDedupe = !options?.onProgress && !options?.signal;
	if (canDedupe) {
		const pending = pendingArtistRequests.get(requestKey);
		if (pending) {
			return pending;
		}
	}

	const requestPromise = (async (): Promise<ArtistDetails> => {
		const response = await context.fetch(`${context.baseUrl}/artist/?f=${id}`, {
			signal: options?.signal
		});
		context.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get artist');
		const data = await readJsonWithProgress(response, options?.onProgress);
		const entries = Array.isArray(data) ? data : [data];

		const visited = new Set<object>();
		const albumMap = new Map<number, Album>();
		const trackMap = new Map<number, Track>();
		type AlbumSource = 'album' | 'track' | 'enrichment';
		const albumSources = new Map<number, Set<AlbumSource>>();
		let artist: Artist | undefined;
		let enrichmentApplied = false;

		const parseNumericId = (value: unknown): number | null => {
			if (typeof value === 'number' && Number.isFinite(value)) return value;
			if (typeof value === 'string' && value.trim().length > 0) {
				const parsed = Number(value);
				if (Number.isFinite(parsed)) return parsed;
			}
			return null;
		};

		const markAlbumSource = (albumId: number, source: AlbumSource) => {
			const existing = albumSources.get(albumId) ?? new Set<AlbumSource>();
			existing.add(source);
			albumSources.set(albumId, existing);
		};

		const isTrackLike = (value: unknown): value is Track => {
			if (!value || typeof value !== 'object') return false;
			const candidate = value as Record<string, unknown>;
			const albumCandidate = candidate.album as unknown;
			return (
				typeof candidate.id === 'number' &&
				typeof candidate.title === 'string' &&
				typeof candidate.duration === 'number' &&
				'trackNumber' in candidate &&
				albumCandidate !== undefined &&
				albumCandidate !== null &&
				typeof albumCandidate === 'object'
			);
		};

		const isAlbumLike = (value: unknown): value is Album => {
			if (!value || typeof value !== 'object') return false;
			const candidate = value as Record<string, unknown>;
			const rawId = candidate.id;
			const id =
				typeof rawId === 'number'
					? rawId
					: typeof rawId === 'string' && rawId.trim().length > 0
						? Number(rawId)
						: Number.NaN;
			return Number.isFinite(id) && typeof candidate.title === 'string';
		};

		const isArtistLike = (value: unknown): value is Artist => {
			if (!value || typeof value !== 'object') return false;
			const candidate = value as Record<string, unknown>;
			return (
				typeof candidate.id === 'number' &&
				typeof candidate.name === 'string' &&
				typeof candidate.type === 'string' &&
				('artistRoles' in candidate || 'artistTypes' in candidate || 'url' in candidate)
			);
		};

		const recordArtist = (candidate: Artist | undefined, requestedArtistId: number) => {
			if (!candidate) return;
			const normalized = prepareArtist(candidate);

			if (!artist) {
				artist = normalized;
			} else if (normalized.id === requestedArtistId) {
				artist = normalized;
			} else if (artist.id !== requestedArtistId) {
				// Keep first artist when neither matches requested ID.
			}
		};

		const addAlbum = (candidate: Album | undefined, source: AlbumSource) => {
			if (!candidate) return;
			const rawId = (candidate as { id?: unknown }).id;
			const albumId =
				typeof rawId === 'number'
					? rawId
					: typeof rawId === 'string' && rawId.trim().length > 0
						? Number(rawId)
						: Number.NaN;
			if (!Number.isFinite(albumId)) return;
			const normalized = prepareAlbum({ ...candidate, id: albumId });
			markAlbumSource(normalized.id, source);
			const existing = albumMap.get(normalized.id);
			if (existing) {
				const merged = {
					...existing,
					...normalized,
					cover: normalized.cover || existing.cover,
					releaseDate: normalized.releaseDate || existing.releaseDate,
					numberOfTracks: normalized.numberOfTracks || existing.numberOfTracks,
					audioQuality: normalized.audioQuality || existing.audioQuality
				};
				albumMap.set(normalized.id, merged);
			} else {
				albumMap.set(normalized.id, normalized);
			}
			recordArtist(normalized.artist ?? normalized.artists?.[0], id);
		};

		const addTrack = (candidate: Track | undefined) => {
			if (!candidate || typeof candidate.id !== 'number') return;
			const normalized = prepareTrack({ ...candidate });
			if (!normalized.album) {
				return;
			}
			addAlbum(normalized.album, 'track');
			const knownAlbum = albumMap.get(normalized.album.id);
			if (knownAlbum) {
				normalized.album = knownAlbum;
			}
			trackMap.set(normalized.id, normalized);
			recordArtist(normalized.artist, id);
		};

		const parseModuleItems = (items: unknown) => {
			if (!Array.isArray(items)) return;
			for (const entry of items) {
				if (!entry || typeof entry !== 'object') {
					continue;
				}

				const candidate = 'item' in entry ? (entry as { item?: unknown }).item : entry;
				if (isAlbumLike(candidate)) {
					addAlbum(candidate as Album, 'album');
					const candidateId = Number((candidate as { id?: unknown }).id);
					const normalizedAlbum = Number.isFinite(candidateId)
						? albumMap.get(candidateId)
						: undefined;
					recordArtist(normalizedAlbum?.artist ?? normalizedAlbum?.artists?.[0], id);
					continue;
				}
				if (isTrackLike(candidate)) {
					addTrack(candidate as Track);
					continue;
				}

				scanValue(candidate);
			}
		};

		const scanValue = (value: unknown) => {
			if (!value) return;
			if (Array.isArray(value)) {
				const trackCandidates = value.filter(isTrackLike);
				if (trackCandidates.length > 0) {
					for (const track of trackCandidates) {
						addTrack(track);
					}
					return;
				}
				for (const entry of value) {
					scanValue(entry);
				}
				return;
			}

			if (typeof value !== 'object') {
				return;
			}

			const objectRef = value as Record<string, unknown>;
			if (visited.has(objectRef)) {
				return;
			}
			visited.add(objectRef);

			if (isArtistLike(objectRef)) {
				recordArtist(objectRef as Artist, id);
			}

			if ('modules' in objectRef && Array.isArray(objectRef.modules)) {
				for (const moduleEntry of objectRef.modules) {
					scanValue(moduleEntry);
				}
			}

			if (
				'pagedList' in objectRef &&
				objectRef.pagedList &&
				typeof objectRef.pagedList === 'object'
			) {
				const pagedList = objectRef.pagedList as { items?: unknown };
				parseModuleItems(pagedList.items);
			}

			if ('items' in objectRef && Array.isArray(objectRef.items)) {
				parseModuleItems(objectRef.items);
			}

			if ('rows' in objectRef && Array.isArray(objectRef.rows)) {
				parseModuleItems(objectRef.rows);
			}

			if ('listItems' in objectRef && Array.isArray(objectRef.listItems)) {
				parseModuleItems(objectRef.listItems);
			}

			for (const nested of Object.values(objectRef)) {
				scanValue(nested);
			}
		};

		for (const entry of entries) {
			scanValue(entry);
		}

		if (!artist) {
			const trackPrimaryArtist = Array.from(trackMap.values())
				.map((track) => track.artist ?? track.artists?.[0])
				.find(Boolean);
			const albumPrimaryArtist = Array.from(albumMap.values())
				.map((album) => album.artist ?? album.artists?.[0])
				.find(Boolean);
			recordArtist(trackPrimaryArtist ?? albumPrimaryArtist, id);
		}

		if (!artist) {
			try {
				const fallbackResponse = await context.fetch(`${context.baseUrl}/artist/?id=${id}`, {
					signal: options?.signal
				});
				context.ensureNotRateLimited(fallbackResponse);
				if (fallbackResponse.ok) {
					const fallbackData = await fallbackResponse.json();
					const baseArtist = Array.isArray(fallbackData) ? fallbackData[0] : fallbackData;
					if (baseArtist && typeof baseArtist === 'object') {
						recordArtist(baseArtist as Artist, id);
					}
				}
			} catch (fallbackError) {
				console.warn('Failed to fetch base artist details:', fallbackError);
			}
		}

		if (!artist) {
			throw new Error('Artist not found');
		}

		const MAX_ENRICHMENT_QUERIES = 4;
		type EnrichmentPassName = 'artist-name' | 'official-tidal';
		type EnrichmentPassResult = {
			name: EnrichmentPassName;
			query: string;
			returned: number;
			accepted: number;
			newlyAdded: number;
			total?: number;
		};

		const enrichmentPasses: EnrichmentPassResult[] = [];
		const seenEnrichmentQueries = new Set<string>();
		let enrichmentQueryCount = 0;
		let duplicateQueriesSkipped = 0;
		const normalizeAlbumVariantTitle = (value?: string): string =>
			(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
		const normalizeAlbumVariantQuality = (value?: string): string => {
			const normalized = (value ?? '').trim().toUpperCase();
			return normalized.length > 0 ? normalized : 'UNKNOWN';
		};
		const buildAlbumVariantKey = (album: Pick<Album, 'id' | 'title' | 'audioQuality'>): string => {
			const title = normalizeAlbumVariantTitle(album.title);
			const quality = normalizeAlbumVariantQuality(album.audioQuality);
			return title.length > 0
				? `title:${title}|quality:${quality}`
				: `id:${album.id}|quality:${quality}`;
		};
		const baselineAlbumVariantKeys = new Set(
			Array.from(albumMap.values(), (album) => buildAlbumVariantKey(album))
		);
		const ingestedAlbumVariantKeys = new Set(baselineAlbumVariantKeys);
		const enrichmentAddedVariantKeys = new Set<string>();

		const addEnrichmentAlbums = (items: Album[]): { accepted: number; newlyAdded: number } => {
			const accepted = new Set<string>();
			const newlyAddedBeforePass = enrichmentAddedVariantKeys.size;

			for (const rawAlbum of items) {
				const prepared = prepareAlbum(rawAlbum);
				const albumId = parseNumericId((prepared as { id?: unknown }).id);
				if (albumId === null) continue;
				const type = (prepared.type ?? '').toUpperCase();
				// Keep enrichment focused on album/EP releases; singles are shown from source payload only.
				if (type.includes('SINGLE')) {
					continue;
				}

				const artistIds = new Set<number>();
				const artistId = parseNumericId((prepared as { artist?: { id?: unknown } }).artist?.id);
				if (artistId !== null) artistIds.add(artistId);
				const artists = (prepared as { artists?: Array<{ id?: unknown }> }).artists;
				if (Array.isArray(artists)) {
					for (const candidateArtist of artists) {
						const parsedArtistId = parseNumericId(candidateArtist?.id);
						if (parsedArtistId !== null) artistIds.add(parsedArtistId);
					}
				}

				// Strict artist filtering: only keep albums that explicitly belong to requested artist.
				if (artistIds.size > 0 && !artistIds.has(id)) {
					continue;
				}

				const variantKey = buildAlbumVariantKey({ ...prepared, id: albumId });
				accepted.add(variantKey);
				if (ingestedAlbumVariantKeys.has(variantKey)) {
					continue;
				}
				ingestedAlbumVariantKeys.add(variantKey);
				addAlbum({ ...prepared, id: albumId }, 'enrichment');
				if (!baselineAlbumVariantKeys.has(variantKey)) {
					enrichmentAddedVariantKeys.add(variantKey);
				}
			}

			return {
				accepted: accepted.size,
				newlyAdded: enrichmentAddedVariantKeys.size - newlyAddedBeforePass
			};
		};

		const runEnrichmentSearch = async (
			name: EnrichmentPassName,
			query: string
		): Promise<EnrichmentPassResult | null> => {
			const trimmedQuery = query.trim();
			if (!trimmedQuery) return null;
			const normalizedQuery = trimmedQuery.toLowerCase();
			if (seenEnrichmentQueries.has(normalizedQuery)) {
				duplicateQueriesSkipped += 1;
				return null;
			}
			if (enrichmentQueryCount >= MAX_ENRICHMENT_QUERIES) {
				return null;
			}
			seenEnrichmentQueries.add(normalizedQuery);
			enrichmentQueryCount += 1;

			const searchResponse = await context.fetch(
				`${context.baseUrl}/search/?al=${encodeURIComponent(trimmedQuery)}`,
				{ signal: options?.signal }
			);
			context.ensureNotRateLimited(searchResponse);
			if (!searchResponse.ok) {
				const failedPass: EnrichmentPassResult = {
					name,
					query: trimmedQuery,
					returned: 0,
					accepted: 0,
					newlyAdded: 0
				};
				enrichmentPasses.push(failedPass);
				return failedPass;
			}

			const searchData = await searchResponse.json();
			const normalizedSearch = normalizeSearchResponse<Album>(searchData, 'albums');
			const enrichmentResult = addEnrichmentAlbums(normalizedSearch.items);
			const pass: EnrichmentPassResult = {
				name,
				query: trimmedQuery,
				total: normalizedSearch.totalNumberOfItems,
				returned: normalizedSearch.items.length,
				accepted: enrichmentResult.accepted,
				newlyAdded: enrichmentResult.newlyAdded
			};
			enrichmentPasses.push(pass);
			return pass;
		};

		const isPassTruncated = (pass?: EnrichmentPassResult | null): pass is EnrichmentPassResult =>
			Boolean(
				pass &&
				typeof pass.total === 'number' &&
				typeof pass.returned === 'number' &&
				pass.total > pass.returned
			);

		try {
			if (artist.name?.trim()) {
				await runEnrichmentSearch('artist-name', artist.name);
			}
		} catch (error) {
			console.warn(`[Catalog] Artist enrichment search failed for ${id}:`, error);
		}

		try {
			const officialFetch = await fetchOfficialDiscography(id, options);
			if (options?.officialEnrichment) {
				const officialAlbums = officialFetch.albums;
				const officialResult =
					officialFetch.status === 'ok' && officialAlbums.length > 0
						? addEnrichmentAlbums(officialAlbums)
						: { accepted: 0, newlyAdded: 0 };
				enrichmentPasses.push({
					name: 'official-tidal',
					query:
						officialFetch.status === 'ok'
							? 'official-discography'
							: `official-discography:${officialFetch.detail ?? officialFetch.status}`,
					total: officialAlbums.length,
					returned: officialAlbums.length,
					accepted: officialResult.accepted,
					newlyAdded: officialResult.newlyAdded
				});
			}
		} catch (error) {
			console.warn(`[Catalog] Official artist enrichment failed for ${id}:`, error);
		}

		const searchPasses = enrichmentPasses.filter((pass) => pass.name === 'artist-name');
		const truncatedPass = [...searchPasses].reverse().find((pass) => isPassTruncated(pass));
		const successfulPasses = searchPasses.filter(
			(pass) => pass.returned > 0 || pass.accepted > 0 || typeof pass.total === 'number'
		);
		const enrichmentSearchTotal = truncatedPass?.total;
		const enrichmentSearchReturned = truncatedPass?.returned;
		const enrichmentSearchAccepted = successfulPasses.reduce(
			(max, pass) => Math.max(max, pass.accepted),
			0
		);
		enrichmentApplied = enrichmentAddedVariantKeys.size > 0;

		const albums = Array.from(albumMap.values()).map((album) => {
			if (!album.artist && artist) {
				return { ...album, artist };
			}
			return album;
		});

		const albumById = new Map(albums.map((album) => [album.id, album] as const));

		const tracks = Array.from(trackMap.values()).map((track) => {
			const enrichedArtist = track.artist ?? artist;
			const album = track.album;
			const enrichedAlbum = album
				? (albumById.get(album.id) ?? (artist && !album.artist ? { ...album, artist } : album))
				: undefined;
			return {
				...track,
				artist: enrichedArtist ?? track.artist,
				album: enrichedAlbum ?? album
			};
		});

		const parseDate = (value?: string): number => {
			if (!value) return Number.NaN;
			const timestamp = Date.parse(value);
			return Number.isFinite(timestamp) ? timestamp : Number.NaN;
		};

		const buildAlbumKey = (album: Album): string => {
			if (Number.isFinite(album.id)) {
				return `id:${album.id}`;
			}
			if (album.upc && album.upc.trim().length > 0) {
				return `upc:${album.upc.trim()}`;
			}
			if (album.url && album.url.trim().length > 0) {
				return `url:${album.url.trim().toLowerCase()}`;
			}
			return `fallback:${(album.title ?? '').trim().toLowerCase()}`;
		};

		const dedupedAlbums = (() => {
			const byKey = new Map<string, Album>();
			for (const album of albums) {
				const key = buildAlbumKey(album);
				const existing = byKey.get(key);
				if (!existing) {
					byKey.set(key, album);
					continue;
				}
				if (scoreAlbumForSelection(album) > scoreAlbumForSelection(existing)) {
					byKey.set(key, album);
				}
			}
			return Array.from(byKey.values());
		})();

		const sortedAlbums = dedupedAlbums.sort((a, b) => {
			const timeA = parseDate(a.releaseDate);
			const timeB = parseDate(b.releaseDate);
			if (Number.isNaN(timeA) && Number.isNaN(timeB)) {
				return (b.popularity ?? 0) - (a.popularity ?? 0);
			}
			if (Number.isNaN(timeA)) return 1;
			if (Number.isNaN(timeB)) return -1;
			return timeB - timeA;
		});

		const sortedTracks = sortTopTracks(tracks, 100);

		const countBySource = (source: AlbumSource) =>
			Array.from(albumSources.values()).reduce(
				(sum, sourceSet) => sum + (sourceSet.has(source) ? 1 : 0),
				0
			);
		const sourceAlbumCount = countBySource('album');
		const trackDerivedAlbumCount = countBySource('track');
		const enrichedAlbumCount = enrichmentAddedVariantKeys.size;
		const searchLooksTruncated = Boolean(
			typeof enrichmentSearchTotal === 'number' &&
			typeof enrichmentSearchReturned === 'number' &&
			enrichmentSearchTotal > enrichmentSearchReturned
		);
		const passLabel = (passName?: EnrichmentPassName): string => {
			void passName;
			return 'Artist-name search';
		};
		const missingAlbumPayload = sourceAlbumCount === 0 && trackDerivedAlbumCount > 0;
		const mayBeIncomplete = searchLooksTruncated || missingAlbumPayload;
		const reason = searchLooksTruncated
			? `${passLabel(truncatedPass?.name)} returned ${enrichmentSearchReturned} of ${enrichmentSearchTotal} albums for this artist`
			: missingAlbumPayload
				? 'Source artist endpoint did not include an explicit album list'
				: undefined;

		return {
			...artist,
			albums: sortedAlbums,
			tracks: sortedTracks,
			discographyInfo: {
				mayBeIncomplete,
				reason,
				sourceAlbumCount,
				trackDerivedAlbumCount,
				enrichedAlbumCount,
				enrichmentApplied,
				searchAlbumCount: enrichmentSearchAccepted,
				searchTotalCount: enrichmentSearchTotal,
				searchReturnedCount: enrichmentSearchReturned,
				enrichmentDiagnostics: {
					queryBudget: MAX_ENRICHMENT_QUERIES,
					queryCount: enrichmentQueryCount,
					duplicateQueriesSkipped,
					budgetExhausted: enrichmentQueryCount >= MAX_ENRICHMENT_QUERIES,
					passes: enrichmentPasses.map((pass) => ({
						name: pass.name,
						query: pass.query,
						returned: pass.returned,
						accepted: pass.accepted,
						newlyAdded: pass.newlyAdded,
						total: pass.total
					}))
				}
			}
		};
	})();

	if (canDedupe) {
		pendingArtistRequests.set(requestKey, requestPromise);
	}

	try {
		return await requestPromise;
	} finally {
		if (canDedupe) {
			pendingArtistRequests.delete(requestKey);
		}
	}
}

type ArtistRecommendationOptions = {
	signal?: AbortSignal;
};

const MAX_RECOMMENDED_ARTISTS = 8;
const MAX_RECOMMENDED_ALBUMS = 8;
const ARTIST_MIX_PREFERRED_KEYS = ['ARTIST_MIX', 'MASTER_ARTIST_MIX', 'RADIO'] as const;

function parseArtistCandidate(value: unknown): Artist | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Record<string, unknown>;
	const rawId = candidate.id;
	const id =
		typeof rawId === 'number'
			? rawId
			: typeof rawId === 'string' && rawId.trim().length > 0
				? Number(rawId)
				: Number.NaN;
	if (!Number.isFinite(id)) return null;
	const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
	if (!name) return null;
	const rawType = typeof candidate.type === 'string' ? candidate.type.trim() : '';
	const fallbackType = Array.isArray(candidate.artistTypes)
		? candidate.artistTypes.find((entry) => typeof entry === 'string' && entry.trim().length > 0)
		: undefined;
	const normalized = prepareArtist({
		...(candidate as Partial<Artist>),
		id,
		name,
		type: rawType || fallbackType || 'ARTIST'
	} as Artist);
	return normalized;
}

function parseAlbumCandidate(value: unknown): Album | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Record<string, unknown>;
	const rawId = candidate.id;
	const id =
		typeof rawId === 'number'
			? rawId
			: typeof rawId === 'string' && rawId.trim().length > 0
				? Number(rawId)
				: Number.NaN;
	if (!Number.isFinite(id)) return null;
	const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
	if (!title) return null;
	const cover = typeof candidate.cover === 'string' ? candidate.cover : '';
	const videoCover =
		typeof candidate.videoCover === 'string' || candidate.videoCover === null
			? candidate.videoCover
			: null;
	return prepareAlbum({
		...(candidate as Partial<Album>),
		id,
		title,
		cover,
		videoCover
	} as Album);
}

function extractArtistFromArtistLookupPayload(payload: unknown): Artist | null {
	const container = Array.isArray(payload) ? payload[0] : payload;
	if (!container || typeof container !== 'object') return null;
	const objectRef = container as Record<string, unknown>;
	if (objectRef.artist && typeof objectRef.artist === 'object') {
		return parseArtistCandidate(objectRef.artist);
	}
	return parseArtistCandidate(container);
}

function extractArtistMixId(mixes: unknown): string | null {
	if (!mixes || typeof mixes !== 'object') return null;
	const mixMap = mixes as Record<string, unknown>;
	for (const key of ARTIST_MIX_PREFERRED_KEYS) {
		const candidate = mixMap[key];
		if (typeof candidate === 'string' && candidate.trim().length > 0) {
			return candidate.trim();
		}
	}
	for (const value of Object.values(mixMap)) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
}

function extractMixItems(payload: unknown): unknown[] {
	if (!payload || typeof payload !== 'object') {
		return [];
	}
	const objectRef = payload as Record<string, unknown>;
	if (Array.isArray(objectRef.items)) {
		return objectRef.items;
	}
	if (Array.isArray(objectRef.rows)) {
		return objectRef.rows;
	}
	if (objectRef.pagedList && typeof objectRef.pagedList === 'object') {
		const pagedItems = (objectRef.pagedList as { items?: unknown }).items;
		if (Array.isArray(pagedItems)) {
			return pagedItems;
		}
	}
	return [];
}

function getArtistAggregationKey(artist: Artist): string {
	return Number.isFinite(artist.id) ? `id:${artist.id}` : `name:${artist.name.toLowerCase()}`;
}

function getAlbumAggregationKey(album: Album): string {
	if (Number.isFinite(album.id)) {
		return `id:${album.id}`;
	}
	const title = album.title.trim().toLowerCase();
	return `title:${title}`;
}

function sortArtistsByScore(
	entries: Array<{ artist: Artist; score: number }>,
	limit: number
): Artist[] {
	return entries
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			const popularityA = a.artist.popularity ?? 0;
			const popularityB = b.artist.popularity ?? 0;
			if (popularityB !== popularityA) return popularityB - popularityA;
			return a.artist.name.localeCompare(b.artist.name);
		})
		.slice(0, limit)
		.map((entry) => entry.artist);
}

export async function getArtistRecommendations(
	context: CatalogApiContext,
	artistId: number,
	options?: ArtistRecommendationOptions
): Promise<ArtistRecommendations> {
	const requestKey = `${context.baseUrl}|recommendations|${artistId}`;
	const canDedupe = !options?.signal;
	if (canDedupe) {
		const pending = pendingArtistRecommendationRequests.get(requestKey);
		if (pending) {
			return pending;
		}
	}

	const requestPromise = (async (): Promise<ArtistRecommendations> => {
		const baseArtistResponse = await context.fetch(`${context.baseUrl}/artist/?id=${artistId}`, {
			signal: options?.signal
		});
		context.ensureNotRateLimited(baseArtistResponse);
		if (!baseArtistResponse.ok) {
			return {
				source: 'none',
				reason: `artist_lookup_http_${baseArtistResponse.status}`,
				artists: [],
				albums: []
			};
		}
		const baseArtistPayload = await baseArtistResponse.json();
		const baseArtist = extractArtistFromArtistLookupPayload(baseArtistPayload);
		if (!baseArtist) {
			return {
				source: 'none',
				reason: 'artist_lookup_missing_artist',
				artists: [],
				albums: []
			};
		}

		const mixId = extractArtistMixId((baseArtist as { mixes?: unknown }).mixes);
		if (!mixId) {
			return {
				source: 'none',
				reason: 'artist_lookup_missing_mix',
				artists: [],
				albums: []
			};
		}

		const mixResponse = await context.fetch(
			`${context.baseUrl}/mix/?id=${encodeURIComponent(mixId)}`,
			{ signal: options?.signal }
		);
		context.ensureNotRateLimited(mixResponse);
		if (!mixResponse.ok) {
			return {
				source: 'none',
				reason: `mix_lookup_http_${mixResponse.status}`,
				mixId,
				artists: [],
				albums: []
			};
		}

		const mixPayload = await mixResponse.json();
		const mixObject =
			mixPayload && typeof mixPayload === 'object'
				? ((mixPayload as { mix?: unknown }).mix as Record<string, unknown> | undefined)
				: undefined;
		const mixTitle = typeof mixObject?.title === 'string' ? mixObject.title : undefined;
		const mixSubtitle = typeof mixObject?.subTitle === 'string' ? mixObject.subTitle : undefined;

		const mixItems = extractMixItems(mixPayload);
		if (mixItems.length === 0) {
			return {
				source: 'artist-mix',
				reason: 'mix_empty',
				mixId,
				mixTitle,
				mixSubtitle,
				artists: [],
				albums: []
			};
		}

		const artistScores = new Map<string, { artist: Artist; score: number }>();
		const albumScores = new Map<
			string,
			{
				album: Album;
				score: number;
				artistScores: Map<string, { artist: Artist; score: number }>;
			}
		>();

		for (const rawItem of mixItems) {
			const candidate =
				rawItem && typeof rawItem === 'object' && 'item' in rawItem
					? (rawItem as { item?: unknown }).item
					: rawItem;
			if (!candidate || typeof candidate !== 'object') {
				continue;
			}
			const trackCandidate = candidate as Record<string, unknown>;
			const rawArtists = Array.isArray(trackCandidate.artists) ? trackCandidate.artists : [];
			const trackArtists: Artist[] = [];
			const seenTrackArtists = new Set<string>();

			for (const rawArtist of rawArtists) {
				const artist = parseArtistCandidate(rawArtist);
				if (!artist) continue;
				const key = getArtistAggregationKey(artist);
				if (seenTrackArtists.has(key)) continue;
				seenTrackArtists.add(key);
				trackArtists.push(artist);
			}

			const nonSourceArtists = trackArtists.filter((artist) => artist.id !== artistId);
			for (const recommendationArtist of nonSourceArtists) {
				const key = getArtistAggregationKey(recommendationArtist);
				const existing = artistScores.get(key);
				if (existing) {
					existing.score += 1;
				} else {
					artistScores.set(key, { artist: recommendationArtist, score: 1 });
				}
			}

			const album = parseAlbumCandidate(trackCandidate.album);
			if (!album) continue;
			const albumKey = getAlbumAggregationKey(album);
			const albumEntry = albumScores.get(albumKey) ?? {
				album,
				score: 0,
				artistScores: new Map<string, { artist: Artist; score: number }>()
			};
			albumEntry.score += 1;
			const contributingArtists = nonSourceArtists.length > 0 ? nonSourceArtists : trackArtists;
			for (const recommendationArtist of contributingArtists) {
				const key = getArtistAggregationKey(recommendationArtist);
				const existing = albumEntry.artistScores.get(key);
				if (existing) {
					existing.score += 1;
				} else {
					albumEntry.artistScores.set(key, { artist: recommendationArtist, score: 1 });
				}
			}
			albumScores.set(albumKey, albumEntry);
		}

		const artists = sortArtistsByScore(Array.from(artistScores.values()), MAX_RECOMMENDED_ARTISTS);

		const rankedAlbums: Array<{ score: number; album: Album }> = [];
		for (const entry of albumScores.values()) {
			const rankedArtists = sortArtistsByScore(
				Array.from(entry.artistScores.values()),
				MAX_RECOMMENDED_ARTISTS
			);
			const bestArtist = rankedArtists.find((candidate) => candidate.id !== artistId);
			if (!bestArtist) {
				continue;
			}
			rankedAlbums.push({
				score: entry.score,
				album: {
					...entry.album,
					artist: bestArtist,
					artists: [bestArtist]
				}
			});
		}

		const albums = rankedAlbums
			.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				const popularityA = a.album.popularity ?? 0;
				const popularityB = b.album.popularity ?? 0;
				if (popularityB !== popularityA) return popularityB - popularityA;
				return a.album.title.localeCompare(b.album.title);
			})
			.slice(0, MAX_RECOMMENDED_ALBUMS)
			.map((entry) => entry.album);

		return {
			source: 'artist-mix',
			mixId,
			mixTitle,
			mixSubtitle,
			artists,
			albums,
			reason:
				artists.length === 0 && albums.length === 0
					? 'mix_contains_no_non_source_recommendations'
					: undefined
		};
	})();

	if (canDedupe) {
		pendingArtistRecommendationRequests.set(requestKey, requestPromise);
	}

	try {
		return await requestPromise;
	} finally {
		if (canDedupe) {
			pendingArtistRecommendationRequests.delete(requestKey);
		}
	}
}

export async function getCover(
	context: CatalogApiContext,
	id?: number,
	query?: string
): Promise<CoverImage[]> {
	let url = `${context.baseUrl}/cover/?`;
	if (id) url += `id=${id}`;
	if (query) url += `q=${encodeURIComponent(query)}`;
	const response = await context.fetch(url);
	context.ensureNotRateLimited(response);
	if (!response.ok) throw new Error('Failed to get cover');
	const data = await response.json();

	const validationResult = safeValidateApiResponse(data, z.array(CoverImageSchema), {
		endpoint: 'catalog.cover',
		allowUnvalidated: true
	});
	return validationResult.success ? validationResult.data : data;
}

export async function getLyrics(context: CatalogApiContext, id: number): Promise<Lyrics> {
	const response = await context.fetch(`${context.baseUrl}/lyrics/?id=${id}`);
	context.ensureNotRateLimited(response);
	if (!response.ok) throw new Error('Failed to get lyrics');
	const data = await response.json();
	const lyrics = Array.isArray(data) ? data[0] : data;

	const validationResult = safeValidateApiResponse(lyrics, LyricsSchema, {
		endpoint: 'catalog.lyrics',
		allowUnvalidated: true
	});
	return validationResult.success ? validationResult.data : lyrics;
}
