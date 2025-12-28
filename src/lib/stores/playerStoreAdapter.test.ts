import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type { PlayableTrack } from '../types';
import { playerStore } from './player';
import { playerStoreAdapter } from './playerStoreAdapter';

describe('playerStoreAdapter', () => {
	beforeEach(() => {
		playerStore.reset();
	});

	it('loads a track via adapter', () => {
		const track = { id: 1, title: 'Test Track', duration: 120 } as PlayableTrack;
		playerStoreAdapter.loadTrack(track);
		const state = get(playerStoreAdapter);
		expect(state.currentTrack).toBe(track);
		expect(state.isLoading).toBe(true);
	});

	it('toggles playback state', () => {
		const track = { id: 1, title: 'Test Track', duration: 120 } as PlayableTrack;
		playerStoreAdapter.loadTrack(track);
		playerStoreAdapter.play();
		expect(get(playerStoreAdapter).isPlaying).toBe(true);
		playerStoreAdapter.pause();
		expect(get(playerStoreAdapter).isPlaying).toBe(false);
	});
});
