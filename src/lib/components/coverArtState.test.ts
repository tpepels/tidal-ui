import { describe, expect, it } from 'vitest';
import { getNextCoverCandidate, normalizeCoverCandidates } from './coverArtState';

describe('coverArtState', () => {
	describe('normalizeCoverCandidates', () => {
		it('trims, deduplicates, and preserves candidate order', () => {
			expect(
				normalizeCoverCandidates([
					' https://img.example.com/a.jpg ',
					'https://img.example.com/a.jpg',
					'',
					'   ',
					'https://img.example.com/b.jpg'
				])
			).toEqual(['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg']);
		});

		it('returns empty list for invalid input types', () => {
			expect(normalizeCoverCandidates(null)).toEqual([]);
			expect(normalizeCoverCandidates(undefined)).toEqual([]);
			expect(normalizeCoverCandidates('https://img.example.com/a.jpg')).toEqual([]);
		});
	});

	describe('getNextCoverCandidate', () => {
		it('returns the next candidate when available', () => {
			expect(
				getNextCoverCandidate(
					['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg'],
					0
				)
			).toEqual({
				nextIndex: 1,
				nextSrc: 'https://img.example.com/b.jpg',
				exhausted: false
			});
		});

		it('reports exhaustion at the final candidate', () => {
			expect(
				getNextCoverCandidate(
					['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg'],
					1
				)
			).toEqual({
				nextIndex: 1,
				nextSrc: null,
				exhausted: true
			});
		});

		it('handles non-finite index values safely', () => {
			expect(
				getNextCoverCandidate(
					['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg'],
					Number.NaN
				)
			).toEqual({
				nextIndex: 0,
				nextSrc: 'https://img.example.com/a.jpg',
				exhausted: false
			});
		});

		it('starts from the first candidate when current index is before the list', () => {
			expect(
				getNextCoverCandidate(
					['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg'],
					-1
				)
			).toEqual({
				nextIndex: 0,
				nextSrc: 'https://img.example.com/a.jpg',
				exhausted: false
			});
		});
	});
});
