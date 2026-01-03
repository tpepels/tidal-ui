import { z } from 'zod';
import { prepareAlbum, prepareArtist, prepareTrack } from './normalizers';
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

	const validationResult = safeValidateApiResponse({ data }, ApiV2ContainerSchema);
	if (!validationResult.success) {
		console.warn(
			'Album API response validation failed, proceeding with unvalidated data:',
			validationResult.error
		);
	}

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

				const finalValidation = safeValidateApiResponse(result, AlbumWithTracksSchema);
				if (!finalValidation.success) {
					console.warn('Album with tracks validation failed:', finalValidation.error);
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

	const finalValidation = safeValidateApiResponse(result, AlbumWithTracksSchema);
	if (!finalValidation.success) {
		console.warn('Album with tracks validation failed:', finalValidation.error);
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

	const validationResult = safeValidateApiResponse(result, PlaylistWithTracksSchema);
	if (!validationResult.success) {
		console.warn('Playlist with tracks validation failed:', validationResult.error);
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
		return response.json();
	}

	const contentLength = response.headers.get('content-length');
	const totalBytes = contentLength ? Number(contentLength) : undefined;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let receivedBytes = 0;

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
	let artist: Artist | undefined;

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
		return (
			typeof candidate.id === 'number' &&
			typeof candidate.title === 'string' &&
			'cover' in candidate
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

	const addAlbum = (candidate: Album | undefined) => {
		if (!candidate || typeof candidate.id !== 'number') return;
		const normalized = prepareAlbum({ ...candidate });
		albumMap.set(normalized.id, normalized);
		recordArtist(normalized.artist ?? normalized.artists?.[0], id);
	};

	const addTrack = (candidate: Track | undefined) => {
		if (!candidate || typeof candidate.id !== 'number') return;
		const normalized = prepareTrack({ ...candidate });
		if (!normalized.album) {
			return;
		}
		addAlbum(normalized.album);
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
				addAlbum(candidate as Album);
				const normalizedAlbum = albumMap.get((candidate as Album).id);
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

	const sortedAlbums = albums.sort((a, b) => {
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

	return {
		...artist,
		albums: sortedAlbums,
		tracks: sortedTracks
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

	const validationResult = safeValidateApiResponse(data, z.array(CoverImageSchema));
	if (!validationResult.success) {
		console.warn(
			'Cover images validation failed, proceeding with unvalidated data:',
			validationResult.error
		);
	}

	return data;
}

export async function getLyrics(context: CatalogApiContext, id: number): Promise<Lyrics> {
	const response = await context.fetch(`${context.baseUrl}/lyrics/?id=${id}`);
	context.ensureNotRateLimited(response);
	if (!response.ok) throw new Error('Failed to get lyrics');
	const data = await response.json();
	const lyrics = Array.isArray(data) ? data[0] : data;

	const validationResult = safeValidateApiResponse(lyrics, LyricsSchema);
	if (!validationResult.success) {
		console.warn(
			'Lyrics validation failed, proceeding with unvalidated data:',
			validationResult.error
		);
	}

	return lyrics;
}
