import type { Album, Artist, SearchResponse, Track } from '../types';
import { deriveTrackQuality } from '../utils/audioQuality';

type SearchKey = 'tracks' | 'albums' | 'artists' | 'playlists';

export function normalizeSearchResponse<T>(data: unknown, key: SearchKey): SearchResponse<T> {
	if (data === null || typeof data === 'undefined') {
		throw new Error('Malformed search response');
	}
	const section = findSearchSection<T>(data, key, new Set());
	return buildSearchResponse<T>(section);
}

function buildSearchResponse<T>(
	section: Partial<SearchResponse<T>> | undefined
): SearchResponse<T> {
	const items = section?.items;
	const list = Array.isArray(items) ? (items as T[]) : [];
	const limit = typeof section?.limit === 'number' ? section.limit : list.length;
	const offset = typeof section?.offset === 'number' ? section.offset : 0;
	const total =
		typeof section?.totalNumberOfItems === 'number' ? section.totalNumberOfItems : list.length;

	return {
		items: list,
		limit,
		offset,
		totalNumberOfItems: total
	};
}

function findSearchSection<T>(
	source: unknown,
	key: SearchKey,
	visited: Set<object>
): Partial<SearchResponse<T>> | undefined {
	if (!source) {
		return undefined;
	}

	if (Array.isArray(source)) {
		for (const entry of source) {
			const found = findSearchSection<T>(entry, key, visited);
			if (found) {
				return found;
			}
		}
		return undefined;
	}

	if (typeof source !== 'object') {
		return undefined;
	}

	const objectRef = source as Record<string, unknown>;
	if (visited.has(objectRef)) {
		return undefined;
	}
	visited.add(objectRef);

	if (!Array.isArray(source) && 'items' in objectRef && Array.isArray(objectRef.items)) {
		return objectRef as Partial<SearchResponse<T>>;
	}

	if (key in objectRef) {
		const nested = objectRef[key];
		const fromKey = findSearchSection<T>(nested, key, visited);
		if (fromKey) {
			return fromKey;
		}
	}

	for (const value of Object.values(objectRef)) {
		const found = findSearchSection<T>(value, key, visited);
		if (found) {
			return found;
		}
	}

	return undefined;
}

export function prepareTrack(track: Track): Track {
	let normalized = track;
	if (!track.artist && Array.isArray(track.artists) && track.artists.length > 0) {
		normalized = { ...track, artist: track.artists[0]! };
	}

	const derivedQuality = deriveTrackQuality(normalized);
	if (derivedQuality && normalized.audioQuality !== derivedQuality) {
		normalized = { ...normalized, audioQuality: derivedQuality };
	}

	return normalized;
}

export function prepareAlbum(album: Album): Album {
	if (!album.artist && Array.isArray(album.artists) && album.artists.length > 0) {
		return { ...album, artist: album.artists[0]! };
	}
	return album;
}

export function prepareArtist(artist: Artist): Artist {
	if (!artist.type && Array.isArray(artist.artistTypes) && artist.artistTypes.length > 0) {
		return { ...artist, type: artist.artistTypes[0]! } as Artist;
	}
	return artist;
}
