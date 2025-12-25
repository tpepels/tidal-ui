import { BaseApiService } from './base-api.service';
import { CACHE_TTL, AUDIO_QUALITIES } from '../constants';
import type { TrackLookup, StreamData, AudioQuality } from '../types';

export class PlaybackService extends BaseApiService {
	async getTrackInfo(
		trackId: number,
		quality: AudioQuality = AUDIO_QUALITIES.LOSSLESS
	): Promise<TrackLookup> {
		const cacheKey = this.generateCacheKey(`/tracks/${trackId}`, { quality });

		return this.makeRequest<TrackLookup>(
			`/tracks/${trackId}?quality=${quality}`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.TRACK
		);
	}

	async getStreamData(
		trackId: number,
		quality: AudioQuality = AUDIO_QUALITIES.LOSSLESS
	): Promise<StreamData> {
		const cacheKey = this.generateCacheKey(`/tracks/${trackId}/stream`, { quality });

		return this.makeRequest<StreamData>(
			`/tracks/${trackId}/stream?quality=${quality}`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.TRACK
		);
	}

	async getDashManifest(trackId: number, quality: AudioQuality = AUDIO_QUALITIES.HI_RES_LOSSLESS) {
		const cacheKey = this.generateCacheKey(`/tracks/${trackId}/dash`, { quality });

		return this.makeRequest(
			`/tracks/${trackId}/dash?quality=${quality}`,
			{ apiVersion: 'v2' },
			cacheKey,
			CACHE_TTL.TRACK
		);
	}

	getCoverUrl(coverId: string, size: '1280' | '640' | '320' | '160' | '80' = '640'): string {
		return `${this.baseUrl}/covers/${coverId}?size=${size}`;
	}

	getArtistPictureUrl(pictureId: string, size: '750' = '750'): string {
		return `${this.baseUrl}/artists/${pictureId}/picture?size=${size}`;
	}

	formatDuration(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) {
			return '0:00';
		}

		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const remainingSeconds = Math.floor(seconds % 60);

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
		}

		return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
	}
}
