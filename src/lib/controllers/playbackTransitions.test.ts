import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayableTrack } from '$lib/types';
import { get } from 'svelte/store';
import { playerStore } from '$lib/stores/player';
import { createPlaybackTransitions } from './playbackTransitions';

describe('playbackTransitions', () => {
	const transitions = createPlaybackTransitions(playerStore);

	const makeTrack = (id: number): PlayableTrack =>
		({
			id,
			title: `Track ${id}`,
			duration: 120
		}) as PlayableTrack;

	beforeEach(() => {
		playerStore.reset();
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
		expect(get(playerStore).currentTime).toBe(90);
	});

	it('plays from queue index', () => {
		const tracks = [makeTrack(1), makeTrack(2)];
		transitions.setQueue(tracks, 0);
		transitions.playFromQueueIndex(1);
		expect(get(playerStore).currentTrack?.id).toBe(2);
	});
});
