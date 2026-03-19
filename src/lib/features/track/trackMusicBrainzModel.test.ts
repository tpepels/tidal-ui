import { describe, expect, it } from 'vitest';
import {
	buildTrackMusicBrainzViewModel,
	normalizeTrackMusicBrainzLookupResponse
} from './trackMusicBrainzModel';

describe('trackMusicBrainzModel', () => {
	it('normalizes matched lookup payloads and builds descriptive facts', () => {
		const response = normalizeTrackMusicBrainzLookupResponse({
			success: true,
			lookupStatus: 'matched',
			tags: {
				MUSICBRAINZ_TRACKID: 'recording-1'
			},
			tagCount: 1,
			match: {
				recording: {
					id: 'recording-1',
					title: 'Autumn Leaves',
					artistCredit: 'Bill Evans',
					artists: [{ id: 'artist-1', name: 'Bill Evans' }]
				},
				release: {
					id: 'release-1',
					title: 'Portrait in Jazz',
					artistCredit: 'Bill Evans Trio',
					date: '1960-12-01',
					country: 'US',
					status: 'Official',
					barcode: '1234567890123',
					artists: [{ id: 'artist-2', name: 'Bill Evans Trio' }],
					releaseGroup: {
						id: 'rg-1',
						title: 'Portrait in Jazz',
						primaryType: 'Album',
						secondaryTypes: ['Remaster']
					}
				},
				releaseGroup: {
					id: 'rg-1',
					title: 'Portrait in Jazz',
					primaryType: 'Album',
					secondaryTypes: ['Remaster']
				},
				artists: [{ id: 'artist-1', name: 'Bill Evans' }],
				albumArtists: [{ id: 'artist-2', name: 'Bill Evans Trio' }]
			}
		});

		expect(response).not.toBeNull();
		const viewModel = buildTrackMusicBrainzViewModel(response);

		expect(viewModel.status).toBe('matched');
		expect(viewModel.facts).toEqual(
			expect.arrayContaining([
				{ label: 'Recording', value: 'Autumn Leaves' },
				{ label: 'Recording MBID', value: 'recording-1' },
				{ label: 'Release', value: 'Portrait in Jazz' },
				{ label: 'Release Group', value: 'Portrait in Jazz' },
				{ label: 'Release Group Type', value: 'Album / Remaster' }
			])
		);
		expect(viewModel.artistLinks).toEqual([
			{
				id: 'artist-1',
				label: 'Bill Evans',
				href: 'https://musicbrainz.org/artist/artist-1'
			}
		]);
		expect(viewModel.albumArtistLinks).toEqual([
			{
				id: 'artist-2',
				label: 'Bill Evans Trio',
				href: 'https://musicbrainz.org/artist/artist-2'
			}
		]);
		expect(viewModel.links.map((link) => link.label)).toEqual([
			'Open Recording',
			'Open Release',
			'Open Release Group'
		]);
	});

	it('hides duplicate album artist links when they match the recording artists', () => {
		const response = normalizeTrackMusicBrainzLookupResponse({
			success: true,
			lookupStatus: 'matched',
			tags: {},
			tagCount: 0,
			match: {
				recording: {
					id: 'recording-1',
					artists: [{ id: 'artist-1', name: 'Artist' }]
				},
				release: null,
				releaseGroup: null,
				artists: [{ id: 'artist-1', name: 'Artist' }],
				albumArtists: [{ id: 'artist-1', name: 'Artist' }]
			}
		});

		const viewModel = buildTrackMusicBrainzViewModel(response);

		expect(viewModel.artistLinks).toHaveLength(1);
		expect(viewModel.albumArtistLinks).toHaveLength(0);
	});

	it('surfaces lookup failures without inventing metadata', () => {
		const response = normalizeTrackMusicBrainzLookupResponse({
			success: true,
			lookupStatus: 'lookup_failed',
			tags: {},
			tagCount: 0,
			match: null,
			error: 'MusicBrainz timed out'
		});

		const viewModel = buildTrackMusicBrainzViewModel(response);

		expect(viewModel.status).toBe('lookup_failed');
		expect(viewModel.errorMessage).toBe('MusicBrainz timed out');
		expect(viewModel.facts).toHaveLength(0);
		expect(viewModel.links).toHaveLength(0);
	});
});
