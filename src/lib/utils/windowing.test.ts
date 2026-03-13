import { describe, expect, it } from 'vitest';
import { computeVirtualWindowRange, createFullWindowRange } from './windowing';

describe('windowing', () => {
	it('returns a full range when below threshold', () => {
		expect(
			computeVirtualWindowRange({
				totalItems: 24,
				itemHeight: 72,
				viewportHeight: 900,
				scrollOffset: 0,
				threshold: 30
			})
		).toEqual(createFullWindowRange(24));
	});

	it('builds a windowed slice for large lists', () => {
		expect(
			computeVirtualWindowRange({
				totalItems: 500,
				itemHeight: 50,
				viewportHeight: 500,
				scrollOffset: 1250,
				overscan: 4,
				threshold: 40
			})
		).toEqual({
			startIndex: 21,
			endIndex: 39,
			paddingStart: 1050,
			paddingEnd: 23050,
			windowed: true
		});
	});

	it('clamps the window to the tail of the list', () => {
		expect(
			computeVirtualWindowRange({
				totalItems: 100,
				itemHeight: 40,
				viewportHeight: 400,
				scrollOffset: 9000,
				overscan: 3,
				threshold: 20
			})
		).toEqual({
			startIndex: 90,
			endIndex: 100,
			paddingStart: 3600,
			paddingEnd: 0,
			windowed: true
		});
	});
});
