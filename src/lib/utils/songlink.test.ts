import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	isSupportedStreamingUrl,
	isSpotifyPlaylistUrl,
	extractTidalInfo,
	getPlatformName,
	extractTidalSongEntity,
	SUPPORTED_PLATFORMS
} from './songlink';

// Mock fetch
global.fetch = vi.fn();

describe('Songlink Utils', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('isSupportedStreamingUrl', () => {
		it('recognizes supported platforms', () => {
			expect(isSupportedStreamingUrl('https://spotify.com/track/123')).toBe(true);
			expect(isSupportedStreamingUrl('https://tidal.com/track/456')).toBe(true);
			expect(isSupportedStreamingUrl('https://music.apple.com/album/789')).toBe(true);
		});

		it('rejects unsupported URLs', () => {
			expect(isSupportedStreamingUrl('https://example.com')).toBe(false);
			expect(isSupportedStreamingUrl('not-a-url')).toBe(false);
		});
	});

	describe('isSpotifyPlaylistUrl', () => {
		it('recognizes Spotify playlist URLs', () => {
			expect(isSpotifyPlaylistUrl('https://spotify.com/playlist/abc')).toBe(true);
		});

		it('rejects non-playlist URLs', () => {
			expect(isSpotifyPlaylistUrl('https://spotify.com/track/123')).toBe(false);
		});
	});

	describe('extractTidalInfo', () => {
		it('extracts TIDAL track info', () => {
			const response = {
				entityUniqueId: 'SONG::123',
				userCountry: 'US',
				pageUrl: 'https://song.link',
				entitiesByUniqueId: {},
				linksByPlatform: {
					tidal: {
						country: 'US',
						url: 'https://tidal.com/track/456',
						entityUniqueId: 'TIDAL_SONG::456'
					}
				}
			};
			const result = extractTidalInfo(response);
			expect(result).toEqual({
				type: 'track',
				id: '456',
				url: 'https://tidal.com/track/456'
			});
		});

		it('extracts TIDAL album info', () => {
			const response = {
				entityUniqueId: 'ALBUM::123',
				userCountry: 'US',
				pageUrl: 'https://song.link',
				entitiesByUniqueId: {},
				linksByPlatform: {
					tidal: {
						country: 'US',
						url: 'https://tidal.com/album/789',
						entityUniqueId: 'TIDAL_ALBUM::789'
					}
				}
			};
			const result = extractTidalInfo(response);
			expect(result).toEqual({
				type: 'album',
				id: '789',
				url: 'https://tidal.com/album/789'
			});
		});

		it('returns null if no TIDAL link', () => {
			const response = {
				entityUniqueId: 'SONG::123',
				userCountry: 'US',
				pageUrl: 'https://song.link',
				entitiesByUniqueId: {},
				linksByPlatform: {}
			};
			expect(extractTidalInfo(response)).toBeNull();
		});

		it('returns null for invalid TIDAL URL', () => {
			const response = {
				entityUniqueId: 'SONG::123',
				userCountry: 'US',
				pageUrl: 'https://song.link',
				entitiesByUniqueId: {},
				linksByPlatform: {
					tidal: {
						country: 'US',
						url: 'https://tidal.com/invalid',
						entityUniqueId: 'TIDAL_SONG::456'
					}
				}
			};
			expect(extractTidalInfo(response)).toBeNull();
		});
	});

	describe('getPlatformName', () => {
		it('returns platform name for supported URLs', () => {
			expect(getPlatformName('https://spotify.com/track/123')).toBe('Spotify');
			expect(getPlatformName('https://tidal.com/album/456')).toBe('TIDAL');
		});

		it('returns null for unsupported URLs', () => {
			expect(getPlatformName('https://example.com')).toBeNull();
		});
	});

	describe('extractTidalSongEntity', () => {
		it('returns primary TIDAL entity', () => {
			const response = {
				entityUniqueId: 'TIDAL_SONG::123',
				userCountry: 'US',
				pageUrl: 'https://song.link',
				entitiesByUniqueId: {
					'TIDAL_SONG::123': {
						id: '123',
						type: 'song' as const,
						title: 'Test Song',
						apiProvider: 'tidal',
						platforms: ['tidal']
					}
				},
				linksByPlatform: {}
			};
			const result = extractTidalSongEntity(response);
			expect(result?.title).toBe('Test Song');
		});

		it('returns fallback TIDAL entity', () => {
			const response = {
				entityUniqueId: 'SPOTIFY_SONG::456',
				userCountry: 'US',
				pageUrl: 'https://song.link',
				entitiesByUniqueId: {
					'TIDAL_SONG::789': {
						id: '789',
						type: 'song' as const,
						title: 'TIDAL Song',
						apiProvider: 'tidal',
						platforms: ['tidal']
					}
				},
				linksByPlatform: {}
			};
			const result = extractTidalSongEntity(response);
			expect(result?.title).toBe('TIDAL Song');
		});

		it('returns null if no TIDAL entity', () => {
			const response = {
				entityUniqueId: 'SPOTIFY_SONG::456',
				userCountry: 'US',
				pageUrl: 'https://song.link',
				entitiesByUniqueId: {},
				linksByPlatform: {}
			};
			expect(extractTidalSongEntity(response)).toBeNull();
		});
	});

	describe('SUPPORTED_PLATFORMS', () => {
		it('includes all expected platforms', () => {
			const ids = SUPPORTED_PLATFORMS.map((p) => p.id);
			expect(ids).toContain('spotify');
			expect(ids).toContain('tidal');
			expect(ids).toContain('appleMusic');
			expect(ids).toContain('youtubeMusic');
		});
	});
});
