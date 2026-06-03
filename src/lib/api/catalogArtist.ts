import { normalizeSearchResponse, prepareAlbum, prepareArtist, prepareTrack } from './normalizers';
import { fetchOfficialDiscography, readJsonWithProgress, type ArtistFetchOptions } from './catalogArtistTransport';
import { deletePendingArtistRequest, getPendingArtistRequest, setPendingArtistRequest } from './catalogRequestState';
import { scoreAlbumForSelection } from '$lib/utils/albumSelection';
import { sortTopTracks } from '$lib/utils/topTracks';
import type { Album, Artist, ArtistDetails, Track } from '$lib/types';
import type { CatalogApiContext } from './catalogTypes';

const ARTIST_ENRICHMENT_SEARCH_LIMIT = 500;
const ARTIST_ENRICHMENT_SEARCH_OFFSET = 0;

export async function getArtist(
	context: CatalogApiContext,
	id: number,
	options?: ArtistFetchOptions
): Promise<ArtistDetails> {
	const requestKey = `${context.baseUrl}|${id}|${options?.officialEnrichment ? 'official' : 'default'}|${options?.officialOrigin ?? ''}`;
	const canDedupe = !options?.onProgress && !options?.signal;
	if (canDedupe) {
		const pending = getPendingArtistRequest(requestKey);
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
			const parsedId =
				typeof rawId === 'number'
					? rawId
					: typeof rawId === 'string' && rawId.trim().length > 0
						? Number(rawId)
						: Number.NaN;
			return Number.isFinite(parsedId) && typeof candidate.title === 'string';
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

		const pickRequestedArtist = (
			candidates: Array<Artist | undefined>,
			requestedArtistId: number
		): Artist | undefined => {
			for (const candidate of candidates) {
				const candidateId = parseNumericId(candidate?.id);
				if (candidateId === requestedArtistId) {
					return prepareArtist({ ...(candidate as Artist), id: candidateId });
				}
			}
			return undefined;
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
			const requestedArtist = pickRequestedArtist(
				[normalized.artist, ...(normalized.artists ?? [])],
				id
			);
			const pageScopedAlbum =
				requestedArtist && normalized.artist?.id !== requestedArtist.id
					? { ...normalized, artist: requestedArtist }
					: normalized;
			markAlbumSource(pageScopedAlbum.id, source);
			const existing = albumMap.get(pageScopedAlbum.id);
			if (existing) {
				const merged = {
					...existing,
					...pageScopedAlbum,
					cover: pageScopedAlbum.cover || existing.cover,
					releaseDate: pageScopedAlbum.releaseDate || existing.releaseDate,
					numberOfTracks: pageScopedAlbum.numberOfTracks || existing.numberOfTracks,
					audioQuality: pageScopedAlbum.audioQuality || existing.audioQuality
				};
				albumMap.set(pageScopedAlbum.id, merged);
			} else {
				albumMap.set(pageScopedAlbum.id, pageScopedAlbum);
			}
			recordArtist(requestedArtist ?? pageScopedAlbum.artist ?? pageScopedAlbum.artists?.[0], id);
		};

		const addTrack = (candidate: Track | undefined) => {
			if (!candidate || typeof candidate.id !== 'number') return;
			const normalizedTrack = prepareTrack({ ...candidate });
			const requestedArtist = pickRequestedArtist(
				[
					normalizedTrack.artist,
					...(normalizedTrack.artists ?? []),
					normalizedTrack.album?.artist,
					...(normalizedTrack.album?.artists ?? [])
				],
				id
			);
			const normalized =
				requestedArtist && normalizedTrack.artist?.id !== requestedArtist.id
					? { ...normalizedTrack, artist: requestedArtist }
					: normalizedTrack;
			if (!normalized.album) {
				return;
			}
			addAlbum(normalized.album, 'track');
			const knownAlbum = albumMap.get(normalized.album.id);
			if (knownAlbum) {
				normalized.album = knownAlbum;
			}
			trackMap.set(normalized.id, normalized);
			recordArtist(requestedArtist ?? normalized.artist ?? normalized.artists?.[0], id);
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

		if (!artist || artist.id !== id) {
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

			const searchParams = new URLSearchParams({
				al: trimmedQuery,
				limit: String(ARTIST_ENRICHMENT_SEARCH_LIMIT),
				offset: String(ARTIST_ENRICHMENT_SEARCH_OFFSET)
			});
			const searchResponse = await context.fetch(
				`${context.baseUrl}/search/?${searchParams.toString()}`,
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
		setPendingArtistRequest(requestKey, requestPromise);
	}

	try {
		return await requestPromise;
	} finally {
		if (canDedupe) {
			deletePendingArtistRequest(requestKey);
		}
	}
}
