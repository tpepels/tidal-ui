import { describe, expect, it } from 'vitest';
import type { Track } from '$lib/types';
import { sortTopTracks } from './topTracks';

const buildTrack = (
	overrides: Partial<Track> & Pick<Track, 'id' | 'title'>
): Track =>
	({
		id: overrides.id,
		title: overrides.title,
		duration: overrides.duration ?? 180,
		allowStreaming: true,
		streamReady: true,
		premiumStreamingOnly: false,
		trackNumber: overrides.trackNumber ?? 1,
		volumeNumber: overrides.volumeNumber ?? 1,
		version: null,
		popularity: overrides.popularity ?? 0,
		url: `https://example.test/track/${overrides.id}`,
		editable: false,
		explicit: false,
		audioQuality: overrides.audioQuality ?? 'LOSSLESS',
		audioModes: [],
		artist: overrides.artist ?? { id: 1, name: 'Artist', type: 'MAIN' },
		artists: overrides.artists ?? [{ id: 1, name: 'Artist', type: 'MAIN' }],
		album:
			overrides.album ??
			({
				id: 10,
				title: 'Album',
				cover: 'cover-id',
				videoCover: null,
				releaseDate: '2020-01-01'
			} as Track['album'])
	}) as Track;

describe('sortTopTracks', () => {
	it('sorts by popularity first', () => {
		const tracks = [
			buildTrack({ id: 1, title: 'A', popularity: 20 }),
			buildTrack({ id: 2, title: 'B', popularity: 80 }),
			buildTrack({ id: 3, title: 'C', popularity: 40 })
		];

		const sorted = sortTopTracks(tracks, 100);
		expect(sorted.map((track) => track.id)).toEqual([2, 3, 1]);
	});

	it('uses album release date as deterministic tie-breaker', () => {
		const tracks = [
			buildTrack({
				id: 4,
				title: 'Older',
				popularity: 50,
				album: { id: 11, title: 'Album A', cover: 'a', videoCover: null, releaseDate: '2012-01-01' }
			}),
			buildTrack({
				id: 5,
				title: 'Newer',
				popularity: 50,
				album: { id: 12, title: 'Album B', cover: 'b', videoCover: null, releaseDate: '2024-01-01' }
			})
		];

		const sorted = sortTopTracks(tracks, 100);
		expect(sorted.map((track) => track.id)).toEqual([5, 4]);
	});

	it('is stable across ties by falling back to structural fields', () => {
		const tracks = [
			buildTrack({
				id: 20,
				title: 'Alpha',
				popularity: 10,
				trackNumber: 2,
				album: { id: 300, title: 'Album C', cover: 'c', videoCover: null, releaseDate: '2022-01-01' }
			}),
			buildTrack({
				id: 19,
				title: 'Beta',
				popularity: 10,
				trackNumber: 1,
				album: { id: 300, title: 'Album C', cover: 'c', videoCover: null, releaseDate: '2022-01-01' }
			}),
			buildTrack({
				id: 21,
				title: 'Gamma',
				popularity: 10,
				trackNumber: 1,
				album: { id: 301, title: 'Album D', cover: 'd', videoCover: null, releaseDate: '2022-01-01' }
			})
		];

		const sorted = sortTopTracks(tracks, 100);
		expect(sorted.map((track) => track.id)).toEqual([19, 20, 21]);
	});

	it('respects max limit and does not mutate the source array', () => {
		const tracks = [
			buildTrack({ id: 1, title: 'A', popularity: 1 }),
			buildTrack({ id: 2, title: 'B', popularity: 2 }),
			buildTrack({ id: 3, title: 'C', popularity: 3 })
		];

		const originalOrder = tracks.map((track) => track.id);
		const sorted = sortTopTracks(tracks, 2);

		expect(sorted.map((track) => track.id)).toEqual([3, 2]);
		expect(tracks.map((track) => track.id)).toEqual(originalOrder);
	});
});
