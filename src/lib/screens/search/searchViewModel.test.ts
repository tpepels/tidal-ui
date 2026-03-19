import { describe, expect, it } from 'vitest';
import type { Album, Artist, Playlist, Track } from '$lib/types';
import {
	buildSearchAlbumRowViewModel,
	buildSearchArtistRowViewModel,
	buildSearchPlaylistRowViewModel,
	buildSearchTrackRowViewModel
} from './searchViewModel';

describe('searchViewModel', () => {
	it('builds track row view models with button-style primary actions', () => {
		const track = {
			id: 42,
			title: 'Windowlicker',
			version: 'Radio Edit',
			duration: 381,
			audioQuality: 'LOSSLESS',
			artists: [{ id: 10, name: 'Aphex Twin', type: 'Artist' }],
			album: { id: 99, title: 'Windowlicker', cover: 'abc-def', numberOfVolumes: 1 }
		} as unknown as Track;

		const row = buildSearchTrackRowViewModel({
			track,
			downloadingIds: new Set([42]),
			cancelledIds: new Set(),
			downloadActionLabel: 'Download'
		});

		expect(row.item.primaryAction).toBe('button');
		expect(row.item.title).toBe('Windowlicker');
		expect(row.item.titleSuffix).toBe('Radio Edit');
		expect(row.isDownloading).toBe(true);
		expect(row.item.meta).toContain('CD');
	});

	it('builds album row view models with status badges and stop actions', () => {
		const album = {
			id: 7,
			title: 'Selected Ambient Works',
			cover: 'abc-def',
			numberOfTracks: 13,
			releaseDate: '1992-01-01',
			artist: { id: 1, name: 'Aphex Twin' }
		} as unknown as Album;

		const row = buildSearchAlbumRowViewModel({
			album,
			downloadState: {
				status: 'processing',
				downloading: true,
				completed: 2,
				total: 13,
				error: null,
				queueJobId: 'job-1'
			},
			hasMusicBrainzMatch: true,
			isMusicBrainzLoading: true,
			pendingMusicBrainzAlbumIds: new Set([7]),
			downloadActionLabel: 'Save to server'
		});

		expect(row.item.href).toBe('/album/7');
		expect(row.item.badge?.kind).toBe('image');
		expect(row.item.status).toContain('Downloading 2/13');
		expect(row.canCancel).toBe(true);
		expect(row.action.label).toBe('Stop');
	});

	it('builds artist and playlist link rows from display-ready metadata', () => {
		const artist = {
			id: 5,
			name: 'Boards of Canada',
			type: 'Band',
			picture: 'abc-def'
		} as unknown as Artist;
		const playlist = {
			uuid: 'playlist-1',
			title: 'Late Night',
			image: 'ghi-jkl',
			numberOfTracks: 25,
			duration: 3600,
			creator: { name: 'Bini' }
		} as unknown as Playlist;

		const artistRow = buildSearchArtistRowViewModel(artist);
		const playlistRow = buildSearchPlaylistRowViewModel(playlist);

		expect(artistRow.item.href).toBe('/artist/5');
		expect(artistRow.item.artwork?.shape).toBe('circle');
		expect(playlistRow.item.href).toBe('/playlist/playlist-1');
		expect(playlistRow.item.meta).toContain('25 tracks');
	});
});
