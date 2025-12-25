import { describe, it, expect, vi } from 'vitest';
import {
	calculateSaturation,
	calculateLuminance,
	calculateVibrancy,
	getAverageColor,
	rgbToHsl,
	hslToRgb,
	getMostVibrantColor
} from './colorExtraction';

// Mock canvas and fetch for tests
const createMockCanvas = () => {
	const mockCtx = {
		getImageData: vi.fn()
	};
	return mockCtx;
};

// Skip URL mocking for now to avoid type conflicts
// global.URL = {
// 	createObjectURL: vi.fn(() => 'mock-url'),
// 	revokeObjectURL: vi.fn()
// };

describe('Color Extraction', () => {
	describe('calculateSaturation', () => {
		it('calculates saturation for colorful color', () => {
			const color = { r: 255, g: 0, b: 0, a: 255 };
			expect(calculateSaturation(color)).toBe(1);
		});

		it('calculates saturation for gray', () => {
			const color = { r: 128, g: 128, b: 128, a: 255 };
			expect(calculateSaturation(color)).toBe(0);
		});

		it('handles black', () => {
			const color = { r: 0, g: 0, b: 0, a: 255 };
			expect(calculateSaturation(color)).toBe(0);
		});
	});

	describe('calculateLuminance', () => {
		it('calculates luminance for white', () => {
			const color = { r: 255, g: 255, b: 255, a: 255 };
			expect(calculateLuminance(color)).toBeCloseTo(1, 2);
		});

		it('calculates luminance for black', () => {
			const color = { r: 0, g: 0, b: 0, a: 255 };
			expect(calculateLuminance(color)).toBeCloseTo(0, 2);
		});

		it('calculates luminance for red', () => {
			const color = { r: 255, g: 0, b: 0, a: 255 };
			expect(calculateLuminance(color)).toBeCloseTo(0.2126, 2);
		});
	});

	describe('calculateVibrancy', () => {
		it('calculates vibrancy for saturated mid-luminance color', () => {
			const color = { r: 128, g: 64, b: 192, a: 255, saturation: 0.5, luminance: 0.3 };
			expect(calculateVibrancy(color)).toBeGreaterThan(0.5);
		});

		it('calculates vibrancy without precomputed values', () => {
			const color = { r: 255, g: 0, b: 0, a: 255 };
			const result = calculateVibrancy(color);
			expect(result).toBeGreaterThan(0);
		});
	});

	describe('getAverageColor', () => {
		it('calculates average color from canvas data', () => {
			const mockCtx = createMockCanvas();
			mockCtx.getImageData.mockReturnValue({
				data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]) // 2 pixels: red and green
			});

			const result = getAverageColor(mockCtx as unknown as CanvasRenderingContext2D, 0, 0, 2, 1);

			expect(result.r).toBe(128); // (255+0)/2
			expect(result.g).toBe(128); // (0+255)/2
			expect(result.b).toBe(0);
			expect(result.a).toBe(255);
		});

		it('selects most vibrant color when significantly better', () => {
			const mockCtx = createMockCanvas();
			// First pixel: dull gray, second: vibrant red
			mockCtx.getImageData.mockReturnValue({
				data: new Uint8ClampedArray([128, 128, 128, 255, 255, 0, 0, 255])
			});

			const result = getAverageColor(mockCtx as unknown as CanvasRenderingContext2D, 0, 0, 2, 1);

			// Should select the red pixel as more vibrant
			expect(result.r).toBe(255);
			expect(result.g).toBe(0);
			expect(result.b).toBe(0);
		});
	});

	describe('rgbToHsl', () => {
		it('converts red to HSL', () => {
			const [h, s, l] = rgbToHsl(255, 0, 0);
			expect(h).toBeCloseTo(0, 2);
			expect(s).toBe(1);
			expect(l).toBeCloseTo(0.5, 2);
		});

		it('converts white to HSL', () => {
			const [_h, s, l] = rgbToHsl(255, 255, 255);
			expect(s).toBe(0);
			expect(l).toBe(1);
		});
	});

	describe('hslToRgb', () => {
		it('converts RGB to HSL', () => {
			const [h, s, l] = rgbToHsl(255, 0, 0);
			expect(h).toBeCloseTo(0, 2);
			expect(s).toBe(1);
			expect(l).toBeCloseTo(0.5, 2);
		});

		it('converts gray HSL', () => {
			const [r, g, b] = hslToRgb(0, 0, 0.5);
			expect(r).toBe(128);
			expect(g).toBe(128);
			expect(b).toBe(128);
		});
	});

	describe('getMostVibrantColor', () => {
		it('selects most vibrant color from palette', () => {
			const palette = [
				{ r: 128, g: 128, b: 128, a: 255 }, // gray, low vibrancy
				{ r: 255, g: 0, b: 0, a: 255 } // red, high vibrancy
			];
			const result = getMostVibrantColor(palette);
			expect(result.r).toBeGreaterThan(200); // boosted saturation
			expect(result.g).toBe(0);
			expect(result.b).toBe(0);
		});

		it('filters out dark colors', () => {
			const palette = [
				{ r: 10, g: 10, b: 10, a: 255 }, // too dark
				{ r: 200, g: 150, b: 100, a: 255 } // better
			];
			const result = getMostVibrantColor(palette);
			expect(result.r).toBeGreaterThan(100);
		});

		it('falls back to brightest if all too dark', () => {
			const palette = [
				{ r: 5, g: 5, b: 5, a: 255 },
				{ r: 10, g: 10, b: 10, a: 255 }
			];
			const result = getMostVibrantColor(palette);
			expect(result.r).toBe(10);
		});
	});
});
