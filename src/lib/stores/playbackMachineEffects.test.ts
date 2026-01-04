import { describe, it, expect, vi } from 'vitest';
import { PlaybackMachineSideEffectHandler } from './playbackMachineEffects';
import type { SideEffect, PlaybackEvent } from '$lib/machines/playbackMachine';
import type { Track } from '$lib/types';
import { losslessAPI } from '$lib/api';

vi.mock('$lib/api', () => ({
	losslessAPI: {
		getStreamData: vi.fn()
	}
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

	it('loads stream data and dispatches load completion', async () => {
		const audio = buildAudioElement();
		const handler = new PlaybackMachineSideEffectHandler();
		handler.setAudioElement(audio);
		handler.setUseExternalStreamLoader(false);

		vi.mocked(losslessAPI.getStreamData).mockResolvedValue({
			url: 'https://example.com/stream.m4a',
			replayGain: null,
			sampleRate: null,
			bitDepth: null
		});

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

		expect(losslessAPI.getStreamData).toHaveBeenCalledWith(track.id, 'HIGH');
		expect(dispatch).toHaveBeenCalledWith({
			type: 'LOAD_COMPLETE',
			streamUrl: expect.stringContaining('example.com/stream.m4a'),
			quality: 'HIGH'
		});
	});
});
