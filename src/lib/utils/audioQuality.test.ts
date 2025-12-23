import { describe, it, expect } from 'vitest';
import {
	normalizeQualityToken,
	deriveQualityFromTags,
	pickBestQuality,
	deriveTrackQuality
} from './audioQuality';
import type { Track } from '$lib/types';

describe('audioQuality', () => {
	describe('normalizeQualityToken', () => {
		it('should normalize valid tokens', () => {
			expect(normalizeQualityToken('LOSSLESS')).toBe('LOSSLESS');
			expect(normalizeQualityToken('HI_RES_LOSSLESS')).toBe('HI_RES_LOSSLESS');
			expect(normalizeQualityToken('HIGH')).toBe('HIGH');
			expect(normalizeQualityToken('LOW')).toBe('LOW');
		});

		it('should handle aliases', () => {
			expect(normalizeQualityToken('HIFI')).toBe('LOSSLESS');
			expect(normalizeQualityToken('MASTER')).toBe('HI_RES_LOSSLESS');
			expect(normalizeQualityToken('HIGH_QUALITY')).toBe('HIGH');
		});

		it('should handle case and punctuation', () => {
			expect(normalizeQualityToken('lossless')).toBe('LOSSLESS');
			expect(normalizeQualityToken('HI-RES LOSSLESS')).toBe('HI_RES_LOSSLESS');
		});

		it('should return null for invalid tokens', () => {
			expect(normalizeQualityToken('INVALID')).toBe(null);
			expect(normalizeQualityToken('')).toBe(null);
			expect(normalizeQualityToken(null)).toBe(null);
		});
	});

	describe('deriveQualityFromTags', () => {
		it('should derive quality from tags array', () => {
			expect(deriveQualityFromTags(['LOSSLESS'])).toBe('LOSSLESS');
			expect(deriveQualityFromTags(['HI_RES_LOSSLESS', 'LOSSLESS'])).toBe('HI_RES_LOSSLESS');
		});

		it('should handle mixed case and invalid tags', () => {
			expect(deriveQualityFromTags(['hifi', 'invalid'])).toBe('LOSSLESS');
		});

		it('should return null for invalid input', () => {
			expect(deriveQualityFromTags(null)).toBe(null);
			expect(deriveQualityFromTags([])).toBe(null);
			expect(deriveQualityFromTags(['invalid'])).toBe(null);
		});
	});

	describe('pickBestQuality', () => {
		it('should pick the highest quality', () => {
			expect(pickBestQuality(['LOW', 'HIGH', 'LOSSLESS'])).toBe('LOSSLESS');
			expect(pickBestQuality(['HI_RES_LOSSLESS', 'HIGH'])).toBe('HI_RES_LOSSLESS');
		});

		it('should handle nulls and undefineds', () => {
			expect(pickBestQuality([null, 'HIGH', undefined])).toBe('HIGH');
			expect(pickBestQuality([null])).toBe(null);
		});
	});

	describe('deriveTrackQuality', () => {
		it('should derive quality from track metadata', () => {
			const track = {
				id: '1',
				title: 'Test',
				artists: [],
				duration: 100,
				audioQuality: 'LOSSLESS',
				mediaMetadata: { tags: ['HIGH'] },
				album: { mediaMetadata: { tags: ['HI_RES_LOSSLESS'] } }
			} as unknown as Track;

			expect(deriveTrackQuality(track)).toBe('HI_RES_LOSSLESS');
		});

		it('should fall back to audioQuality', () => {
			const track = {
				id: '1',
				title: 'Test',
				artists: [],
				duration: 100,
				audioQuality: 'HIGH'
			} as unknown as Track;

			expect(deriveTrackQuality(track)).toBe('HIGH');
		});

		it('should return null for invalid track', () => {
			expect(deriveTrackQuality(null)).toBe(null);
			expect(deriveTrackQuality({} as Track)).toBe(null);
		});
	});
});
