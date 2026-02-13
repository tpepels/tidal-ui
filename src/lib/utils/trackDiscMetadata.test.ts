import { describe, expect, it } from 'vitest';
import { buildTrackDiscMetadataEntries } from './trackDiscMetadata';

describe('buildTrackDiscMetadataEntries', () => {
	it('builds track/disc values plus TRACKTOTAL and DISCTOTAL when totals are available', () => {
		expect(
			buildTrackDiscMetadataEntries({
				trackNumber: 3,
				totalTracks: 12,
				discNumber: 2,
				totalDiscs: 4
			})
		).toEqual([
			['track', '3/12'],
			['TRACKTOTAL', '12'],
			['disc', '2/4'],
			['DISCTOTAL', '4']
		]);
	});

	it('still emits total tags when only totals are present', () => {
		expect(
			buildTrackDiscMetadataEntries({
				trackNumber: null,
				totalTracks: 9,
				discNumber: null,
				totalDiscs: 2
			})
		).toEqual([
			['TRACKTOTAL', '9'],
			['DISCTOTAL', '2']
		]);
	});

	it('handles entries without totals', () => {
		expect(
			buildTrackDiscMetadataEntries({
				trackNumber: 7,
				totalTracks: 0,
				discNumber: 1,
				totalDiscs: undefined
			})
		).toEqual([
			['track', '7'],
			['disc', '1']
		]);
	});

	it('normalizes non-integer values and ignores invalid values', () => {
		expect(
			buildTrackDiscMetadataEntries({
				trackNumber: 5.9,
				totalTracks: 10.2,
				discNumber: Number.NaN,
				totalDiscs: -1
			})
		).toEqual([
			['track', '5/10'],
			['TRACKTOTAL', '10']
		]);
	});
});
