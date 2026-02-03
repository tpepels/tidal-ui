import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import type { PlayableTrack } from '../types';
import { createPlaybackTransitions } from './playbackTransitions';

const playbackMachineActions = vi.hoisted(() => ({
	updateTime: vi.fn(),
	updateDuration: vi.fn(),
	updateVolume: vi.fn()
}));

const playbackFacadeMock = vi.hoisted(() => ({
	play: vi.fn(),
	pause: vi.fn(),
	toggle: vi.fn(),
	loadQueue: vi.fn(),
	next: vi.fn(),
	previous: vi.fn(),
	enqueue: vi.fn(),
	enqueueNext: vi.fn(),
	clearQueue: vi.fn()
}));

vi.mock('$lib/stores/playbackMachine.svelte', () => ({
	playbackMachine: { actions: playbackMachineActions }
}));

vi.mock('$lib/controllers/playbackFacade', () => ({
	playbackFacade: playbackFacadeMock
}));

type PlaybackState = {
	currentTrack: PlayableTrack | null;
	isPlaying: boolean;
	isLoading: boolean;
	currentTime: number;
	duration: number;
	queue: PlayableTrack[];
	queueIndex: number;
};

describe('playbackTransitions', () => {
	const makeTrack = (id: number): PlayableTrack =>
		({
			id,
			title: `Track ${id}`,
			duration: 120
		}) as PlayableTrack;

	let store = writable<PlaybackState>({
		currentTrack: null,
		isPlaying: false,
		isLoading: false,
		currentTime: 0,
		duration: 0,
		queue: [],
		queueIndex: -1
	});

	let transitions = createPlaybackTransitions(store);

	const resetStore = (overrides: Partial<PlaybackState> = {}) => {
		store.set({
			currentTrack: null,
			isPlaying: false,
			isLoading: false,
			currentTime: 0,
			duration: 0,
			queue: [],
			queueIndex: -1,
			...overrides
		});
	};

	beforeEach(() => {
		vi.unstubAllEnvs();
		playbackMachineActions.updateTime.mockClear();
		playbackMachineActions.updateDuration.mockClear();
		playbackMachineActions.updateVolume.mockClear();
		playbackFacadeMock.play.mockClear();
		playbackFacadeMock.pause.mockClear();
		playbackFacadeMock.toggle.mockClear();
		playbackFacadeMock.loadQueue.mockClear();
		playbackFacadeMock.next.mockClear();
		playbackFacadeMock.previous.mockClear();
		playbackFacadeMock.enqueue.mockClear();
		playbackFacadeMock.enqueueNext.mockClear();
		playbackFacadeMock.clearQueue.mockClear();

		store = writable({
			currentTrack: null,
			isPlaying: false,
			isLoading: false,
			currentTime: 0,
			duration: 0,
			queue: [],
			queueIndex: -1
		});
		transitions = createPlaybackTransitions(store);
	});

	it('throws when trying to play without a track', () => {
		expect(() => transitions.play()).toThrow();
	});

	it('calls playbackFacade when playing with a current track', () => {
		const track = makeTrack(1);
		resetStore({ currentTrack: track, queue: [track], queueIndex: 0 });
		transitions.play();
		expect(playbackFacadeMock.play).toHaveBeenCalled();
	});

	it('loads a single track via playbackFacade', () => {
		const track = makeTrack(2);
		transitions.setTrack(track);
		expect(playbackFacadeMock.loadQueue).toHaveBeenCalledWith([track], 0);
	});

	it('seeks within bounds', () => {
		resetStore({ duration: 90 });
		transitions.seekTo(120);
		expect(playbackMachineActions.updateTime).toHaveBeenCalledWith(90);
	});

	it('plays from queue index', () => {
		const tracks = [makeTrack(1), makeTrack(2)];
		resetStore({ queue: tracks, queueIndex: 0, currentTrack: tracks[0] });
		transitions.playFromQueueIndex(1);
		expect(playbackFacadeMock.loadQueue).toHaveBeenCalledWith(tracks, 1);
		expect(playbackFacadeMock.play).toHaveBeenCalled();
	});

	it('routes next and previous through playbackFacade', () => {
		transitions.next();
		expect(playbackFacadeMock.next).toHaveBeenCalled();

		transitions.previous();
		expect(playbackFacadeMock.previous).toHaveBeenCalled();
	});
});
