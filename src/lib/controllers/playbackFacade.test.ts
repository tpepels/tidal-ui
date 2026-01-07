import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayableTrack } from '$lib/types';
import { playerStore } from '$lib/stores/player';

const playbackActions = vi.hoisted(() => ({
	loadTrack: vi.fn(),
	changeQuality: vi.fn(),
	play: vi.fn(),
	pause: vi.fn(),
	seek: vi.fn(),
	setQueue: vi.fn()
}));

vi.mock('$lib/stores/playbackMachine.svelte', () => ({
	playbackMachine: {
		actions: playbackActions
	}
}));

import { playbackFacade } from './playbackFacade';

const makeTrack = (id: number): PlayableTrack =>
	({
		id,
		title: `Track ${id}`,
		duration: 180
	}) as PlayableTrack;

describe('playbackFacade', () => {
	beforeEach(() => {
		playerStore.reset();
		vi.clearAllMocks();
	});

	it('loads queue and dispatches machine load', () => {
		const tracks = [makeTrack(1), makeTrack(2)];
		const setQueueSpy = vi.spyOn(playerStore, 'setQueue');
		const quality = playerStore.getSnapshot().quality;

		playbackFacade.loadQueue(tracks, 1);

		expect(setQueueSpy).toHaveBeenCalledWith(tracks, 1);
		expect(playbackActions.changeQuality).toHaveBeenCalledWith(quality);
		expect(playbackActions.loadTrack).toHaveBeenCalledWith(tracks[1]);
	});

	it('syncs queue into machine when gate enabled', () => {
		vi.stubEnv('VITE_PLAYBACK_MACHINE_QUEUE_SOT', 'true');
		const tracks = [makeTrack(10), makeTrack(11)];

		playbackFacade.loadQueue(tracks, 0);

		expect(playbackActions.setQueue).toHaveBeenCalledWith(tracks, 0);
		vi.unstubAllEnvs();
	});

	it('routes play and pause through store and machine', () => {
		const playSpy = vi.spyOn(playerStore, 'play');
		const pauseSpy = vi.spyOn(playerStore, 'pause');
		playerStore.setTrack(makeTrack(3));

		playbackFacade.play();
		playbackFacade.pause();

		expect(playSpy).toHaveBeenCalled();
		expect(pauseSpy).toHaveBeenCalled();
		expect(playbackActions.play).toHaveBeenCalled();
		expect(playbackActions.pause).toHaveBeenCalled();
	});

	it('loads next and previous tracks via machine', () => {
		const tracks = [makeTrack(1), makeTrack(2)];
		playerStore.setQueue(tracks, 0);
		playbackActions.loadTrack.mockClear();

		const nextSpy = vi.spyOn(playerStore, 'next');
		playbackFacade.next();
		expect(nextSpy).toHaveBeenCalled();
		expect(playbackActions.loadTrack).toHaveBeenCalledWith(tracks[1]);

		playerStore.setQueue(tracks, 1);
		playbackActions.loadTrack.mockClear();

		const prevSpy = vi.spyOn(playerStore, 'previous');
		playbackFacade.previous();
		expect(prevSpy).toHaveBeenCalled();
		expect(playbackActions.loadTrack).toHaveBeenCalledWith(tracks[0]);
	});

	it('syncs queue index on next/previous when gate enabled', () => {
		vi.stubEnv('VITE_PLAYBACK_MACHINE_QUEUE_SOT', 'true');
		const tracks = [makeTrack(21), makeTrack(22), makeTrack(23)];
		playerStore.setQueue(tracks, 0);
		playbackActions.setQueue.mockClear();

		playbackFacade.next();
		expect(playbackActions.setQueue).toHaveBeenCalledWith(tracks, 1);

		playbackActions.setQueue.mockClear();
		playbackFacade.previous();
		expect(playbackActions.setQueue).toHaveBeenCalledWith(tracks, 0);
		vi.unstubAllEnvs();
	});

	it('syncs queue mutations when gate enabled', () => {
		vi.stubEnv('VITE_PLAYBACK_MACHINE_QUEUE_SOT', 'true');
		const tracks = [makeTrack(31), makeTrack(32)];
		playerStore.setQueue(tracks, 0);
		playbackActions.setQueue.mockClear();

		const extra = makeTrack(33);
		playbackFacade.enqueue(extra);
		expect(playbackActions.setQueue).toHaveBeenCalledWith(
			expect.arrayContaining([tracks[0], tracks[1], extra]),
			0
		);

		playbackActions.setQueue.mockClear();
		playbackFacade.enqueueNext(makeTrack(34));
		expect(playbackActions.setQueue).toHaveBeenCalledWith(
			expect.arrayContaining([tracks[0], tracks[1]]),
			0
		);

		playbackActions.setQueue.mockClear();
		playbackFacade.removeFromQueue(0);
		expect(playbackActions.setQueue).toHaveBeenCalledWith(expect.any(Array), expect.any(Number));

		playbackActions.setQueue.mockClear();
		playbackFacade.clearQueue();
		expect(playbackActions.setQueue).toHaveBeenCalledWith([], -1);

		playbackActions.setQueue.mockClear();
		playerStore.setQueue([makeTrack(41), makeTrack(42), makeTrack(43)], 0);
		playbackFacade.shuffleQueue();
		const shuffledSnapshot = playerStore.getSnapshot();
		expect(playbackActions.setQueue).toHaveBeenCalledWith(
			shuffledSnapshot.queue,
			shuffledSnapshot.queueIndex
		);
		expect(playbackActions.loadTrack).toHaveBeenCalledWith(shuffledSnapshot.currentTrack);
		vi.unstubAllEnvs();
	});
});
