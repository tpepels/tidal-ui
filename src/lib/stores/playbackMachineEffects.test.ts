import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackMachineSideEffectHandler } from './playbackMachineEffects';
import type { SideEffect, PlaybackEvent } from '$lib/machines/playbackMachine';
import type { Track } from '$lib/types';
const {
	mockLoadTrack,
	mockDestroy,
	mockHandleAudioError,
	mockResetForTrack,
	mockCreateTrackLoadController
} = vi.hoisted(() => {
	const loadTrack = vi.fn<[Track], Promise<void>>();
	const destroy = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
	const handleAudioError = vi.fn<[Event], boolean>();
	const resetForTrack = vi.fn<[number | string], void>();
	const createTrackLoadController = vi.fn(
		(options: { onLoadComplete?: (streamUrl: string | null, quality: string) => void }) => {
			loadTrack.mockImplementation(async () => {
				options.onLoadComplete?.('https://example.com/stream.m4a', 'HIGH');
			});
			return {
				loadTrack,
				loadStandardTrack: vi.fn().mockResolvedValue(undefined),
				maybePreloadNextTrack: vi.fn(),
				destroy
			};
		}
	);

	return {
		mockLoadTrack: loadTrack,
		mockDestroy: destroy,
		mockHandleAudioError: handleAudioError,
		mockResetForTrack: resetForTrack,
		mockCreateTrackLoadController: createTrackLoadController
	};
});

vi.mock('$lib/controllers/trackLoadController', () => ({
	createTrackLoadController: mockCreateTrackLoadController
}));

vi.mock('$lib/controllers/playbackFallbackController', () => ({
	createPlaybackFallbackController: vi.fn(() => ({
		handleAudioError: mockHandleAudioError,
		resetForTrack: mockResetForTrack
	}))
}));

vi.mock('$lib/stores/toasts', () => ({
	toasts: {
		error: vi.fn()
	}
}));

vi.mock('$lib/utils/trackConversion', () => ({
	convertSonglinkTrackToTidal: vi.fn()
}));

const buildTrack = (id: number): Track => ({
	id,
	title: 'Test Track',
	duration: 180,
	version: null,
	popularity: 0,
	editable: false,
	explicit: false,
	trackNumber: 1,
	volumeNumber: 1,
	isrc: 'TEST123',
	copyright: 'Test',
	url: 'https://example.com',
	artists: [],
	artist: { id: 1, name: 'Test Artist', type: 'MAIN', url: '', picture: '' },
	album: {
		id: 1,
		title: 'Test Album',
		numberOfTracks: 10,
		numberOfVolumes: 1,
		releaseDate: '2024-01-01',
		duration: 1800,
		cover: '',
		videoCover: null
	},
	allowStreaming: true,
	streamReady: true,
	audioQuality: 'LOSSLESS',
	audioModes: ['STEREO'],
	mediaMetadata: { tags: [] },
	peak: 0.95,
	premiumStreamingOnly: false
});

const buildAudioElement = () =>
	({
		src: '',
		currentTime: 0,
		load: vi.fn(),
		play: vi.fn(() => Promise.resolve()),
		pause: vi.fn()
	}) as unknown as HTMLAudioElement;

describe('PlaybackMachineSideEffectHandler', () => {
	beforeEach(() => {
		mockLoadTrack.mockClear();
		mockDestroy.mockClear();
		mockHandleAudioError.mockClear();
		mockResetForTrack.mockClear();
		mockCreateTrackLoadController.mockClear();
	});
	it('plays, pauses, and seeks through the audio element', async () => {
		const audio = buildAudioElement();
		const handler = new PlaybackMachineSideEffectHandler();
		handler.setAudioElement(audio);

		const dispatch = vi.fn<[PlaybackEvent], void>();

		await handler.execute({ type: 'PLAY_AUDIO' } satisfies SideEffect, dispatch as (event: PlaybackEvent) => void);
		expect(audio.play).toHaveBeenCalled();

		await handler.execute({ type: 'PAUSE_AUDIO' } satisfies SideEffect, dispatch as (event: PlaybackEvent) => void);
		expect(audio.pause).toHaveBeenCalled();

		await handler.execute(
			{ type: 'SEEK_AUDIO', position: 12.5 } satisfies SideEffect,
			dispatch as (event: PlaybackEvent) => void
		);
		expect(audio.currentTime).toBe(12.5);
	});

	it('destroys load controller when audio element is cleared', () => {
		const audio = buildAudioElement();
		const handler = new PlaybackMachineSideEffectHandler();
		handler.setAudioElement(audio);

		expect(mockCreateTrackLoadController).not.toHaveBeenCalled();
		const track = buildTrack(202);
		const dispatch = vi.fn<[PlaybackEvent], void>();
		return handler
			.execute(
				{ type: 'LOAD_STREAM', track, quality: 'HIGH', requestId: 1 } satisfies SideEffect,
				dispatch as (event: PlaybackEvent) => void
			)
			.then(() => {
				expect(mockCreateTrackLoadController).toHaveBeenCalledTimes(1);

				handler.setAudioElement(null);
				expect(mockDestroy).toHaveBeenCalledTimes(1);
			});
	});

	it('loads stream data and dispatches load completion', async () => {
		const audio = buildAudioElement();
		const handler = new PlaybackMachineSideEffectHandler();
		handler.setAudioElement(audio);

		const track = buildTrack(202);
		const dispatch = vi.fn<[PlaybackEvent], void>();

		await handler.execute(
			{
				type: 'LOAD_STREAM',
				track,
				quality: 'HIGH',
				requestId: 1
			} satisfies SideEffect,
			dispatch as (event: PlaybackEvent) => void
		);

		expect(mockLoadTrack).toHaveBeenCalledWith(track);
		expect(dispatch).toHaveBeenCalledWith({
			type: 'LOAD_COMPLETE',
			streamUrl: expect.stringContaining('example.com/stream.m4a'),
			quality: 'HIGH'
		});
	});

	it('dispatches load error when fallback controller does not recover', async () => {
		mockHandleAudioError.mockReturnValueOnce(false);
		const handler = new PlaybackMachineSideEffectHandler();
		const dispatch = vi.fn<[PlaybackEvent], void>();

		await handler.execute(
			{ type: 'HANDLE_AUDIO_ERROR', error: new Event('error') } satisfies SideEffect,
			dispatch as (event: PlaybackEvent) => void
		);

		expect(dispatch).toHaveBeenCalledWith({
			type: 'LOAD_ERROR',
			error: expect.any(Error)
		});
	});

	it('resets fallback state when loading a new track', async () => {
		const audio = buildAudioElement();
		const handler = new PlaybackMachineSideEffectHandler();
		handler.setAudioElement(audio);

		const track = buildTrack(303);
		const dispatch = vi.fn<[PlaybackEvent], void>();

		await handler.execute(
			{
				type: 'LOAD_STREAM',
				track,
				quality: 'HIGH',
				requestId: 1
			} satisfies SideEffect,
			dispatch as (event: PlaybackEvent) => void
		);

		expect(mockResetForTrack).toHaveBeenCalledWith(track.id);
	});
});
