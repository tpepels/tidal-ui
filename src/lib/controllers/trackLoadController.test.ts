import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import type { AudioQuality, Track } from '$lib/types';
import { createTrackLoadController } from './trackLoadController';

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

describe('trackLoadController', () => {
	beforeEach(() => {
		mockGetStreamData.mockResolvedValue({
			url: 'https://example.com/stream',
			replayGain: null,
			sampleRate: null,
			bitDepth: null
		});
		mockGetDashManifestWithMetadata.mockResolvedValue({
			result: { kind: 'flac', urls: ['https://example.com/stream'] },
			trackInfo: { replayGain: null, sampleRate: null, bitDepth: null }
		});
	});

	const createDeferred = <T,>() => {
		let resolve!: (value: T) => void;
		const promise = new Promise<T>((resolver) => {
			resolve = resolver;
		});
		return { promise, resolve };
	};

	it('ignores stale attempt updates for loadTrack', async () => {
		const store = writable({
			currentTrack: null,
			queue: [],
			queueIndex: -1,
			quality: 'LOSSLESS' as AudioQuality
		});

		const setStreamUrl = vi.fn();
		const setLoading = vi.fn();

		const controller = createTrackLoadController({
			getPlaybackState: () => get(store),
			getAudioElement: () => null,
			getCurrentTrackId: () => null,
			getSupportsLosslessPlayback: () => true,
			setStreamUrl,
			setBufferedPercent: vi.fn(),
			setCurrentPlaybackQuality: vi.fn(),
			setDashPlaybackActive: vi.fn(),
			setLoading,
			setSampleRate: vi.fn(),
			setBitDepth: vi.fn(),
			setReplayGain: vi.fn(),
			isAttemptCurrent: () => false,
			isHiResQuality: () => false,
			preloadThresholdSeconds: 5
		});

		await controller.loadTrack(makeTrack(1), 'stale-attempt');

		expect(setStreamUrl).not.toHaveBeenCalled();
		expect(setLoading).not.toHaveBeenCalled();
	});

	it('applies stream updates when attempt is current', async () => {
		const store = writable({
			currentTrack: null,
			queue: [],
			queueIndex: -1,
			quality: 'LOSSLESS' as AudioQuality
		});

		const setStreamUrl = vi.fn();
		const setLoading = vi.fn();

		const controller = createTrackLoadController({
			getPlaybackState: () => get(store),
			getAudioElement: () => null,
			getCurrentTrackId: () => null,
			getSupportsLosslessPlayback: () => true,
			setStreamUrl,
			setBufferedPercent: vi.fn(),
			setCurrentPlaybackQuality: vi.fn(),
			setDashPlaybackActive: vi.fn(),
			setLoading,
			setSampleRate: vi.fn(),
			setBitDepth: vi.fn(),
			setReplayGain: vi.fn(),
			isAttemptCurrent: () => true,
			isHiResQuality: () => false,
			preloadThresholdSeconds: 5
		});

		await controller.loadTrack(makeTrack(2), 'attempt-current');

		expect(setStreamUrl).toHaveBeenCalledWith('https://example.com/stream');
		expect(setLoading).toHaveBeenCalledWith(true);
	});

	it('uses latest quality when loadTrack is called after a quality change', async () => {
		const store = writable({
			currentTrack: null,
			queue: [],
			queueIndex: -1,
			quality: 'LOW' as AudioQuality
		});

		const setStreamUrl = vi.fn();

		const controller = createTrackLoadController({
			getPlaybackState: () => get(store),
			getAudioElement: () => null,
			getCurrentTrackId: () => null,
			getSupportsLosslessPlayback: () => true,
			setStreamUrl,
			setBufferedPercent: vi.fn(),
			setCurrentPlaybackQuality: vi.fn(),
			setDashPlaybackActive: vi.fn(),
			setLoading: vi.fn(),
			setSampleRate: vi.fn(),
			setBitDepth: vi.fn(),
			setReplayGain: vi.fn(),
			isAttemptCurrent: () => true,
			isHiResQuality: () => false,
			preloadThresholdSeconds: 5
		});

		await controller.loadTrack(makeTrack(3), 'attempt-1');

		store.update((state) => ({ ...state, quality: 'HIGH' }));
		await controller.loadTrack(makeTrack(3), 'attempt-2');

		expect(mockGetStreamData).toHaveBeenCalledWith(3, 'LOW');
		expect(mockGetStreamData).toHaveBeenCalledWith(3, 'HIGH');
		expect(setStreamUrl).toHaveBeenCalledTimes(2);
	});

	it('ignores stale stream resolution when a newer track loads', async () => {
		const store = writable({
			currentTrack: null,
			queue: [],
			queueIndex: -1,
			quality: 'LOSSLESS' as AudioQuality
		});

		const setStreamUrl = vi.fn();
		let currentAttempt = 'attempt-1';

		const deferredFirst = createDeferred<{
			url: string;
			replayGain: number | null;
			sampleRate: number | null;
			bitDepth: number | null;
		}>();
		const deferredSecond = createDeferred<{
			url: string;
			replayGain: number | null;
			sampleRate: number | null;
			bitDepth: number | null;
		}>();

		mockGetStreamData
			.mockImplementationOnce(() => deferredFirst.promise)
			.mockImplementationOnce(() => deferredSecond.promise);

		const controller = createTrackLoadController({
			getPlaybackState: () => get(store),
			getAudioElement: () => null,
			getCurrentTrackId: () => null,
			getSupportsLosslessPlayback: () => true,
			setStreamUrl,
			setBufferedPercent: vi.fn(),
			setCurrentPlaybackQuality: vi.fn(),
			setDashPlaybackActive: vi.fn(),
			setLoading: vi.fn(),
			setSampleRate: vi.fn(),
			setBitDepth: vi.fn(),
			setReplayGain: vi.fn(),
			isAttemptCurrent: (attemptId) => attemptId === currentAttempt,
			isHiResQuality: () => false,
			preloadThresholdSeconds: 5
		});

		const firstLoad = controller.loadTrack(makeTrack(1), 'attempt-1');
		currentAttempt = 'attempt-2';
		const secondLoad = controller.loadTrack(makeTrack(2), 'attempt-2');

		deferredSecond.resolve({
			url: 'https://example.com/stream-2',
			replayGain: null,
			sampleRate: null,
			bitDepth: null
		});
		await secondLoad;

		deferredFirst.resolve({
			url: 'https://example.com/stream-1',
			replayGain: null,
			sampleRate: null,
			bitDepth: null
		});
		await firstLoad;

		expect(setStreamUrl).toHaveBeenCalledTimes(1);
		expect(setStreamUrl).toHaveBeenCalledWith('https://example.com/stream-2');
	});

	it('falls back to streaming quality when lossless playback is unsupported', async () => {
		const store = writable({
			currentTrack: null,
			queue: [],
			queueIndex: -1,
			quality: 'LOSSLESS' as AudioQuality
		});

		const setStreamUrl = vi.fn();
		const onFallbackRequested = vi.fn();

		const controller = createTrackLoadController({
			getPlaybackState: () => get(store),
			getAudioElement: () => null,
			getCurrentTrackId: () => null,
			getSupportsLosslessPlayback: () => false,
			getStreamingFallbackQuality: () => 'HIGH',
			setStreamUrl,
			setBufferedPercent: vi.fn(),
			setCurrentPlaybackQuality: vi.fn(),
			setDashPlaybackActive: vi.fn(),
			setLoading: vi.fn(),
			setSampleRate: vi.fn(),
			setBitDepth: vi.fn(),
			setReplayGain: vi.fn(),
			isAttemptCurrent: () => true,
			isHiResQuality: () => false,
			preloadThresholdSeconds: 5,
			onFallbackRequested
		});

		await controller.loadTrack(makeTrack(4), 'attempt-lossless');

		expect(mockGetStreamData).toHaveBeenCalledWith(4, 'HIGH');
		expect(onFallbackRequested).toHaveBeenCalledWith('HIGH', 'lossless-unsupported');
		expect(setStreamUrl).toHaveBeenCalledWith('https://example.com/stream');
	});
});
