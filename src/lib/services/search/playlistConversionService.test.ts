import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/utils/songlink', () => ({
	convertSpotifyPlaylist: vi.fn(async () => ['track:1', 'track:2']),
	fetchSonglinkData: vi.fn(async (url: string) => ({
		entityUniqueId: url,
		raw: 'data'
	})),
	extractTidalSongEntity: vi.fn((data: { entityUniqueId: string }) => {
		if (data.entityUniqueId === 'track:2') return null;
		return {
			id: '101',
			title: 'Song',
			artistName: 'Artist',
			thumbnailUrl: 'thumb'
		};
	})
}));

describe('playlistConversionService', () => {
	it('converts Spotify playlists and reports progress', async () => {
		const { convertSpotifyPlaylistToTracks } = await import('./playlistConversionService');
		const progress = vi.fn();
		const result = await convertSpotifyPlaylistToTracks('https://open.spotify.com/playlist/abc', {
			onProgress: progress,
			progressBatchSize: 1,
			progressThrottleMs: 0
		});
		expect(result.total).toBe(2);
		expect(result.successful).toHaveLength(1);
		expect(result.failed).toEqual(['track:2']);
		expect(progress).toHaveBeenCalled();
	});

	it('validates Spotify playlist URLs', async () => {
		const { isSpotifyPlaylistUrl } = await import('./playlistConversionService');
		expect(isSpotifyPlaylistUrl('spotify:playlist:xyz')).toBe(true);
		expect(isSpotifyPlaylistUrl('https://open.spotify.com/playlist/xyz')).toBe(true);
		expect(isSpotifyPlaylistUrl('https://example.com/track/xyz')).toBe(false);
	});
});
