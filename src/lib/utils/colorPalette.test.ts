import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	rgbToCss,
	lighten,
	darken,
	ensureTextContrast,
	extractPaletteFromImage,
	extractPaletteFromImageWebGL
} from './colorPalette';

// Mock browser environment
vi.mock('$app/environment', () => ({
	browser: true
}));

// Mock ColorThief import
vi.mock('colorthief', () => ({
	default: vi.fn(() => ({
		getPalette: vi.fn(() => [
			[128, 128, 128],
			[255, 0, 0]
		]),
		getColor: vi.fn(() => [128, 128, 128])
	}))
}));

// Mock Image and Canvas
global.HTMLImageElement = vi.fn() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
global.HTMLCanvasElement = vi.fn() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
global.Image = vi.fn().mockImplementation(() => ({
	crossOrigin: '',
	decoding: '',
	onload: null,
	onerror: null,
	src: ''
})) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

global.document = {
	createElement: vi.fn(() => ({
		width: 32,
		height: 18,
		getContext: vi.fn(() => ({
			drawImage: vi.fn(),
			getImageData: vi.fn(() => ({
				data: new Uint8ClampedArray([128, 128, 128, 255, 255, 0, 0, 255]) // 2 pixels: gray, red
			}))
		}))
	}))
} as unknown as Document;

describe('Color Palette Utils', () => {
	describe('rgbToCss', () => {
		it('converts RGB to CSS string', () => {
			expect(rgbToCss({ red: 255, green: 0, blue: 0 })).toBe('rgb(255, 0, 0)');
		});

		it('converts RGB with alpha to CSS string', () => {
			expect(rgbToCss({ red: 128, green: 128, blue: 128 }, 0.5)).toBe('rgba(128, 128, 128, 0.500)');
		});
	});

	describe('lighten and darken', () => {
		it('lightens a color', () => {
			const result = lighten({ red: 100, green: 100, blue: 100 }, 0.5);
			expect(result.red).toBeGreaterThan(100);
			expect(result.green).toBeGreaterThan(100);
			expect(result.blue).toBeGreaterThan(100);
		});

		it('darkens a color', () => {
			const result = darken({ red: 100, green: 100, blue: 100 }, 0.5);
			expect(result.red).toBeLessThan(100);
			expect(result.green).toBeLessThan(100);
			expect(result.blue).toBeLessThan(100);
		});
	});

	describe('ensureTextContrast', () => {
		it('returns color if contrast is sufficient', () => {
			const darkColor = { red: 50, green: 50, blue: 50 };
			const result = ensureTextContrast(darkColor);
			expect(result).toEqual(darkColor);
		});

		it('darkens bright color for better contrast', () => {
			const brightColor = { red: 200, green: 200, blue: 200 };
			const result = ensureTextContrast(brightColor);
			expect(result.red).toBeLessThanOrEqual(brightColor.red);
		});
	});

	describe('extractPaletteFromImage', () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it('handles image load error', async () => {
			const result = await extractPaletteFromImage('invalid.jpg');
			expect(result.dominant).toEqual({ red: 15, green: 23, blue: 42 });
		});

		it('handles image load error', async () => {
			const result = await extractPaletteFromImage('invalid.jpg');
			expect(result.dominant).toEqual({ red: 15, green: 23, blue: 42 });
		});
	});

	describe('extractPaletteFromImageWebGL', () => {
		it('extracts palette from canvas', async () => {
			const result = await extractPaletteFromImageWebGL('test.jpg');
			expect(result.palette).toHaveLength(40);
			expect(typeof result.mostVibrant.red).toBe('number');
		});
	});
});
