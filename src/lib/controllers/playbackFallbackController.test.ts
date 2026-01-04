import { describe, it, expect, vi } from 'vitest';
import { createPlaybackFallbackController } from './playbackFallbackController';
import { createInitialState, transition } from '$lib/machines/playbackMachine';
import type { AudioQuality, Track } from '$lib/types';

const buildTrack = (id = 123): Track => ({
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

describe('playbackFallbackController integration', () => {
	it('requests streaming fallback and updates machine state', () => {
		const track = buildTrack();
		let machineState = transition(createInitialState(), { type: 'LOAD_TRACK', track });
		machineState = transition(machineState, {
			type: 'LOAD_COMPLETE',
			streamUrl: 'https://example.com/stream.m4a',
			quality: 'LOSSLESS'
		});
		machineState = transition(machineState, { type: 'PLAY' });
		const prevRequestId = machineState.context.loadRequestId;

		const controller = createPlaybackFallbackController({
			getCurrentTrack: () => track,
			getPlayerQuality: () => 'LOSSLESS',
			getCurrentPlaybackQuality: () => 'LOSSLESS',
			getIsPlaying: () => true,
			isFirefox: () => false,
			getDashPlaybackActive: () => false,
			setDashPlaybackActive: vi.fn(),
			setLoading: vi.fn(),
			loadStandardTrack: vi.fn().mockResolvedValue(undefined),
			createSequence: () => 1,
			setResumeAfterFallback: vi.fn(),
			onFallbackRequested: (quality, reason) => {
				machineState = transition(machineState, {
					type: 'FALLBACK_REQUESTED',
					quality,
					reason
				});
			}
		});

		const mediaError = {
			code: 3,
			MEDIA_ERR_DECODE: 3,
			MEDIA_ERR_ABORTED: 1,
			MEDIA_ERR_SRC_NOT_SUPPORTED: 4
		};
		const event = { currentTarget: { error: mediaError } } as unknown as Event;
		const didFallback = controller.handleAudioError(event);

		expect(didFallback).toBe(true);
		expect(machineState.state).toBe('loading');
		expect(machineState.context.quality).toBe('HIGH');
		expect(machineState.context.loadRequestId).toBe(prevRequestId + 1);
	});

	it('allows fallback after a rapid track switch', () => {
		const trackA = buildTrack(101);
		const trackB = buildTrack(202);
		let currentTrack: Track = trackA;

		const loadStandardTrack = vi.fn().mockResolvedValue(undefined);
		const onFallbackRequested = vi.fn();
		let sequence = 0;

		const controller = createPlaybackFallbackController({
			getCurrentTrack: () => currentTrack,
			getPlayerQuality: () => 'LOSSLESS',
			getCurrentPlaybackQuality: () => 'LOSSLESS',
			getIsPlaying: () => true,
			isFirefox: () => false,
			getDashPlaybackActive: () => false,
			setDashPlaybackActive: vi.fn(),
			setLoading: vi.fn(),
			loadStandardTrack,
			createSequence: () => ++sequence,
			setResumeAfterFallback: vi.fn(),
			onFallbackRequested
		});

		const mediaError = {
			code: 3,
			MEDIA_ERR_DECODE: 3,
			MEDIA_ERR_ABORTED: 1,
			MEDIA_ERR_SRC_NOT_SUPPORTED: 4
		};
		const event = { currentTarget: { error: mediaError } } as unknown as Event;

		controller.handleAudioError(event);
		currentTrack = trackB;
		controller.resetForTrack(trackB.id);
		controller.handleAudioError(event);

		expect(loadStandardTrack).toHaveBeenCalledTimes(2);
		expect(loadStandardTrack.mock.calls[0]?.[0]).toBe(trackA);
		expect(loadStandardTrack.mock.calls[1]?.[0]).toBe(trackB);
		expect(onFallbackRequested).toHaveBeenCalledTimes(2);
	});

	it('skips fallback once quality switches away from lossless', () => {
		const track = buildTrack(303);
		let playerQuality: AudioQuality = 'LOSSLESS';
		let playbackQuality: AudioQuality | null = 'LOSSLESS';
		const loadStandardTrack = vi.fn().mockResolvedValue(undefined);

		const controller = createPlaybackFallbackController({
			getCurrentTrack: () => track,
			getPlayerQuality: () => playerQuality,
			getCurrentPlaybackQuality: () => playbackQuality,
			getIsPlaying: () => true,
			isFirefox: () => false,
			getDashPlaybackActive: () => false,
			setDashPlaybackActive: vi.fn(),
			setLoading: vi.fn(),
			loadStandardTrack,
			createSequence: (() => {
				let seq = 0;
				return () => ++seq;
			})(),
			setResumeAfterFallback: vi.fn()
		});

		const mediaError = {
			code: 3,
			MEDIA_ERR_DECODE: 3,
			MEDIA_ERR_ABORTED: 1,
			MEDIA_ERR_SRC_NOT_SUPPORTED: 4
		};
		const event = { currentTarget: { error: mediaError } } as unknown as Event;

		controller.handleAudioError(event);
		playerQuality = 'HIGH';
		playbackQuality = 'HIGH';
		controller.resetForTrack(track.id);
		const didFallback = controller.handleAudioError(event);

		expect(loadStandardTrack).toHaveBeenCalledTimes(1);
		expect(didFallback).toBe(false);
	});
});
