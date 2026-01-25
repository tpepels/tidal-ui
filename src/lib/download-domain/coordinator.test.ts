import { describe, it, expect, vi } from 'vitest';
import { createDownloadCoordinator } from './coordinator';
import type { DownloadCoordinatorDeps } from './interfaces';
import type { DownloadRequest, TrackDownloadPayload } from './types';

const makeRequest = (overrides?: Partial<DownloadRequest>): DownloadRequest => ({
	track: {
		id: 1,
		title: 'Track',
		duration: 120,
		version: null,
		popularity: 0,
		editable: false,
		explicit: false,
		trackNumber: 1,
		volumeNumber: 1,
		isrc: 'TEST',
		url: 'https://example.com',
		audioQuality: 'LOSSLESS',
		audioModes: ['STEREO'],
		allowStreaming: true,
		streamReady: true,
		premiumStreamingOnly: false,
		artist: { id: 1, name: 'Artist', type: 'MAIN' },
		artists: [{ id: 1, name: 'Artist', type: 'MAIN' }],
		album: { id: 1, title: 'Album', cover: '', videoCover: null }
	},
	quality: 'LOSSLESS',
	storage: 'client',
	convertAacToMp3: false,
	downloadCoverSeperately: false,
	...overrides
});

const makePayload = (): TrackDownloadPayload => ({
	track: makeRequest().track,
	quality: 'LOSSLESS',
	blob: new Blob(['test'], { type: 'audio/flac' }),
	filename: 'track.flac'
});

describe('download coordinator', () => {
	it('uses server sink when storage is server', async () => {
		const payload = makePayload();
		const source = { fetchTrack: vi.fn().mockResolvedValue(payload) };
		const sink = {
			saveLocal: vi.fn(),
			saveServer: vi.fn().mockResolvedValue({ success: true, filename: payload.filename })
		};
		const deps: DownloadCoordinatorDeps = { source, sink };

		const coordinator = createDownloadCoordinator(deps);
		const request = makeRequest({ storage: 'server' });
		await coordinator.download(request);

		expect(source.fetchTrack).toHaveBeenCalledWith(request);
		expect(sink.saveServer).toHaveBeenCalledWith(payload, request);
		expect(sink.saveLocal).not.toHaveBeenCalled();
	});

	it('uses local sink when storage is client', async () => {
		const payload = makePayload();
		const source = { fetchTrack: vi.fn().mockResolvedValue(payload) };
		const sink = {
			saveLocal: vi.fn().mockResolvedValue({ success: true, filename: payload.filename }),
			saveServer: vi.fn()
		};
		const deps: DownloadCoordinatorDeps = { source, sink };

		const coordinator = createDownloadCoordinator(deps);
		const request = makeRequest({ storage: 'client' });
		await coordinator.download(request);

		expect(sink.saveLocal).toHaveBeenCalledWith(payload, request.signal);
		expect(sink.saveServer).not.toHaveBeenCalled();
	});

	it('uses transcoder when requested for client downloads', async () => {
		const payload = makePayload();
		const transcoded = { ...payload, filename: 'track.mp3' };
		const source = { fetchTrack: vi.fn().mockResolvedValue(payload) };
		const sink = {
			saveLocal: vi.fn().mockResolvedValue({ success: true, filename: transcoded.filename }),
			saveServer: vi.fn()
		};
		const transcoder = { convertIfNeeded: vi.fn().mockResolvedValue(transcoded) };
		const deps: DownloadCoordinatorDeps = { source, sink, transcoder };

		const coordinator = createDownloadCoordinator(deps);
		const request = makeRequest({ storage: 'client', convertAacToMp3: true });
		await coordinator.download(request);

		expect(transcoder.convertIfNeeded).toHaveBeenCalledWith(payload, 'mp3');
		expect(sink.saveLocal).toHaveBeenCalledWith(transcoded, request.signal);
	});
});
