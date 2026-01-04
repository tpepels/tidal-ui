import { describe, expect, it, vi } from 'vitest';

vi.mock('./searchService', () => ({
	search: () => 'search'
}));

vi.mock('./streamingUrlConversionService', () => ({
	convertStreamingUrl: () => 'convert',
	precacheTrackStream: () => 'precache'
}));

vi.mock('./playlistConversionService', () => ({
	convertSpotifyPlaylistToTracks: () => 'playlist',
	isSpotifyPlaylistUrl: () => true
}));

describe('search services index', () => {
	it('re-exports search services', async () => {
		const module = await import('./index');
		expect(module.search()).toBe('search');
		expect(module.convertStreamingUrl()).toBe('convert');
		expect(module.precacheTrackStream()).toBe('precache');
		expect(module.convertSpotifyPlaylistToTracks()).toBe('playlist');
		expect(module.isSpotifyPlaylistUrl()).toBe(true);
	});
});
