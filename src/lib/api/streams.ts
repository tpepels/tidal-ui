import type { AudioQuality } from '../types';
import { LosslessAPI } from './client';

/**
 * Stream URL resolution and track streaming functionality
 */
export class StreamsAPI extends LosslessAPI {
	/**
	 * Get track stream URL (simplified method)
	 */
	async getTrackStreamUrl(trackId: number, quality: AudioQuality = 'LOSSLESS'): Promise<string> {
		const response = await this.fetch(`${this.baseUrl}/url/?trackId=${trackId}&quality=${quality}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get track stream URL');
		const data = await response.json();

		if (data && typeof data === 'object' && 'url' in data && typeof data.url === 'string') {
			return data.url;
		}

		throw new Error('Unable to resolve track stream URL');
	}
}
