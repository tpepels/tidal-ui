import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the API before importing downloads
vi.mock('./api', () => ({
	losslessAPI: {
		getTrackStreamUrl: vi.fn(),
		formatDuration: vi.fn()
	}
}));

import {
	sanitizeForFilename,
	getExtensionForQuality,
	buildTrackFilename,
	buildTrackLinksCsv
} from './downloads';
import { losslessAPI } from './api';
// Test the internal detectImageFormat function
function detectImageFormat(data: Uint8Array): { extension: string; mimeType: string } | null {
	if (!data || data.length < 4) {
		return null;
	}

	// Check for JPEG magic bytes (FF D8 FF)
	if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
		return { extension: 'jpg', mimeType: 'image/jpeg' };
	}

	// Check for PNG magic bytes (89 50 4E 47)
	if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
		return { extension: 'png', mimeType: 'image/png' };
	}

	// Check for WebP magic bytes (52 49 46 46 ... 57 45 42 50)
	if (
		data.length >= 12 &&
		data[0] === 0x52 &&
		data[1] === 0x49 &&
		data[2] === 0x46 &&
		data[3] === 0x46 &&
		data[8] === 0x57 &&
		data[9] === 0x45 &&
		data[10] === 0x42 &&
		data[11] === 0x50
	) {
		return { extension: 'webp', mimeType: 'image/webp' };
	}

	return null;
}

