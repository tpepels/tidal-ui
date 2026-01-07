import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { createInitialState, transition } from '$lib/machines/playbackMachine';
import type { Track } from '$lib/types';
import { playerStore } from './player';
import type { SonglinkTrack } from '$lib/types';
import { syncPlayerStoreFromMachine } from './playbackMachineSync';

const mockTrack: Track = {
	id: 444,
	title: 'Consistency Track',
	duration: 180,
	version: null,
	popularity: 0,
	editable: false,
	explicit: false,
	trackNumber: 1,
	volumeNumber: 1,
	isrc: 'CONSISTENCY',
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
};

describe('syncPlayerStoreFromMachine', () => {
	beforeEach(() => {
		playerStore.reset();
	});

	it('syncs loading and play state from machine transitions', () => {
		playerStore.setTrack(mockTrack);
		const initial = createInitialState('LOSSLESS');
		const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTrack });
		syncPlayerStoreFromMachine(loading);

		let state = get(playerStore);
		expect(state.isLoading).toBe(true);
		expect(state.isPlaying).toBe(false);

		const loadingWithPlay = transition(loading, { type: 'PLAY' });
		syncPlayerStoreFromMachine(loadingWithPlay);
		state = get(playerStore);
		expect(state.isPlaying).toBe(true);

		const ready = transition(loadingWithPlay, {
			type: 'LOAD_COMPLETE',
			streamUrl: 'https://example.com/stream.m4a',
			quality: 'HIGH'
		});
		const playing = transition(ready, { type: 'PLAY' });
		syncPlayerStoreFromMachine(playing);
		state = get(playerStore);
		expect(state.isPlaying).toBe(true);

		const paused = transition(playing, { type: 'PAUSE' });
		syncPlayerStoreFromMachine(paused);
		state = get(playerStore);
		expect(state.isPlaying).toBe(false);
	});

	it('warns on machine/store track mismatch for non-songlink tracks', () => {
		const trackA = { ...mockTrack, id: 901, title: 'Track A' };
		const trackB = { ...mockTrack, id: 902, title: 'Track B' };

		playerStore.setTrack(trackA);
		const mismatchState = transition(createInitialState('LOSSLESS'), {
			type: 'LOAD_TRACK',
			track: trackB
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		syncPlayerStoreFromMachine(mismatchState);

		expect(warnSpy).toHaveBeenCalled();
		const warningMessages = warnSpy.mock.calls.map((call) => String(call[0]));
		expect(
			warningMessages.some((message) =>
				message.includes('Playback machine and player store track mismatch')
			)
		).toBe(true);

		warnSpy.mockRestore();
	});

	it('does not warn when one side has no current track', () => {
		const trackA = { ...mockTrack, id: 903, title: 'Track A' };
		playerStore.setTrack(trackA);

		const idleState = createInitialState('LOSSLESS');
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		syncPlayerStoreFromMachine(idleState);

		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('does not warn when either track is Songlink', () => {
		const trackA = { ...mockTrack, id: 904, title: 'Track A' };
		const songlinkTrack: SonglinkTrack = {
			id: 'spotify:track:sl-904',
			title: 'Songlink Track',
			artistName: 'Test Artist',
			duration: 180,
			thumbnailUrl: 'https://example.com/image.jpg',
			sourceUrl: 'https://open.spotify.com/track/sl-904',
			songlinkData: {
				entityUniqueId: 'sl-904',
				userCountry: 'US',
				pageUrl: 'https://song.link/sl-904',
				entitiesByUniqueId: {},
				linksByPlatform: {}
			},
			isSonglinkTrack: true,
			audioQuality: 'LOSSLESS'
		};

		playerStore.setTrack(trackA);
		const songlinkState = transition(createInitialState('LOSSLESS'), {
			type: 'LOAD_TRACK',
			track: songlinkTrack
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		syncPlayerStoreFromMachine(songlinkState);

		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
