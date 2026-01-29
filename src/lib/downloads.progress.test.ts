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
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('passes upload progress callback for server downloads', async () => {
		const album: Album = {
			id: 1,
			title: 'Progress Album',
			cover: 'cover',
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

		expect(downloadTrackServerSide).toHaveBeenCalled();
		const args = vi.mocked(downloadTrackServerSide).mock.calls[0];
		const options = args?.[7];
		expect(options).toEqual(expect.objectContaining({ onProgress: expect.any(Function) }));
	});
});
