import { describe, expect, it } from 'vitest';
import type { TrackLookup } from '../types';
import { buildMetadataObject } from './metadataEmbedder';

function buildLookup(trackNumber: number): TrackLookup {
	return {
		track: {
			id: 123,
			title: 'Track Title',
			duration: 180,
			allowStreaming: true,
			streamReady: true,
			premiumStreamingOnly: false,
			trackNumber,
			volumeNumber: 1,
			version: null,
			popularity: 50,
			url: 'https://example.test/track/123',
			editable: false,
			explicit: false,
			audioQuality: 'LOSSLESS',
			audioModes: [],
			artist: { id: 1, name: 'Artist', type: 'MAIN' },
			artists: [{ id: 1, name: 'Artist', type: 'MAIN' }],
			album: {
				id: 456,
				title: 'Album Title',
				cover: 'cover-id',
				videoCover: null,
				numberOfTracks: 10,
				numberOfVolumes: 1,
				artist: { id: 1, name: 'Artist', type: 'MAIN' },
				artists: [{ id: 1, name: 'Artist', type: 'MAIN' }]
			}
		},
		info: {
			trackId: 123,
			audioQuality: 'LOSSLESS',
			audioMode: 'STEREO',
			manifest: 'manifest',
			manifestMimeType: 'application/dash+xml',
			assetPresentation: 'FULL'
		}
	};
}

describe('buildMetadataObject', () => {
	it('uses lookup track number by default', () => {
		const metadata = buildMetadataObject(buildLookup(1));
		expect(metadata.track).toBe('1/10');
	});

	it('overrides track number when finalizeTrack provides one', () => {
		const metadata = buildMetadataObject(buildLookup(1), { trackNumber: 7 });
		expect(metadata.track).toBe('7/10');
	});

	it('ignores invalid override track numbers', () => {
		const metadata = buildMetadataObject(buildLookup(4), { trackNumber: 0 });
		expect(metadata.track).toBe('4/10');
	});
});
