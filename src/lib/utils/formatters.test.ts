import { describe, it, expect } from 'vitest';
import {
	formatArtists,
	formatArtistsForMetadata,
	formatDuration,
	formatFileSize,
	formatNumber,
	truncateText
} from './formatters';

describe('Formatters', () => {
	describe('formatArtists', () => {
		it('formats single artist', () => {
			const artists = [{ id: 1, name: 'Artist One', type: 'artist' }];
			expect(formatArtists(artists)).toBe('Artist One');
		});

		it('formats two artists', () => {
			const artists = [
				{ id: 1, name: 'Artist One', type: 'artist' },
				{ id: 2, name: 'Artist Two', type: 'artist' }
			];
			expect(formatArtists(artists)).toBe('Artist One & Artist Two');
		});

		it('formats three artists', () => {
			const artists = [
				{ id: 1, name: 'Artist One', type: 'artist' },
				{ id: 2, name: 'Artist Two', type: 'artist' },
				{ id: 3, name: 'Artist Three', type: 'artist' }
			];
			expect(formatArtists(artists)).toBe('Artist One, Artist Two & Artist Three');
		});

		it('handles empty array', () => {
			expect(formatArtists([])).toBe('Unknown Artist');
		});

		it('handles undefined', () => {
			expect(formatArtists(undefined)).toBe('Unknown Artist');
		});
	});

	describe('formatArtistsForMetadata', () => {
		it('formats single artist', () => {
			const artists = [{ id: 1, name: 'Artist One', type: 'artist' }];
			expect(formatArtistsForMetadata(artists)).toBe('Artist One');
		});

		it('formats multiple artists', () => {
			const artists = [
				{ id: 1, name: 'Artist One', type: 'artist' },
				{ id: 2, name: 'Artist Two', type: 'artist' }
			];
			expect(formatArtistsForMetadata(artists)).toBe('Artist One; Artist Two');
		});

		it('handles empty array', () => {
			expect(formatArtistsForMetadata([])).toBe('Unknown Artist');
		});
	});

	describe('formatDuration', () => {
		it('formats seconds only', () => {
			expect(formatDuration(0)).toBe('0:00');
			expect(formatDuration(59)).toBe('0:59');
			expect(formatDuration(125)).toBe('2:05');
		});

		it('formats with hours', () => {
			expect(formatDuration(3600)).toBe('1:00:00');
			expect(formatDuration(7265)).toBe('2:01:05');
		});

		it('handles invalid input', () => {
			expect(formatDuration(-1)).toBe('0:00');
			expect(formatDuration(NaN)).toBe('0:00');
			expect(formatDuration(Infinity)).toBe('0:00');
		});
	});

	describe('formatFileSize', () => {
		it('formats bytes', () => {
			expect(formatFileSize(0)).toBe('0.0 B');
			expect(formatFileSize(512)).toBe('512 B');
			expect(formatFileSize(1024)).toBe('1.0 KB');
			expect(formatFileSize(1536)).toBe('1.5 KB');
			expect(formatFileSize(1048576)).toBe('1.0 MB');
			expect(formatFileSize(1073741824)).toBe('1.0 GB');
		});

		it('handles invalid input', () => {
			expect(formatFileSize(-1)).toBe('0 B');
			expect(formatFileSize(NaN)).toBe('0 B');
		});
	});

	describe('formatNumber', () => {
		it('formats numbers with commas', () => {
			expect(formatNumber(1234)).toBe('1,234');
			expect(formatNumber(1234567)).toBe('1,234,567');
		});
	});

	describe('truncateText', () => {
		it('truncates long text', () => {
			expect(truncateText('This is a long text', 10)).toBe('This is...');
		});

		it('does not truncate short text', () => {
			expect(truncateText('Short', 10)).toBe('Short');
		});

		it('handles exact length', () => {
			expect(truncateText('Exact', 5)).toBe('Exact');
		});
	});
});
