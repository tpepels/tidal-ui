import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Album, Track } from './types';

vi.mock('./api', () => ({
	losslessAPI: {
		getAlbum: vi.fn(),
		fetchTrackBlob: vi.fn(),
		getCoverUrl: vi.fn()
	}
}));

vi.mock('./server-upload/uploadService', () => ({
	downloadTrackServerSide: vi.fn()
}));

vi.mock('./stores/downloadLog', () => ({
	downloadLogStore: {
		log: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn()
	}
}));

vi.mock('./stores/downloadUi', () => ({
	downloadUiStore: {
		beginTrackDownload: vi.fn(),
		updateTrackProgress: vi.fn(),
		updateTrackPhase: vi.fn(),
		updateTrackStage: vi.fn(),
		completeTrackDownload: vi.fn(),
		errorTrackDownload: vi.fn()
	}
}));

import { downloadAlbum } from './downloads';
import { losslessAPI } from './api';
import { downloadTrackServerSide } from './server-upload/uploadService';
import { downloadUiStore } from './stores/downloadUi';

describe('downloadAlbum server progress', () => {
	const jsonResponse = (payload: unknown, status = 200): Response =>
		new Response(JSON.stringify(payload), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});

	beforeEach(() => {
		vi.resetAllMocks();
		// Mock fetch for MusicBrainz lookup + queue API
		global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url === '/api/metadata/musicbrainz-release-search') {
				return jsonResponse({ success: true, releases: [] });
			}
			if (url === '/api/download-queue') {
				return jsonResponse({ success: true, jobId: 'test-job-1' });
			}
			return jsonResponse({ success: false }, 404);
		});
	});

	it('passes upload progress callback for server downloads', async () => {
		const album: Album = {
			id: 1,
			title: 'Progress Album',
			cover: 'cover',
			videoCover: null,
			releaseDate: '2024-01-01',
			numberOfTracks: 1,
			numberOfVolumes: 1,
			duration: 180,
			artist: { id: 1, name: 'Progress Artist', type: 'MAIN' },
			artists: [{ id: 1, name: 'Progress Artist', type: 'MAIN' }],
			explicit: false,
			popularity: 1,
			type: 'album',
			upc: '0000'
		};

		const track: Track = {
			id: 10,
			title: 'Progress Track',
			duration: 180,
			trackNumber: 1,
			volumeNumber: 1,
			explicit: false,
			isrc: 'TEST123',
			audioQuality: 'LOSSLESS',
			audioModes: ['STEREO'],
			allowStreaming: true,
			streamReady: true,
			streamStartDate: '2024-01-01',
			premiumStreamingOnly: false,
			replayGain: -6.5,
			peak: 0.95,
			version: null,
			popularity: 1,
			url: 'https://example.com',
			editable: false,
			artist: { id: 1, name: 'Progress Artist', type: 'MAIN' },
			artists: [{ id: 1, name: 'Progress Artist', type: 'MAIN' }],
			album,
			mixes: {},
			mediaMetadata: { tags: [] }
		};

		vi.mocked(losslessAPI.getAlbum).mockResolvedValue({ album, tracks: [track] });
		vi.mocked(losslessAPI.fetchTrackBlob).mockResolvedValue({
			blob: new Blob(['test'], { type: 'audio/flac' })
		});
		vi.mocked(downloadUiStore.beginTrackDownload).mockReturnValue({
			taskId: 'task-1',
			controller: new AbortController()
		});
		vi.mocked(downloadTrackServerSide).mockResolvedValue({
			success: true,
			message: 'Saved'
		});

		await downloadAlbum(album, 'LOSSLESS', undefined, undefined, {
			mode: 'individual',
			storage: 'server'
		});

		// Verify queue API was called instead of individual download
		expect(global.fetch).toHaveBeenCalledWith('/api/download-queue', expect.objectContaining({
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		}));
	});

	it('includes forceOverwrite in queue request when requested', async () => {
		const album: Album = {
			id: 11,
			title: 'Overwrite Album',
			cover: 'cover',
			videoCover: null,
			releaseDate: '2024-01-01',
			numberOfTracks: 1,
			numberOfVolumes: 1,
			duration: 180,
			artist: { id: 1, name: 'Overwrite Artist', type: 'MAIN' },
			artists: [{ id: 1, name: 'Overwrite Artist', type: 'MAIN' }],
			explicit: false,
			popularity: 1,
			type: 'album',
			upc: '0000'
		};
		const track: Track = {
			id: 12,
			title: 'Overwrite Track',
			duration: 180,
			trackNumber: 1,
			volumeNumber: 1,
			explicit: false,
			isrc: 'TEST123',
			audioQuality: 'LOSSLESS',
			audioModes: ['STEREO'],
			allowStreaming: true,
			streamReady: true,
			streamStartDate: '2024-01-01',
			premiumStreamingOnly: false,
			replayGain: -6.5,
			peak: 0.95,
			version: null,
			popularity: 1,
			url: 'https://example.com',
			editable: false,
			artist: { id: 1, name: 'Overwrite Artist', type: 'MAIN' },
			artists: [{ id: 1, name: 'Overwrite Artist', type: 'MAIN' }],
			album,
			mixes: {},
			mediaMetadata: { tags: [] }
		};
		vi.mocked(losslessAPI.getAlbum).mockResolvedValue({ album, tracks: [track] });

		await downloadAlbum(album, 'LOSSLESS', undefined, undefined, {
			mode: 'individual',
			storage: 'server',
			forceOverwrite: true
		});

		const queueCall = vi
			.mocked(global.fetch)
			.mock.calls.find((call) => call[0] === '/api/download-queue');
		const body = JSON.parse((queueCall?.[1] as { body?: string } | undefined)?.body ?? '{}');
		expect(body.forceOverwrite).toBe(true);
		expect(body.job?.forceOverwrite).toBe(true);
	});

	it('auto-selects MusicBrainz release id when title and track count match', async () => {
		const album: Album = {
			id: 21,
			title: 'Voices of a Generation',
			cover: 'cover',
			videoCover: null,
			releaseDate: '2024-01-01',
			numberOfTracks: 12,
			numberOfVolumes: 1,
			duration: 180,
			artist: { id: 3, name: 'Bob Dylan', type: 'MAIN' },
			artists: [{ id: 3, name: 'Bob Dylan', type: 'MAIN' }],
			explicit: false,
			popularity: 1,
			type: 'album',
			upc: '1111'
		};
		const tracks = Array.from({ length: 12 }, (_, index) => ({
			id: 2100 + index,
			title: `Track ${index + 1}`,
			duration: 180,
			trackNumber: index + 1,
			volumeNumber: 1,
			explicit: false,
			isrc: `TEST0000${index}`,
			audioQuality: 'LOSSLESS',
			audioModes: ['STEREO'],
			allowStreaming: true,
			streamReady: true,
			streamStartDate: '2024-01-01',
			premiumStreamingOnly: false,
			replayGain: -6.5,
			peak: 0.95,
			version: null,
			popularity: 1,
			url: 'https://example.com',
			editable: false,
			artist: { id: 3, name: 'Bob Dylan', type: 'MAIN' },
			artists: [{ id: 3, name: 'Bob Dylan', type: 'MAIN' }],
			album,
			mixes: {},
			mediaMetadata: { tags: [] }
		})) as Track[];
		vi.mocked(losslessAPI.getAlbum).mockResolvedValue({ album, tracks });
		vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url === '/api/metadata/musicbrainz-release-search') {
				return jsonResponse({
					success: true,
					releases: [
						{
							id: 'mb-release-match',
							title: 'Voices of a Generation',
							trackCount: 12,
							date: '2024-01-01'
						}
					]
				});
			}
			return jsonResponse({ success: true, jobId: 'test-job-1' });
		});

		await downloadAlbum(album, 'LOSSLESS', undefined, undefined, {
			mode: 'individual',
			storage: 'server'
		});

		const queueCall = vi
			.mocked(global.fetch)
			.mock.calls.find((call) => call[0] === '/api/download-queue');
		const body = JSON.parse((queueCall?.[1] as { body?: string } | undefined)?.body ?? '{}');
		expect(body.job?.musicBrainzReleaseId).toBe('mb-release-match');
	});

	it('does not auto-select MusicBrainz release id when track count is not compatible', async () => {
		const album: Album = {
			id: 22,
			title: 'Voices of a Generation',
			cover: 'cover',
			videoCover: null,
			releaseDate: '2024-01-01',
			numberOfTracks: 12,
			numberOfVolumes: 1,
			duration: 180,
			artist: { id: 3, name: 'Bob Dylan', type: 'MAIN' },
			artists: [{ id: 3, name: 'Bob Dylan', type: 'MAIN' }],
			explicit: false,
			popularity: 1,
			type: 'album',
			upc: '1111'
		};
		const tracks = Array.from({ length: 12 }, (_, index) => ({
			id: 2200 + index,
			title: `Track ${index + 1}`,
			duration: 180,
			trackNumber: index + 1,
			volumeNumber: 1,
			explicit: false,
			isrc: `TEST1000${index}`,
			audioQuality: 'LOSSLESS',
			audioModes: ['STEREO'],
			allowStreaming: true,
			streamReady: true,
			streamStartDate: '2024-01-01',
			premiumStreamingOnly: false,
			replayGain: -6.5,
			peak: 0.95,
			version: null,
			popularity: 1,
			url: 'https://example.com',
			editable: false,
			artist: { id: 3, name: 'Bob Dylan', type: 'MAIN' },
			artists: [{ id: 3, name: 'Bob Dylan', type: 'MAIN' }],
			album,
			mixes: {},
			mediaMetadata: { tags: [] }
		})) as Track[];
		vi.mocked(losslessAPI.getAlbum).mockResolvedValue({ album, tracks });
		vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url === '/api/metadata/musicbrainz-release-search') {
				return jsonResponse({
					success: true,
					releases: [
						{
							id: 'mb-release-too-short',
							title: 'Voices of a Generation',
							trackCount: 10,
							date: '2024-01-01'
						}
					]
				});
			}
			return jsonResponse({ success: true, jobId: 'test-job-1' });
		});

		await downloadAlbum(album, 'LOSSLESS', undefined, undefined, {
			mode: 'individual',
			storage: 'server'
		});

		const queueCall = vi
			.mocked(global.fetch)
			.mock.calls.find((call) => call[0] === '/api/download-queue');
		const body = JSON.parse((queueCall?.[1] as { body?: string } | undefined)?.body ?? '{}');
		expect(body.job?.musicBrainzReleaseId).toBeUndefined();
	});
});
