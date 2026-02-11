import { z } from 'zod';
import { normalizeSearchResponse, prepareAlbum, prepareArtist, prepareTrack } from './normalizers';
import {
	AlbumWithTracksSchema,
	ApiV2ContainerSchema,
	CoverImageSchema,
	LyricsSchema,
	PlaylistWithTracksSchema,
	safeValidateApiResponse
} from '$lib/utils/schemas';
import type { Album, Artist, ArtistDetails, CoverImage, Lyrics, Playlist, Track } from '$lib/types';

export type CatalogApiContext = {
	baseUrl: string;
	fetch: (url: string) => Promise<Response>;
	ensureNotRateLimited: (response: Response) => void;
};

export async function getAlbum(
	context: CatalogApiContext,
	id: number
): Promise<{ album: Album; tracks: Track[] }> {
	const response = await context.fetch(`${context.baseUrl}/album/?id=${id}`);
	context.ensureNotRateLimited(response);
	if (!response.ok) throw new Error('Failed to get album');
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
		throw new Error('Album not found');
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

	return result;
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
	options?: { onProgress?: (progress: ArtistFetchProgress) => void }
): Promise<ArtistDetails> {
	const response = await context.fetch(`${context.baseUrl}/artist/?f=${id}`);
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
		return (
			Number.isFinite(id) &&
			typeof candidate.title === 'string'
		);
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
			const fallbackResponse = await context.fetch(`${context.baseUrl}/artist/?id=${id}`);
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

	const albumsBeforeEnrichment = albumMap.size;
	const MAX_ENRICHMENT_QUERIES = 14;
	const MAX_TITLE_ENRICHMENT_QUERIES = 12;
	type EnrichmentPassName = 'artist-url' | 'artist-name' | 'album-title';
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

	const addEnrichmentAlbums = (items: Album[]): { accepted: number; newlyAdded: number } => {
		const accepted = new Set<number>();
		let newlyAdded = 0;

		for (const rawAlbum of items) {
			const prepared = prepareAlbum(rawAlbum);
			const albumId = parseNumericId((prepared as { id?: unknown }).id);
			if (albumId === null) continue;

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

			accepted.add(albumId);
			const alreadyKnown = albumMap.has(albumId);
			addAlbum({ ...prepared, id: albumId }, 'enrichment');
			if (!alreadyKnown && albumMap.has(albumId)) {
				newlyAdded += 1;
			}
		}

		return { accepted: accepted.size, newlyAdded };
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
			`${context.baseUrl}/search/?al=${encodeURIComponent(trimmedQuery)}`
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

	const isLikelyGenericSearchPage = (pass?: EnrichmentPassResult | null): boolean => {
		if (!pass) return false;
		if (!isPassTruncated(pass)) return false;
		if (pass.returned < 10) return false;
		return pass.accepted === 0 || pass.accepted / pass.returned < 0.2;
	};

	const collectTitleCandidates = (): string[] => {
		const normalizeTitle = (value: string) => value.trim().toLowerCase();
		const addUnique = (target: string[], value: unknown) => {
			if (typeof value !== 'string') return;
			const trimmed = value.trim();
			if (!trimmed) return;
			const normalized = normalizeTitle(trimmed);
			if (seenTitles.has(normalized)) return;
			seenTitles.add(normalized);
			target.push(trimmed);
		};
		const seenTitles = new Set<string>();

		const albumTitleCandidates = Array.from(albumMap.values())
			.sort((a, b) => {
				const dateA = a.releaseDate ? Date.parse(a.releaseDate) : Number.NaN;
				const dateB = b.releaseDate ? Date.parse(b.releaseDate) : Number.NaN;
				if (Number.isFinite(dateA) && Number.isFinite(dateB) && dateA !== dateB) {
					return dateB - dateA;
				}
				return (b.popularity ?? 0) - (a.popularity ?? 0);
			})
			.map((album) => album.title)
			.filter((title): title is string => typeof title === 'string' && title.trim().length > 0);

		type TrackTitleStat = { title: string; count: number; maxPopularity: number };
		const trackTitleStats = new Map<string, TrackTitleStat>();
		for (const track of trackMap.values()) {
			if (!track.title || track.title.trim().length < 2) continue;
			const normalized = normalizeTitle(track.title);
			const existing = trackTitleStats.get(normalized);
			if (existing) {
				existing.count += 1;
				existing.maxPopularity = Math.max(existing.maxPopularity, track.popularity ?? 0);
				continue;
			}
			trackTitleStats.set(normalized, {
				title: track.title.trim(),
				count: 1,
				maxPopularity: track.popularity ?? 0
			});
		}

		const sortedTrackTitles = Array.from(trackTitleStats.values()).sort((a, b) => {
			if (b.count !== a.count) return b.count - a.count;
			if (b.maxPopularity !== a.maxPopularity) return b.maxPopularity - a.maxPopularity;
			return a.title.localeCompare(b.title);
		});
		const trackPool = sortedTrackTitles.slice(0, 20).map((entry) => entry.title);
		const sampledTrackTitles: string[] = [];
		const sampleCount = Math.min(trackPool.length, 8);
		for (let i = 0; i < sampleCount; i += 1) {
			const index = Math.floor(((i + 0.5) * trackPool.length) / sampleCount);
			const candidate = trackPool[Math.min(index, trackPool.length - 1)];
			if (candidate) sampledTrackTitles.push(candidate);
		}

		const combined: string[] = [];
		for (const title of albumTitleCandidates.slice(0, 4)) {
			addUnique(combined, title);
		}
		for (const title of sampledTrackTitles) {
			addUnique(combined, title);
		}
		for (const title of albumTitleCandidates.slice(4)) {
			if (combined.length >= MAX_TITLE_ENRICHMENT_QUERIES) break;
			addUnique(combined, title);
		}

		return combined.slice(0, MAX_TITLE_ENRICHMENT_QUERIES);
	};

	try {
		const urlQuery = artist.url?.trim().length
			? artist.url
			: `https://tidal.com/artist/${id}`;
		const primaryPass = await runEnrichmentSearch('artist-url', urlQuery);
		const shouldRunArtistNameFallback =
			!primaryPass || primaryPass.accepted === 0 || isLikelyGenericSearchPage(primaryPass);
		let artistNamePass: EnrichmentPassResult | null = null;

		if (shouldRunArtistNameFallback && artist.name?.trim()) {
			artistNamePass = await runEnrichmentSearch('artist-name', artist.name);
		}

		const titlePassBase = artistNamePass ?? primaryPass;
		if (
			isPassTruncated(titlePassBase) &&
			titlePassBase.accepted > 0 &&
			artist.name?.trim().length > 0 &&
			enrichmentQueryCount < MAX_ENRICHMENT_QUERIES
		) {
			const titleCandidates = collectTitleCandidates();
			for (const title of titleCandidates) {
				if (enrichmentQueryCount >= MAX_ENRICHMENT_QUERIES) break;
				await runEnrichmentSearch('album-title', `${artist.name} ${title}`);
			}
		}
	} catch (error) {
		console.warn(`[Catalog] Artist enrichment search failed for ${id}:`, error);
	}

	const truncatedPass = [...enrichmentPasses].reverse().find((pass) => isPassTruncated(pass));
	const successfulPasses = enrichmentPasses.filter(
		(pass) => pass.returned > 0 || pass.accepted > 0 || typeof pass.total === 'number'
	);
	const enrichmentSearchTotal = truncatedPass?.total;
	const enrichmentSearchReturned = truncatedPass?.returned;
	const enrichmentSearchAccepted = successfulPasses.reduce(
		(max, pass) => Math.max(max, pass.accepted),
		0
	);
	enrichmentApplied = albumMap.size > albumsBeforeEnrichment;

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

	const scoreAlbum = (album: Album): number => {
		let score = 0;
		if (album.cover) score += 2;
		if (album.releaseDate) score += 1;
		if (album.numberOfTracks) score += 1;
		if (album.audioQuality) score += 1;
		return score;
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
			if (scoreAlbum(album) > scoreAlbum(existing)) {
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

	const sortedTracks = tracks
		.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
		.slice(0, 100);

	const countBySource = (source: AlbumSource) =>
		Array.from(albumSources.values()).reduce((sum, sourceSet) => sum + (sourceSet.has(source) ? 1 : 0), 0);
	const sourceAlbumCount = countBySource('album');
	const trackDerivedAlbumCount = countBySource('track');
	const enrichedAlbumCount = countBySource('enrichment');
	const searchLooksTruncated = Boolean(
		typeof enrichmentSearchTotal === 'number' &&
			typeof enrichmentSearchReturned === 'number' &&
			enrichmentSearchTotal > enrichmentSearchReturned
	);
	const passLabel = (passName?: EnrichmentPassName): string => {
		if (passName === 'artist-name') return 'Artist-name search';
		if (passName === 'album-title') return 'Album-title enrichment search';
		return 'Source search';
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
