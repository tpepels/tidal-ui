import { BaseApiService, type SearchResponse } from './base-api.service';
import { CACHE_TTL } from '../constants';
import type { Track, Album, Artist, Playlist } from '../types';
import type { RegionOption } from '../stores/region';

export class SearchService extends BaseApiService {
	async searchTracks(
		query: string,
		region: RegionOption = 'auto',
		limit = 50,
		offset = 0
	): Promise<SearchResponse<Track>> {
		const cacheKey = this.generateCacheKey('/search', {
			s: query,
			limit,
			offset
		});

		return this.makeRequest<SearchResponse<Track>>(
			`/search/?s=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.SEARCH
		);
	}

	async searchAlbums(
		query: string,
		region: RegionOption = 'auto',
		limit = 50,
		offset = 0
	): Promise<SearchResponse<Album>> {
		const cacheKey = this.generateCacheKey('/search', {
			al: query,
			limit,
			offset
		});

		return this.makeRequest<SearchResponse<Album>>(
			`/search/?al=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.SEARCH
		);
	}

	async searchArtists(
		query: string,
		region: RegionOption = 'auto',
		limit = 50,
		offset = 0
	): Promise<SearchResponse<Artist>> {
		const cacheKey = this.generateCacheKey('/search', {
			a: query,
			limit,
			offset
		});

		return this.makeRequest<SearchResponse<Artist>>(
			`/search/?a=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.SEARCH
		);
	}

	async searchPlaylists(
		query: string,
		region: RegionOption = 'auto',
		limit = 50,
		offset = 0
	): Promise<SearchResponse<Playlist>> {
		const cacheKey = this.generateCacheKey('/search', {
			p: query,
			limit,
			offset
		});

		return this.makeRequest<SearchResponse<Playlist>>(
			`/search/?p=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.SEARCH
		);
	}

	async searchAll(
		query: string,
		region: RegionOption = 'auto'
	): Promise<{
		tracks: SearchResponse<Track>;
		albums: SearchResponse<Album>;
		artists: SearchResponse<Artist>;
		playlists: SearchResponse<Playlist>;
	}> {
		const [tracks, albums, artists, playlists] = await Promise.allSettled([
			this.searchTracks(query, region, 10),
			this.searchAlbums(query, region, 10),
			this.searchArtists(query, region, 10),
			this.searchPlaylists(query, region, 10)
		]);

		return {
			tracks: tracks.status === 'fulfilled' ? tracks.value : { items: [] },
			albums: albums.status === 'fulfilled' ? albums.value : { items: [] },
			artists: artists.status === 'fulfilled' ? artists.value : { items: [] },
			playlists: playlists.status === 'fulfilled' ? playlists.value : { items: [] }
		};
	}
}
