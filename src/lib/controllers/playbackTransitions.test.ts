import { beforeEach, describe, expect, it, vi } from 'vitest';

const playbackMachineActions = vi.hoisted(() => ({
	setQueue: vi.fn(),
	play: vi.fn(),
	pause: vi.fn(),
	changeQuality: vi.fn(),
	loadTrack: vi.fn(),
	updateTime: vi.fn(),
	updateDuration: vi.fn(),
	updateVolume: vi.fn()
}));

vi.mock('$lib/stores/playbackMachine.svelte', () => ({
	playbackMachine: { actions: playbackMachineActions }
}));

import type { PlayableTrack } from '../types';
import { get } from 'svelte/store';
import { playerStore } from '../stores/player';
import { playbackMachine } from '$lib/stores/playbackMachine.svelte';
import { createPlaybackTransitions } from './playbackTransitions';

describe('playbackTransitions', () => {
	let transitions = createPlaybackTransitions(playerStore);

	const makeTrack = (id: number): PlayableTrack =>
		({
			id,
			title: `Track ${id}`,
			duration: 120
		}) as PlayableTrack;

	beforeEach(() => {
		vi.unstubAllEnvs();
		playbackMachineActions.setQueue.mockClear();
		playbackMachineActions.updateTime.mockClear();
		playbackMachineActions.updateDuration.mockClear();
		playbackMachineActions.updateVolume.mockClear();
		playerStore.reset();
		transitions = createPlaybackTransitions(playerStore);
	});

	it('throws when trying to play without a track', () => {
		expect(() => transitions.play()).toThrow();
	});

	it('plays when a track is set', () => {
		const track = makeTrack(1);
		transitions.setTrack(track);
		transitions.play();
		expect(get(playerStore).isPlaying).toBe(true);
	});

	it('seeks within bounds', () => {
		const track = makeTrack(2);
		transitions.setTrack(track);
		playerStore.setDuration(90);
		transitions.seekTo(120);
		expect(playbackMachineActions.updateTime).toHaveBeenCalledWith(90);
	});

	it('plays from queue index', () => {
		const tracks = [makeTrack(1), makeTrack(2)];
		transitions.setQueue(tracks, 0);
		transitions.playFromQueueIndex(1);
		expect(get(playerStore).currentTrack?.id).toBe(2);
	});

	it('syncs queue index on next/previous', () => {
		const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
		transitions.setQueue(tracks, 0);
		playbackMachineActions.setQueue.mockClear();

		transitions.next();
		expect(playbackMachineActions.setQueue).toHaveBeenCalledWith(tracks, 1);

		playbackMachineActions.setQueue.mockClear();
		transitions.previous();
		expect(playbackMachineActions.setQueue).toHaveBeenCalledWith(tracks, 0);
	});
});
