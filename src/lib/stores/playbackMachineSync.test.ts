import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { createInitialState, transition } from '$lib/machines/playbackMachine';
import type { Track } from '$lib/types';
import { playerStore } from './player';
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
});
