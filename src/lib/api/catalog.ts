import { z } from 'zod';
import { CoverImageSchema, LyricsSchema, PlaylistWithTracksSchema, safeValidateApiResponse } from '$lib/utils/schemas';
import type { CoverImage, Lyrics, Playlist, Track } from '$lib/types';
import type { CatalogApiContext } from './catalogTypes';

export { getAlbum } from './catalogAlbum';
export { getArtist } from './catalogArtist';
export { getArtistRecommendations } from './catalogArtistRecommendations';
export type { ArtistFetchProgress } from './catalogArtistTransport';
export type { CatalogApiContext } from './catalogTypes';

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
