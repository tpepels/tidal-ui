import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseTidalUrl, isTidalUrl } from './urlParser';

describe('URL Parser', () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
	});

	describe('isTidalUrl', () => {
		it('recognizes valid Tidal URLs', () => {
			expect(isTidalUrl('https://tidal.com/album/123')).toBe(true);
			expect(isTidalUrl('http://tidal.com/track/456')).toBe(true);
			expect(isTidalUrl('tidal.com/artist/789')).toBe(true);
			expect(isTidalUrl('https://listen.tidal.com/playlist/abc')).toBe(true);
		});

		it('rejects non-Tidal URLs', () => {
			expect(isTidalUrl('https://spotify.com/album/123')).toBe(false);
			expect(isTidalUrl('random string')).toBe(false);
			expect(isTidalUrl('')).toBe(false);
		});

		it('handles whitespace', () => {
			expect(isTidalUrl('  https://tidal.com/album/123  ')).toBe(true);
		});
	});

	describe('parseTidalUrl', () => {
		it('parses track URLs', () => {
			expect(parseTidalUrl('https://tidal.com/track/123')).toEqual({
				type: 'track',
				trackId: 123
			});
			expect(parseTidalUrl('https://tidal.com/browse/track/456')).toEqual({
				type: 'track',
				trackId: 456
			});
		});

		it('parses track URLs with album', () => {
			expect(parseTidalUrl('https://tidal.com/album/789/track/123')).toEqual({
				type: 'track',
				trackId: 123,
				albumId: 789
			});
		});

		it('parses album URLs', () => {
			expect(parseTidalUrl('https://tidal.com/album/456')).toEqual({
				type: 'album',
				albumId: 456
			});
			expect(parseTidalUrl('https://tidal.com/album/789/')).toEqual({
				type: 'album',
				albumId: 789
			});
		});

		it('parses artist URLs', () => {
			expect(parseTidalUrl('https://tidal.com/artist/101')).toEqual({
				type: 'artist',
				artistId: 101
			});
		});

		it('parses playlist URLs', () => {
			expect(parseTidalUrl('https://tidal.com/playlist/abc-def-123')).toEqual({
				type: 'playlist',
				playlistId: 'abc-def-123'
			});
		});

		it('parses URLs without protocol', () => {
			expect(parseTidalUrl('tidal.com/album/123')).toEqual({
				type: 'album',
				albumId: 123
			});
		});

		it('parses listen.tidal.com URLs', () => {
			expect(parseTidalUrl('https://listen.tidal.com/album/456')).toEqual({
				type: 'album',
				albumId: 456
			});
		});

		it('returns unknown for non-Tidal domains', () => {
			expect(parseTidalUrl('https://spotify.com/album/123')).toEqual({
				type: 'unknown'
			});
		});

		it('returns unknown for invalid paths', () => {
			expect(parseTidalUrl('https://tidal.com/invalid')).toEqual({
				type: 'unknown'
			});
			expect(parseTidalUrl('https://tidal.com/browse/invalid')).toEqual({
				type: 'unknown'
			});
		});

		it('handles invalid URLs gracefully', () => {
			expect(parseTidalUrl('not-a-url')).toEqual({
				type: 'unknown'
			});
			expect(parseTidalUrl('')).toEqual({
				type: 'unknown'
			});
		});

		it('ignores invalid IDs', () => {
			expect(parseTidalUrl('https://tidal.com/album/abc')).toEqual({
				type: 'unknown'
			});
			expect(parseTidalUrl('https://tidal.com/track/xyz')).toEqual({
				type: 'unknown'
			});
		});
	});
});
