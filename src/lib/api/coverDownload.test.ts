import { describe, expect, it } from 'vitest';
import { detectImageFormat, validateImageData } from './coverDownload';

describe('coverDownload image sniffing', () => {
	it('accepts JPEG bytes', () => {
		const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]);
		expect(validateImageData(bytes)).toBe(true);
		expect(detectImageFormat(bytes)).toEqual({ extension: 'jpg', mimeType: 'image/jpeg' });
	});

	it('accepts PNG bytes', () => {
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
		expect(validateImageData(bytes)).toBe(true);
		expect(detectImageFormat(bytes)).toEqual({ extension: 'png', mimeType: 'image/png' });
	});

	it('accepts WebP bytes', () => {
		const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
		expect(validateImageData(bytes)).toBe(true);
		expect(detectImageFormat(bytes)).toEqual({ extension: 'webp', mimeType: 'image/webp' });
	});

	it('rejects non-image payloads', () => {
		const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
		expect(validateImageData(bytes)).toBe(false);
		expect(detectImageFormat(bytes)).toBeNull();
	});
});
