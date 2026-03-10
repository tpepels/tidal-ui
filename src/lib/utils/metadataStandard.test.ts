import { describe, expect, it } from 'vitest';
import type { TrackLookup } from '../types';
import {
	buildStandardMetadataEntries,
	buildStandardMetadataObject,
	isStandardMetadataKey
} from './metadataStandard';

function buildLookup(): TrackLookup {
	return {
		track: {
			id: 123,
			title: ' Track\tTitle ',
			duration: 180,
			allowStreaming: true,
			streamReady: true,
			premiumStreamingOnly: false,
			trackNumber: 2,
			volumeNumber: 1,
			version: null,
			popularity: 50,
			url: 'https://example.test/track/123',
			editable: false,
			explicit: false,
			audioQuality: 'LOSSLESS',
			audioModes: [],
			artist: { id: 1, name: 'Main Artist', type: 'MAIN' },
			artists: [{ id: 1, name: 'Main Artist', type: 'MAIN' }],
			isrc: 'USABC1234567',
			album: {
				id: 456,
				title: 'Album\r\nTitle',
				cover: 'cover-id',
				videoCover: null,
				releaseDate: '2024-03-01',
				numberOfTracks: 10,
				numberOfVolumes: 1,
				artist: { id: 1, name: 'Album Artist', type: 'MAIN' },
				artists: [{ id: 1, name: 'Album Artist', type: 'MAIN' }]
			}
		},
		info: {
			trackId: 123,
			audioQuality: 'LOSSLESS',
			audioMode: 'STEREO',
			manifest: 'manifest',
			manifestMimeType: 'application/dash+xml',
			assetPresentation: 'FULL',
			trackReplayGain: -8.3,
			trackPeakAmplitude: 0.998,
			albumReplayGain: -7.2,
			albumPeakAmplitude: 0.999
		}
	};
}

describe('metadataStandard', () => {
	it('emits only canonical metadata keys', () => {
		const entries = buildStandardMetadataEntries(buildLookup());
		expect(entries.length).toBeGreaterThan(0);
		for (const [key] of entries) {
			expect(isStandardMetadataKey(key)).toBe(true);
		}
		const metadata = buildStandardMetadataObject(buildLookup());
		expect(metadata.ISRC).toBe('USABC1234567');
		expect(metadata).not.toHaveProperty('isrc');
	});

	it('sanitizes metadata values and preserves deterministic keys', () => {
		const metadata = buildStandardMetadataObject(buildLookup());
		expect(metadata.title).toBe('Track Title');
		expect(metadata.album).toBe('Album Title');
		expect(metadata.track).toBe('2/10');
		expect(metadata.year).toBe('2024');
	});

	it('applies overrides with standard formatting', () => {
		const metadata = buildStandardMetadataObject(buildLookup(), {
			albumTitle: ' Override Album ',
			albumArtist: 'Override Artist',
			trackNumber: 7,
			totalTracks: 12,
			discNumber: 2,
			totalDiscs: 3
		});
		expect(metadata.album).toBe('Override Album');
		expect(metadata.album_artist).toBe('Override Artist');
		expect(metadata.track).toBe('7/12');
		expect(metadata.disc).toBe('2/3');
	});

	it('includes barcode and optional external metadata tags', () => {
		const lookup = buildLookup();
		lookup.track.album.upc = '012345678905';
		const metadata = buildStandardMetadataObject(lookup, undefined, {
			MUSICBRAINZ_TRACKID: 'dc108a25-f24f-4b5d-a583-4ebad40f80f9',
			MUSICBRAINZ_ALBUMID: '8d9f8f6b-5cd9-4b90-8356-1b4b7a98ef62'
		});
		expect(metadata.BARCODE).toBe('012345678905');
		expect(metadata.MUSICBRAINZ_TRACKID).toBe('dc108a25-f24f-4b5d-a583-4ebad40f80f9');
		expect(metadata.MUSICBRAINZ_ALBUMID).toBe('8d9f8f6b-5cd9-4b90-8356-1b4b7a98ef62');
	});
});
