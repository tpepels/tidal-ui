import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import type { AudioQuality, Track } from '$lib/types';

const mockGetStreamData = vi.fn();
const mockGetDashManifestWithMetadata = vi.fn();

vi.mock('$lib/api', () => ({
	losslessAPI: {
		getStreamData: (...args: unknown[]) => mockGetStreamData(...args),
		getDashManifestWithMetadata: (...args: unknown[]) => mockGetDashManifestWithMetadata(...args)
	},
	DASH_MANIFEST_UNAVAILABLE_CODE: 'DASH_MANIFEST_UNAVAILABLE'
}));

vi.mock('$lib/config', () => ({
	API_CONFIG: {
		useProxy: false,
		proxyUrl: ''
	}
}));

const makeTrack = (id: number): Track =>
	({
		id,
		title: `Track ${id}`,
		duration: 120,
		trackNumber: 1,
		volumeNumber: 1,
		explicit: false,
		isrc: 'TEST123',
		audioQuality: 'LOSSLESS',
		audioModes: ['STEREO'],
		allowStreaming: true,
		streamReady: true,
		streamStartDate: '2020-01-01',
		premiumStreamingOnly: false,
		replayGain: -6.5,
		peak: 0.95,
		artist: { id: 1, name: 'Test Artist', url: '', picture: '' },
		artists: [{ id: 1, name: 'Test Artist', url: '', picture: '' }],
		album: {
			id: 1,
			title: 'Test Album',
			cover: '',
			releaseDate: '2020-01-01',
			numberOfTracks: 10,
			numberOfVolumes: 1,
			duration: 1800
		}
	}) as Track;

describe('trackLoadController DASH handling', () => {
	beforeEach(() => {
		mockGetStreamData.mockResolvedValue({
			url: 'https://example.com/stream',
			replayGain: null,
			sampleRate: null,
			bitDepth: null
		});
		mockGetDashManifestWithMetadata.mockResolvedValue({
			result: { kind: 'dash', manifest: '<MPD></MPD>', contentType: 'application/dash+xml' },
			trackInfo: { replayGain: null, sampleRate: null, bitDepth: null }
		});
		vi.stubEnv('VITE_SHAKA_CDN_URL', '/src/test/shakaStub.ts');
		URL.createObjectURL = vi.fn(() => 'blob:mock') as typeof URL.createObjectURL;
		URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
	});

it('uses direct stream resolver for standard quality and skips DASH manifest', async () => {
	vi.resetModules();
	const { createTrackLoadController } = await import('./trackLoadController');

		const store = writable({
			currentTrack: null,
			queue: [],
			queueIndex: -1,
			quality: 'HIGH' as AudioQuality
		});

		const setDashPlaybackActive = vi.fn();
		const setStreamUrl = vi.fn();

		const audioElement = document.createElement('audio');
		audioElement.pause = vi.fn();
		audioElement.load = vi.fn();

		const controller = createTrackLoadController({
			playerStore: store,
			getAudioElement: () => audioElement,
			getCurrentTrackId: () => null,
			getSupportsLosslessPlayback: () => true,
			setStreamUrl,
			setBufferedPercent: vi.fn(),
			setCurrentPlaybackQuality: vi.fn(),
			setDashPlaybackActive,
			setLoading: vi.fn(),
			setSampleRate: vi.fn(),
			setBitDepth: vi.fn(),
			setReplayGain: vi.fn(),
			createSequence: () => 1,
			getSequence: () => 1,
			isHiResQuality: () => false,
			preloadThresholdSeconds: 5
		});

	await controller.loadTrack(makeTrack(1));

	expect(mockGetStreamData).toHaveBeenCalledWith(1, 'HIGH');
	expect(mockGetDashManifestWithMetadata).not.toHaveBeenCalled();
	expect(setDashPlaybackActive).toHaveBeenCalledWith(false);
	expect(setStreamUrl).toHaveBeenCalledWith('https://example.com/stream');
});
});
