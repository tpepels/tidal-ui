import { describe, it, expect, vi } from 'vitest';
import {
	getOptimalBlur,
	getOptimalSaturate,
	shouldEnableAnimations,
	getOptimalGradientColors,
	prefersReducedMotion
} from './performance';

// Mock navigator and window for performance detection
const mockNavigator = {
	hardwareConcurrency: 4,
	deviceMemory: 8
};

const mockConnection = {
	effectiveType: '4g'
};

Object.defineProperty(global, 'navigator', {
	value: mockNavigator,
	writable: true
});

Object.defineProperty(mockNavigator, 'connection', {
	value: mockConnection,
	writable: true
});

// Mock window for reduced motion
const mockWindow = {
	matchMedia: vi.fn(() => ({ matches: false }))
};

Object.defineProperty(global, 'window', {
	value: mockWindow,
	writable: true
});

describe('Performance Utils', () => {
	describe('getOptimalBlur', () => {
		it('returns full blur for high performance', () => {
			expect(getOptimalBlur(10, 'high')).toBe(10);
		});

		it('reduces blur for medium performance', () => {
			expect(getOptimalBlur(10, 'medium')).toBe(6);
		});

		it('greatly reduces blur for low performance', () => {
			expect(getOptimalBlur(10, 'low')).toBe(3);
		});
	});

	describe('getOptimalSaturate', () => {
		it('returns full saturation for high performance', () => {
			expect(getOptimalSaturate(150, 'high')).toBe(150);
		});

		it('caps saturation for medium performance', () => {
			expect(getOptimalSaturate(150, 'medium')).toBe(130);
			expect(getOptimalSaturate(120, 'medium')).toBe(120);
		});

		it('disables saturation boost for low performance', () => {
			expect(getOptimalSaturate(150, 'low')).toBe(100);
		});
	});

	describe('shouldEnableAnimations', () => {
		it('returns false when user prefers reduced motion', () => {
			mockWindow.matchMedia.mockReturnValue({ matches: true });
			expect(shouldEnableAnimations('high')).toBe(false);
			mockWindow.matchMedia.mockReturnValue({ matches: false });
		});

		it('returns false for low performance', () => {
			expect(shouldEnableAnimations('low')).toBe(false);
		});

		it('returns true for medium/high performance', () => {
			expect(shouldEnableAnimations('medium')).toBe(true);
			expect(shouldEnableAnimations('high')).toBe(true);
		});
	});

	describe('getOptimalGradientColors', () => {
		it('returns 5 colors for high performance', () => {
			expect(getOptimalGradientColors('high')).toBe(5);
		});

		it('returns 3 colors for medium performance', () => {
			expect(getOptimalGradientColors('medium')).toBe(3);
		});

		it('returns 2 colors for low performance', () => {
			expect(getOptimalGradientColors('low')).toBe(2);
		});
	});

	describe('prefersReducedMotion', () => {
		it('returns false when window is undefined', () => {
			const originalWindow = global.window;
			delete (global as Record<string, unknown>).window;
			expect(prefersReducedMotion()).toBe(false);
			global.window = originalWindow;
		});

		it('returns matchMedia result', () => {
			mockWindow.matchMedia.mockReturnValue({ matches: true });
			expect(prefersReducedMotion()).toBe(true);

			mockWindow.matchMedia.mockReturnValue({ matches: false });
			expect(prefersReducedMotion()).toBe(false);
		});
	});
});
