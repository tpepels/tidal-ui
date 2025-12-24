import { BaseApiService } from './base-api.service';
import { CACHE_TTL } from '../constants';
import type { Album, Playlist, ArtistDetails, Lyrics, CoverImage, Track } from '../types';

export class ContentService extends BaseApiService {
	async getAlbum(id: number): Promise<{ album: Album; tracks: Track[] }> {
		const cacheKey = this.generateCacheKey(`/album/${id}`);

		return this.makeRequest<{ album: Album; tracks: Track[] }>(
			`/album/${id}`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.ALBUM
		);
	}

	async getArtist(id: number): Promise<ArtistDetails> {
		const cacheKey = this.generateCacheKey(`/artist/${id}`);

		return this.makeRequest<ArtistDetails>(
			`/artist/${id}`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.ARTIST
		);
	}

	async getPlaylist(uuid: string): Promise<{ playlist: Playlist; items: Array<{ item: Track }> }> {
		const cacheKey = this.generateCacheKey(`/playlist/${uuid}`);

		return this.makeRequest<{ playlist: Playlist; items: Array<{ item: Track }> }>(
			`/playlist/${uuid}`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.PLAYLIST
		);
	}

	async getLyrics(trackId: number): Promise<Lyrics> {
		const cacheKey = this.generateCacheKey(`/track/${trackId}/lyrics`);

		return this.makeRequest<Lyrics>(
			`/track/${trackId}/lyrics`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.LYRICS
		);
	}

	async searchCovers(query?: string, limit = 20): Promise<CoverImage[]> {
		const params: Record<string, unknown> = { limit };
		if (query) {
			params.query = query;
		}

		const cacheKey = this.generateCacheKey('/covers', params);

		return this.makeRequest<CoverImage[]>(
			`/covers${query ? `?query=${encodeURIComponent(query)}&limit=${limit}` : `?limit=${limit}`}`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.COVER
		);
	}
}
