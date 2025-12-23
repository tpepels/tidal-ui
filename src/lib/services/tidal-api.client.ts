import { SearchService } from './search.service';
import { PlaybackService } from './playback.service';
import { ContentService } from './content.service';
import { TidalError } from '../errors';
import type { RegionOption } from '../stores/region';
import type {
	Track,
	Album,
	Artist,
	Playlist,
	TrackLookup,
	StreamData,
	ArtistDetails,
	Lyrics,
	CoverImage,
	AudioQuality,
	SonglinkTrack
} from '../types';
import type { SearchResponse } from './base-api.service';

export class TidalApiClient {
	private searchService: SearchService;
	private playbackService: PlaybackService;
	private contentService: ContentService;

	constructor(baseUrl?: string) {
		this.searchService = new SearchService(baseUrl);
		this.playbackService = new PlaybackService(baseUrl);
		this.contentService = new ContentService(baseUrl);
	}

	// Search methods
	async searchTracks(
		query: string,
		region: RegionOption = 'auto',
		limit = 50,
		offset = 0
	): Promise<SearchResponse<Track>> {
		return this.searchService.searchTracks(query, region, limit, offset);
	}

	async searchAlbums(
		query: string,
		region: RegionOption = 'auto',
		limit = 50,
		offset = 0
	): Promise<SearchResponse<Album>> {
		return this.searchService.searchAlbums(query, region, limit, offset);
	}

	async searchArtists(
		query: string,
		region: RegionOption = 'auto',
		limit = 50,
		offset = 0
	): Promise<SearchResponse<Artist>> {
		return this.searchService.searchArtists(query, region, limit, offset);
	}

	async searchPlaylists(
		query: string,
		region: RegionOption = 'auto',
		limit = 50,
		offset = 0
	): Promise<SearchResponse<Playlist>> {
		return this.searchService.searchPlaylists(query, region, limit, offset);
	}

	// Playback methods
	async getTrack(trackId: number, quality: AudioQuality = 'LOSSLESS'): Promise<TrackLookup> {
		return this.playbackService.getTrackInfo(trackId, quality);
	}

	async getStreamData(trackId: number, quality: AudioQuality = 'LOSSLESS'): Promise<StreamData> {
		return this.playbackService.getStreamData(trackId, quality);
	}

	async getDashManifest(trackId: number, quality: AudioQuality = 'HI_RES_LOSSLESS') {
		return this.playbackService.getDashManifest(trackId, quality);
	}

	// Content methods
	async getAlbum(id: number): Promise<{ album: Album; tracks: Track[] }> {
		return this.contentService.getAlbum(id);
	}

	async getArtist(id: number): Promise<ArtistDetails> {
		return this.contentService.getArtist(id);
	}

	async getPlaylist(uuid: string): Promise<{ playlist: Playlist; items: Array<{ item: Track }> }> {
		return this.contentService.getPlaylist(uuid);
	}

	async getLyrics(trackId: number): Promise<Lyrics> {
		return this.contentService.getLyrics(trackId);
	}

	async getCover(coverId: string): Promise<CoverImage[]> {
		return this.contentService.searchCovers(undefined, 1);
	}

	// Utility methods
	getCoverUrl(coverId: string, size: '1280' | '640' | '320' | '160' | '80' = '640'): string {
		return this.playbackService.getCoverUrl(coverId, size);
	}

	getArtistPictureUrl(pictureId: string, size: '750' = '750'): string {
		return this.playbackService.getArtistPictureUrl(pictureId, size);
	}

	formatDuration(seconds: number): string {
		return this.playbackService.formatDuration(seconds);
	}

	// Legacy methods for backward compatibility
	async importFromUrl(url: string): Promise<{ data: Track | Album | Artist | Playlist }> {
		throw new TidalError(
			'URL import not implemented in new architecture',
			'NOT_IMPLEMENTED',
			501,
			false
		);
	}

	async getSong(query: string, quality: AudioQuality = 'LOSSLESS'): Promise<StreamData> {
		throw new TidalError(
			'Song search not implemented in new architecture',
			'NOT_IMPLEMENTED',
			501,
			false
		);
	}
}

// Export only the class - consumers should create instances as needed
// This avoids SSR issues with singleton instantiation