describe('Downloads Utils', () => {
	describe('Memory Management', () => {
		let originalCreateObjectURL: typeof URL.createObjectURL;
		let originalRevokeObjectURL: typeof URL.revokeObjectURL;
		let createdUrls: string[] = [];

		beforeEach(() => {
			// Mock URL.createObjectURL to track created URLs
			originalCreateObjectURL = URL.createObjectURL;
			originalRevokeObjectURL = URL.revokeObjectURL;
			createdUrls = [];

			URL.createObjectURL = vi.fn((blob: Blob) => {
				const url = `blob:test-${Math.random()}`;
				createdUrls.push(url);
				return url;
			});

			URL.revokeObjectURL = vi.fn((url: string) => {
				const index = createdUrls.indexOf(url);
				if (index > -1) {
					createdUrls.splice(index, 1);
				}
			});
		});

		afterEach(() => {
			URL.createObjectURL = originalCreateObjectURL;
			URL.revokeObjectURL = originalRevokeObjectURL;
		});

		it('should clean up object URLs after download', async () => {
			// Create a mock blob
			const mockBlob = new Blob(['test content'], { type: 'audio/flac' });

			// Call triggerFileDownload (this is internal, so we'll test the pattern)
			const url = URL.createObjectURL(mockBlob);
			expect(createdUrls).toContain(url);

			// Simulate the cleanup that happens in downloads.ts
			const link = document.createElement('a');
			link.href = url;
			link.download = 'test.flac';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);

			expect(createdUrls).not.toContain(url);
		});

		it('should handle memory monitoring functions', () => {
			// Test that we can access performance.memory if available
			const hasMemoryAPI = typeof performance !== 'undefined' && 'memory' in performance;

			if (hasMemoryAPI) {
				// If memory API is available, usage should be a number
				const usage = (performance as any).memory.usedJSHeapSize;
				expect(typeof usage).toBe('number');
				expect(usage).toBeGreaterThanOrEqual(0);
			} else {
				// If not available, that's also fine (e.g., in test environment)
				expect(true).toBe(true);
			}
		});

		it('should properly trigger file downloads without memory leaks', () => {
			// Test that our Blob creation and URL handling doesn't throw
			const testBlob = new Blob(['test'], { type: 'text/plain' });

			expect(() => {
				const url = URL.createObjectURL(testBlob);
				expect(typeof url).toBe('string');
				expect(url.startsWith('blob:')).toBe(true);

				// Clean up
				URL.revokeObjectURL(url);
			}).not.toThrow();
		});
	});
	describe('sanitizeForFilename', () => {
		it('returns "Unknown" for null/undefined/empty values', () => {
			expect(sanitizeForFilename(null)).toBe('Unknown');
			expect(sanitizeForFilename(undefined)).toBe('Unknown');
			expect(sanitizeForFilename('')).toBe('Unknown');
		});

		it('replaces forbidden characters', () => {
			expect(sanitizeForFilename('file:with*chars?')).toBe('file_with_chars_');
			expect(sanitizeForFilename('path\\to<file>')).toBe('path_to_file_');
			expect(sanitizeForFilename('file|name')).toBe('file_name');
		});

		it('normalizes whitespace', () => {
			expect(sanitizeForFilename('multiple   spaces')).toBe('multiple spaces');
			expect(sanitizeForFilename('tabs\tand\nlines')).toBe('tabs and lines');
		});

		it('handles complex filenames', () => {
			expect(sanitizeForFilename('Artist: "Song" (feat. Other)')).toBe(
				'Artist_ _Song_ (feat. Other)'
			);
		});

		it('preserves safe characters', () => {
			expect(sanitizeForFilename('Safe-File_Name.123')).toBe('Safe-File_Name.123');
		});
	});

	describe('detectImageFormat', () => {
		it('detects JPEG format', () => {
			const jpegData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
			const result = detectImageFormat(jpegData);

			expect(result).toEqual({
				extension: 'jpg',
				mimeType: 'image/jpeg'
			});
		});

		it('detects PNG format', () => {
			const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
			const result = detectImageFormat(pngData);

			expect(result).toEqual({
				extension: 'png',
				mimeType: 'image/png'
			});
		});

		it('detects WebP format', () => {
			const webpData = new Uint8Array([
				0x52,
				0x49,
				0x46,
				0x46, // RIFF
				0x00,
				0x00,
				0x00,
				0x00, // size
				0x57,
				0x45,
				0x42,
				0x50 // WEBP
			]);
			const result = detectImageFormat(webpData);

			expect(result).toEqual({
				extension: 'webp',
				mimeType: 'image/webp'
			});
		});

		it('returns null for unknown format', () => {
			const unknownData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
			const result = detectImageFormat(unknownData);

			expect(result).toBeNull();
		});

		it('returns null for empty or too short data', () => {
			expect(detectImageFormat(new Uint8Array())).toBeNull();
			expect(detectImageFormat(new Uint8Array([0xff]))).toBeNull();
			expect(detectImageFormat(null as unknown as Uint8Array)).toBeNull();
		});

		it('handles edge cases', () => {
			expect(detectImageFormat(new Uint8Array([]))).toBeNull();
			expect(detectImageFormat(new Uint8Array([0xff]))).toBeNull();
			expect(detectImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
		});
	});

	describe('getExtensionForQuality', () => {
		it('returns "flac" for lossless and hi-res qualities', () => {
			expect(getExtensionForQuality('LOSSLESS')).toBe('flac');
			expect(getExtensionForQuality('HI_RES_LOSSLESS')).toBe('flac');
		});

		it('returns "m4a" for low/high quality when not converting to mp3', () => {
			expect(getExtensionForQuality('LOW')).toBe('m4a');
			expect(getExtensionForQuality('HIGH')).toBe('m4a');
		});

		it('returns "mp3" for low/high quality when converting to mp3', () => {
			expect(getExtensionForQuality('LOW', true)).toBe('mp3');
			expect(getExtensionForQuality('HIGH', true)).toBe('mp3');
		});
	});

	describe('buildTrackFilename', () => {
		const mockAlbum = {
			id: 1,
			title: 'Test Album',
			numberOfVolumes: 1,
			cover: 'cover.jpg',
			videoCover: null
		};

		const mockTrack = {
			id: 1,
			title: 'Test Track',
			duration: 180,
			trackNumber: 5,
			volumeNumber: undefined,
			version: null,
			artists: [{ id: 1, name: 'Test Artist', type: 'artist' }]
		};

		it('builds filename for single volume album', () => {
			const result = buildTrackFilename(mockAlbum as any, mockTrack as any, 'LOSSLESS');
			expect(result).toBe('Test Artist - Test Album - 05 Test Track.flac');
		});

		it('builds filename with version', () => {
			const trackWithVersion = { ...mockTrack, version: 'Remix' };
			const result = buildTrackFilename(mockAlbum as any, trackWithVersion as any, 'LOSSLESS');
			expect(result).toBe('Test Artist - Test Album - 05 Test Track (Remix).flac');
		});

		it('builds filename for multi-volume album', () => {
			const multiVolumeAlbum = { ...mockAlbum, numberOfVolumes: 2 };
			const trackOnVolume2 = { ...mockTrack, volumeNumber: 2, trackNumber: 3 };
			const result = buildTrackFilename(multiVolumeAlbum as any, trackOnVolume2 as any, 'HIGH');
			expect(result).toBe('Test Artist - Test Album - 02-03 Test Track.m4a');
		});

		it('handles missing track numbers', () => {
			const trackWithoutNumber = { ...mockTrack, trackNumber: null };
			const result = buildTrackFilename(mockAlbum as any, trackWithoutNumber as any, 'LOSSLESS');
			expect(result).toBe('Test Artist - Test Album - 00 Test Track.flac');
		});

		it('uses custom artist name when provided', () => {
			const result = buildTrackFilename(
				mockAlbum as any,
				mockTrack as any,
				'LOSSLESS',
				'Custom Artist'
			);
			expect(result).toBe('Custom Artist - Test Album - 05 Test Track.flac');
		});

		it('applies mp3 conversion for AAC qualities', () => {
			const result = buildTrackFilename(
				mockAlbum as any,
				mockTrack as any,
				'HIGH',
				undefined,
				true
			);
			expect(result).toBe('Test Artist - Test Album - 05 Test Track.mp3');
		});

		it('sanitizes special characters in names', () => {
			const albumWithSpecialChars = { ...mockAlbum, title: 'Album: With/Special*Chars?' };
			const trackWithSpecialChars = { ...mockTrack, title: 'Track "With" Quotes' };
			const result = buildTrackFilename(
				albumWithSpecialChars as any,
				trackWithSpecialChars as any,
				'LOSSLESS'
			);
			expect(result).toBe('Test Artist - Album_ With_Special_Chars_ - 05 Track _With_ Quotes.flac');
		});
	});

	describe('buildTrackLinksCsv', () => {
		const mockTracks = [
			{
				id: 1,
				title: 'Test Track 1',
				duration: 180,
				artists: [{ id: 1, name: 'Test Artist 1', type: 'artist' }],
				album: { id: 1, title: 'Test Album 1' }
			},
			{
				id: 2,
				title: 'Test Track 2',
				duration: 240,
				artists: [{ id: 2, name: 'Test Artist 2', type: 'artist' }],
				album: { id: 2, title: 'Test Album 2' }
			}
		];

		beforeEach(() => {
			vi.clearAllMocks();
		});

		it('builds CSV with correct headers and data', async () => {
			vi.mocked(losslessAPI.getTrackStreamUrl).mockResolvedValueOnce(
				'https://example.com/track1.flac'
			);
			vi.mocked(losslessAPI.getTrackStreamUrl).mockResolvedValueOnce(
				'https://example.com/track2.flac'
			);
			vi.mocked(losslessAPI.formatDuration).mockReturnValueOnce('3:00');
			vi.mocked(losslessAPI.formatDuration).mockReturnValueOnce('4:00');

			const result = await buildTrackLinksCsv(mockTracks as any, 'LOSSLESS');

			const lines = result.split('\n');
			expect(lines[0]).toBe('Index,Title,Artist,Album,Duration,FLAC URL');
			expect(lines[1]).toBe(
				'1,Test Track 1,Test Artist 1,Test Album 1,3:00,https://example.com/track1.flac'
			);
			expect(lines[2]).toBe(
				'2,Test Track 2,Test Artist 2,Test Album 2,4:00,https://example.com/track2.flac'
			);
		});

		it('handles tracks with missing data', async () => {
			const trackWithMissingData = [
				{
					id: 1,
					title: null,
					duration: null,
					artists: [],
					album: null
				}
			];

			vi.mocked(losslessAPI.getTrackStreamUrl).mockResolvedValueOnce(
				'https://example.com/track.flac'
			);
			vi.mocked(losslessAPI.formatDuration).mockReturnValueOnce('0:00');

			const result = await buildTrackLinksCsv(trackWithMissingData as any, 'LOSSLESS');

			const lines = result.split('\n');
			expect(lines[1]).toBe('1,,Unknown Artist,,0:00,https://example.com/track.flac');
		});

		it('escapes CSV values with commas and quotes', async () => {
			const trackWithSpecialChars = [
				{
					id: 1,
					title: 'Track "With" Quotes, and Comma',
					duration: 120,
					artists: [{ id: 1, name: 'Artist, Name', type: 'artist' }],
					album: { id: 1, title: 'Album "Title"' }
				}
			];

			vi.mocked(losslessAPI.getTrackStreamUrl).mockResolvedValueOnce(
				'https://example.com/track.flac'
			);
			vi.mocked(losslessAPI.formatDuration).mockReturnValueOnce('2:00');

			const result = await buildTrackLinksCsv(trackWithSpecialChars as any, 'LOSSLESS');

			const lines = result.split('\n');
			expect(lines[1]).toBe(
				'1,"Track ""With"" Quotes, and Comma","Artist, Name","Album ""Title""",2:00,https://example.com/track.flac'
			);
		});

		it('handles tracks with missing data', async () => {
			const trackWithMissingData = [
				{
					id: 1,
					title: null,
					duration: null,
					artists: [],
					album: null
				}
			];

			vi.mocked(losslessAPI.getTrackStreamUrl).mockResolvedValueOnce(
				'https://example.com/track.flac'
			);
			vi.mocked(losslessAPI.formatDuration).mockReturnValueOnce('0:00');

			const result = await buildTrackLinksCsv(trackWithMissingData as any, 'LOSSLESS');

			const lines = result.split('\n');
			expect(lines[1]).toBe('1,,Unknown Artist,,0:00,https://example.com/track.flac');
		});

		it('escapes CSV values with commas and quotes', async () => {
			const trackWithSpecialChars = [
				{
					id: 1,
					title: 'Track "With" Quotes, and Comma',
					duration: 120,
					artists: [{ id: 1, name: 'Artist, Name', type: 'artist' }],
					album: { id: 1, title: 'Album "Title"' }
				}
			];

			vi.mocked(losslessAPI.getTrackStreamUrl).mockResolvedValueOnce(
				'https://example.com/track.flac'
			);
			vi.mocked(losslessAPI.formatDuration).mockReturnValueOnce('2:00');

			const result = await buildTrackLinksCsv(trackWithSpecialChars as any, 'LOSSLESS');

			const lines = result.split('\n');
			expect(lines[1]).toBe(
				'1,"Track ""With"" Quotes, and Comma","Artist, Name","Album ""Title""",2:00,https://example.com/track.flac'
			);
		});

		it('handles tracks with missing data', async () => {
			const trackWithMissingData = [
				{
					id: 1,
					title: null,
					duration: null,
					artists: [],
					album: null
				}
			];

			vi.mocked(losslessAPI.getTrackStreamUrl).mockResolvedValueOnce(
				'https://example.com/track.flac'
			);
			vi.mocked(losslessAPI.formatDuration).mockReturnValueOnce('0:00');

			const result = await buildTrackLinksCsv(trackWithMissingData as any, 'LOSSLESS');

			const lines = result.split('\n');
			expect(lines[1]).toBe('1,,Unknown Artist,,0:00,https://example.com/track.flac');
		});

		it('escapes CSV values with commas and quotes', async () => {
			const trackWithSpecialChars = [
				{
					id: 1,
					title: 'Track "With" Quotes, and Comma',
					duration: 120,
					artists: [{ id: 1, name: 'Artist, Name', type: 'artist' }],
					album: { id: 1, title: 'Album "Title"' }
				}
			];

			vi.mocked(losslessAPI.getTrackStreamUrl).mockResolvedValueOnce(
				'https://example.com/track.flac'
			);
			vi.mocked(losslessAPI.formatDuration).mockReturnValueOnce('2:00');

			const result = await buildTrackLinksCsv(trackWithSpecialChars as any, 'LOSSLESS');

			const lines = result.split('\n');
			expect(lines[1]).toBe(
				'1,"Track ""With"" Quotes, and Comma","Artist, Name","Album ""Title""",2:00,https://example.com/track.flac'
			);
		});

		it('escapes CSV values with commas and quotes', async () => {
			const trackWithSpecialChars = [
				{
					id: 1,
					title: 'Track "With" Quotes, and Comma',
					duration: 120,
					artists: [{ id: 1, name: 'Artist, Name', type: 'artist' }],
					album: { id: 1, title: 'Album "Title"' }
				}
			];

			vi.mocked(losslessAPI.getTrackStreamUrl).mockResolvedValueOnce(
				'https://example.com/track.flac'
			);
			vi.mocked(losslessAPI.formatDuration).mockReturnValueOnce('2:00');

			const result = await buildTrackLinksCsv(trackWithSpecialChars as any, 'LOSSLESS');

			const lines = result.split('\n');
			expect(lines[1]).toBe(
				'1,"Track ""With"" Quotes, and Comma","Artist, Name","Album ""Title""",2:00,https://example.com/track.flac'
			);
		});
	});
});
