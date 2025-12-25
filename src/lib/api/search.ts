import type { RegionOption } from '../stores/region';
import type { Track, Artist, Album, Playlist, SearchResponse } from '../types';
import { LosslessAPI } from './client';

/**
 * Search functionality for the Tidal API
 */
export class SearchAPI extends LosslessAPI {
	/**
	 * Search for tracks
	 */
	async searchTracks(query: string, region: RegionOption = 'auto'): Promise<SearchResponse<Track>> {
		const response = await this.fetch(
			this.buildRegionalUrl(`/search/?s=${encodeURIComponent(query)}`, region)
		);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search tracks');
		const data = await response.json();
		const normalized = this.normalizeSearchResponse<Track>(data, 'tracks');
		return {
			...normalized,
			items: normalized.items.map((track) => this.prepareTrack(track))
		};
	}

	/**
	 * Search for artists
	 */
	async searchArtists(
		query: string,
		region: RegionOption = 'auto'
	): Promise<SearchResponse<Artist>> {
		const response = await this.fetch(
			this.buildRegionalUrl(`/search/?a=${encodeURIComponent(query)}`, region)
		);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search artists');
		const data = await response.json();
		const normalized = this.normalizeSearchResponse<Artist>(data, 'artists');
		return {
			...normalized,
			items: normalized.items.map((artist) => this.prepareArtist(artist))
		};
	}

	/**
	 * Search for albums
	 */
	async searchAlbums(query: string, region: RegionOption = 'auto'): Promise<SearchResponse<Album>> {
		const response = await this.fetch(
			this.buildRegionalUrl(`/search/?al=${encodeURIComponent(query)}`, region)
		);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search albums');
		const data = await response.json();
		const normalized = this.normalizeSearchResponse<Album>(data, 'albums');
		return {
			...normalized,
			items: normalized.items.map((album) => this.prepareAlbum(album))
		};
	}

	/**
	 * Search for playlists
	 */
	async searchPlaylists(
		query: string,
		region: RegionOption = 'auto'
	): Promise<SearchResponse<Playlist>> {
		const response = await this.fetch(
			this.buildRegionalUrl(`/search/?p=${encodeURIComponent(query)}`, region)
		);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search playlists');
		const data = await response.json();
		return this.normalizeSearchResponse<Playlist>(data, 'playlists');
	}
}
