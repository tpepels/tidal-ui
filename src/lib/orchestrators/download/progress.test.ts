import { describe, it, expect } from 'vitest';
import {
	calculateWeightedProgress,
	calculateDownloadFraction,
	calculateEmbeddingFraction,
	calculateUploadFraction
} from './progress';

describe('download progress helpers', () => {
	it('calculates weighted progress with clamping', () => {
		expect(calculateWeightedProgress(0.2, 0.8, 0.5)).toBeCloseTo(0.5);
		expect(calculateWeightedProgress(1.2, 0.8, 0.5)).toBe(1);
		// Negative inputs clamp to 0
		expect(calculateWeightedProgress(-0.2, 0, 0.5)).toBe(0);
	});

	it('calculates download fractions with fallback when total is unknown', () => {
		expect(
			calculateDownloadFraction({ receivedBytes: 50, totalBytes: 100, previous: 0.1 })
		).toBeCloseTo(0.5);
		expect(
			calculateDownloadFraction({ receivedBytes: 0, totalBytes: undefined, previous: 0.4 })
		).toBeCloseTo(0.45);
	});

	it('calculates embedding fraction within expected bounds', () => {
		expect(calculateEmbeddingFraction(0.5)).toBeCloseTo(0.925);
		expect(calculateEmbeddingFraction(2)).toBe(1);
	});

	it('calculates upload fraction with fallback to previous', () => {
		expect(
			calculateUploadFraction({ uploadedBytes: 10, totalBytes: 20, previous: 0.1 })
		).toBeCloseTo(0.5);
		expect(
			calculateUploadFraction({ uploadedBytes: 0, totalBytes: undefined, previous: 0.6 })
		).toBeCloseTo(0.6);
	});
});
