import { describe, expect, it } from 'vitest';
import type { Album, Track } from '$lib/types';
import type { DiscographyGroup } from '$lib/utils/discography';
import {
	buildFeaturedDiscographyAlbums,
	buildTopTrackAlbumSignals,
	filterDiscographyEntries
} from './artistDiscographyModel';

function createAlbum(overrides: Partial<Album> = {}): Album {
	return {
		id: 1,
		title: 'Album',
		cover: '',
		videoCover: null,
		type: 'ALBUM',
		numberOfTracks: 10,
		popularity: 40,
		artist: { id: 7, name: 'Artist', type: 'ARTIST' },
		...overrides
	};
}

function createEntry(overrides: Partial<DiscographyGroup> = {}): DiscographyGroup {
	const representative = createAlbum();
	return {
		key: `album:${representative.id}`,
		representative,
		versions: [representative],
		availableQualities: [],
		section: 'album',
		...overrides
	};
}

function createTrack(overrides: Partial<Track> = {}): Track {
	return {
		id: 1,
		title: 'Track',
		duration: 180,
		allowStreaming: true,
		streamReady: true,
		premiumStreamingOnly: false,
		trackNumber: 1,
		volumeNumber: 1,
		version: null,
		popularity: 50,
		url: '',
		editable: false,
		explicit: false,
		audioQuality: 'LOSSLESS',
		audioModes: [],
		artist: { id: 7, name: 'Artist', type: 'ARTIST' },
		artists: [{ id: 7, name: 'Artist', type: 'ARTIST' }],
		album: createAlbum({ id: 100 }),
		...overrides
	};
}

describe('artistDiscographyModel', () => {
	it('filters discography entries by release traits', () => {
		const album = createEntry({
			representative: createAlbum({ id: 10, type: 'ALBUM' }),
			section: 'album'
		});
		const single = createEntry({
			representative: createAlbum({ id: 11, type: 'SINGLE' }),
			section: 'single'
		});
		const explicit = createEntry({
			representative: createAlbum({ id: 12, explicit: true }),
			section: 'album'
		});

		const filtered = filterDiscographyEntries([album, single, explicit], {
			album: true,
			ep: false,
			single: false,
			live: true,
			remaster: true,
			explicit: false,
			clean: true
		});

		expect(filtered.map((entry) => entry.representative.id)).toEqual([10]);
	});

	it('builds top-track album signals from ranked tracks', () => {
		const signals = buildTopTrackAlbumSignals(
			[
				createTrack({ id: 1, album: createAlbum({ id: 20 }), popularity: 70 }),
				createTrack({ id: 2, album: createAlbum({ id: 20 }), popularity: 30 }),
				createTrack({ id: 3, album: createAlbum({ id: 30 }), popularity: 10 })
			],
			{ maxTracks: 3 }
		);

		expect(signals.get(20)).toEqual({
			hits: 2,
			popularitySum: 100,
			rankWeight: 5
		});
		expect(signals.get(30)).toEqual({
			hits: 1,
			popularitySum: 10,
			rankWeight: 1
		});
	});

	it('ranks featured albums by computed score with variant penalties', () => {
		const baseEntry = createEntry({
			representative: createAlbum({
				id: 101,
				title: 'Primary',
				popularity: 50,
				numberOfTracks: 12,
				type: 'ALBUM'
			})
		});
		const liveEntry = createEntry({
			representative: createAlbum({
				id: 102,
				title: 'Live Edition',
				popularity: 70,
				numberOfTracks: 12,
				type: 'ALBUM',
				releaseDate: '2024-01-01'
			})
		});
		const signals = new Map([
			[
				101,
				{
					hits: 3,
					popularitySum: 120,
					rankWeight: 8
				}
			],
			[
				102,
				{
					hits: 1,
					popularitySum: 20,
					rankWeight: 2
				}
			]
		]);

		const ranked = buildFeaturedDiscographyAlbums([liveEntry, baseEntry], signals, { limit: 2 });
		expect(ranked[0]?.entry.representative.id).toBe(101);
		expect(ranked).toHaveLength(2);
	});
});
