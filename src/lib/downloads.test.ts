import { describe, it, expect } from 'vitest';
import { sanitizeForFilename } from './downloads';

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
				'Artist_ _Song_ _feat_ Other_'
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
			// Data that's long enough but not WebP
			const longData = new Uint8Array(20);
			longData[0] = 0x52; // R
			longData[1] = 0x49; // I
			longData[2] = 0x46; // F
			longData[3] = 0x46; // F
			// But not WEBP at positions 8-11
			expect(detectImageFormat(longData)).toBeNull();
		});
	});
});
