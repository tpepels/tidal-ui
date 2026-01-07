import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createInitialState, transition } from '$lib/machines/playbackMachine';
import type { Track } from '$lib/types';
import { playerStore } from './player';
import { syncPlayerStoreFromMachine } from './playbackMachineSync';

const baseTrack: Track = {
	id: 100,
	title: 'Base Track',
	duration: 180,
	version: null,
	popularity: 0,
	editable: false,
	explicit: false,
	trackNumber: 1,
	volumeNumber: 1,
	isrc: 'BASE',
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

const makeTrack = (id: number, title: string): Track => ({
	...baseTrack,
	id,
	title,
	album: { ...baseTrack.album, id }
});

describe('playbackMachine ↔ playerStore contract', () => {
	beforeEach(() => {
		playerStore.reset();
	});

	it('keeps load/play/pause flags coherent through machine transitions', () => {
		const track = makeTrack(101, 'Contract Track');
		playerStore.setTrack(track);

		let state = createInitialState('LOSSLESS');
		state = transition(state, { type: 'LOAD_TRACK', track });
		syncPlayerStoreFromMachine(state);

		let store = get(playerStore);
		expect(store.isLoading).toBe(true);
		expect(store.isPlaying).toBe(false);

		state = transition(state, { type: 'PLAY' });
		syncPlayerStoreFromMachine(state);
		store = get(playerStore);
		expect(store.isLoading).toBe(true);
		expect(store.isPlaying).toBe(true);

		state = transition(state, {
			type: 'LOAD_COMPLETE',
			streamUrl: 'https://example.com/stream.m4a',
			quality: 'HIGH'
		});
		syncPlayerStoreFromMachine(state);
		store = get(playerStore);
		expect(store.isLoading).toBe(false);
		expect(store.isPlaying).toBe(true);

		state = transition(state, { type: 'PAUSE' });
		syncPlayerStoreFromMachine(state);
		store = get(playerStore);
		expect(store.isLoading).toBe(false);
		expect(store.isPlaying).toBe(false);
	});

	it('preserves coherence during fast track switching', () => {
		const trackA = makeTrack(201, 'Track A');
		const trackB = makeTrack(202, 'Track B');

		playerStore.setTrack(trackA);
		let state = createInitialState('LOSSLESS');
		state = transition(state, { type: 'LOAD_TRACK', track: trackA });
		state = transition(state, { type: 'PLAY' });
		state = transition(state, {
			type: 'LOAD_COMPLETE',
			streamUrl: 'https://example.com/stream-a.m4a',
			quality: 'HIGH'
		});
		syncPlayerStoreFromMachine(state);

		let store = get(playerStore);
		expect(store.isPlaying).toBe(true);

		playerStore.setTrack(trackB);
		state = transition(state, { type: 'LOAD_TRACK', track: trackB });
		syncPlayerStoreFromMachine(state);
		store = get(playerStore);

		expect(store.currentTrack?.id).toBe(trackB.id);
		expect(store.isLoading).toBe(true);
		expect(store.isPlaying).toBe(true);

		state = transition(state, { type: 'PAUSE' });
		syncPlayerStoreFromMachine(state);
		store = get(playerStore);
		expect(store.isPlaying).toBe(false);
	});
});
