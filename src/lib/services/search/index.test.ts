import { describe, expect, it, vi } from 'vitest';
import type { SearchResults } from './searchService';

const mockSearchResults: SearchResults = {
	tracks: [],
	albums: [],
	artists: [],
	playlists: []
};

vi.mock('./searchService', () => ({
	executeTabSearch: async () => ({ success: true, results: mockSearchResults })
}));

vi.mock('./streamingUrlConversionService', () => ({
	convertStreamingUrl: async () => ({ success: true, data: { type: 'track' } }),
	precacheTrackStream: async () => undefined
}));

vi.mock('./playlistConversionService', () => ({
	convertSpotifyPlaylistToTracks: async () => ({
		successful: [],
		failed: [],
		total: 0
	}),
	isSpotifyPlaylistUrl: () => true
}));

describe('search services index', () => {
	it('re-exports search services', async () => {
		const module = await import('./index');
		const searchResult = await module.executeTabSearch('query', 'tracks', 'us');
		expect(searchResult).toEqual({ success: true, results: mockSearchResults });
		await expect(module.convertStreamingUrl('https://example.com')).resolves.toEqual({
			success: true,
			data: { type: 'track' }
		});
		await expect(module.precacheTrackStream(1, 'LOSSLESS')).resolves.toBeUndefined();
		const playlistResult = await module.convertSpotifyPlaylistToTracks('https://example.com');
		expect(playlistResult.total).toBe(0);
		expect(module.isSpotifyPlaylistUrl('https://example.com')).toBe(true);
	});
});
