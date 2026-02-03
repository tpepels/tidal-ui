import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayableTrack } from '$lib/types';

const playbackActions = vi.hoisted(() => ({
	loadTrack: vi.fn(),
	changeQuality: vi.fn(),
	play: vi.fn(),
	pause: vi.fn(),
	seek: vi.fn(),
	setQueue: vi.fn()
}));

const playbackMachineMock = vi.hoisted(() => ({
	actions: playbackActions,
	context: {
		currentTrack: null as PlayableTrack | null,
		queue: [] as PlayableTrack[],
		queueIndex: -1
	},
	isPlaying: false
}));

const queueCoordinator = vi.hoisted(() => ({
	setQueue: vi.fn(),
	next: vi.fn(),
	previous: vi.fn(),
	enqueue: vi.fn(),
	enqueueNext: vi.fn(),
	removeFromQueue: vi.fn(),
	clearQueue: vi.fn(),
	shuffleQueue: vi.fn()
}));

vi.mock('$lib/stores/playbackMachine.svelte', () => ({
	playbackMachine: playbackMachineMock
}));

vi.mock('$lib/controllers/playbackQueueCoordinator', () => ({
	playbackQueueCoordinator: queueCoordinator
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
		playbackMachineMock.context = { currentTrack: null, queue: [], queueIndex: -1 };
		playbackMachineMock.isPlaying = false;
		vi.clearAllMocks();
	});

	it('loads queue and dispatches machine load', () => {
		const tracks = [makeTrack(1), makeTrack(2)];
		queueCoordinator.setQueue.mockReturnValue({
			queue: tracks,
			queueIndex: 1,
			currentTrack: tracks[1]
		});

		playbackFacade.loadQueue(tracks, 1);

		expect(queueCoordinator.setQueue).toHaveBeenCalledWith(tracks, 1);
		// NOTE: changeQuality is intentionally NOT called here to avoid race conditions.
		// Calling changeQuality before loadTrack would cause the OLD track to reload,
		// then loadTrack would load the new track, resulting in two concurrent loads.
		expect(playbackActions.changeQuality).not.toHaveBeenCalled();
		expect(playbackActions.loadTrack).toHaveBeenCalledWith(tracks[1]);
	});

	it('syncs queue into machine', () => {
		const tracks = [makeTrack(10), makeTrack(11)];
		queueCoordinator.setQueue.mockReturnValue({
			queue: tracks,
			queueIndex: 0,
			currentTrack: tracks[0]
		});

		playbackFacade.loadQueue(tracks, 0);

		expect(queueCoordinator.setQueue).toHaveBeenCalledWith(tracks, 0);
	});

	it('routes play and pause through machine', () => {
		playbackMachineMock.context = {
			currentTrack: makeTrack(3),
			queue: [],
			queueIndex: -1
		};

		playbackFacade.play();
		playbackFacade.pause();

		expect(playbackActions.play).toHaveBeenCalled();
		expect(playbackActions.pause).toHaveBeenCalled();
	});

	it('loads next and previous tracks via machine', () => {
		const tracks = [makeTrack(1), makeTrack(2)];
		queueCoordinator.next.mockReturnValue({
			queue: tracks,
			queueIndex: 1,
			currentTrack: tracks[1]
		});

		playbackFacade.next();
		expect(playbackActions.loadTrack).toHaveBeenCalledWith(tracks[1]);

		playbackActions.loadTrack.mockClear();
		queueCoordinator.previous.mockReturnValue({
			queue: tracks,
			queueIndex: 0,
			currentTrack: tracks[0]
		});

		playbackFacade.previous();
		expect(playbackActions.loadTrack).toHaveBeenCalledWith(tracks[0]);
	});

	it('syncs queue index on next/previous', () => {
		const tracks = [makeTrack(21), makeTrack(22), makeTrack(23)];
		queueCoordinator.next.mockReturnValue({
			queue: tracks,
			queueIndex: 1,
			currentTrack: tracks[1]
		});

		playbackFacade.next();
		expect(queueCoordinator.next).toHaveBeenCalled();

		queueCoordinator.previous.mockReturnValue({
			queue: tracks,
			queueIndex: 0,
			currentTrack: tracks[0]
		});
		playbackFacade.previous();
		expect(queueCoordinator.previous).toHaveBeenCalled();
	});

	it('syncs queue mutations', () => {
		const tracks = [makeTrack(31), makeTrack(32)];
		playbackMachineMock.context = { currentTrack: null, queue: [], queueIndex: -1 };

		const extra = makeTrack(33);
		queueCoordinator.enqueue.mockReturnValue({
			queue: [tracks[0], tracks[1], extra],
			queueIndex: 0,
			currentTrack: tracks[0]
		});
		playbackFacade.enqueue(extra);
		expect(queueCoordinator.enqueue).toHaveBeenCalledWith(extra);

		queueCoordinator.enqueueNext.mockReturnValue({
			queue: [tracks[0], makeTrack(34), tracks[1]],
			queueIndex: 0,
			currentTrack: tracks[0]
		});
		playbackFacade.enqueueNext(makeTrack(34));
		expect(queueCoordinator.enqueueNext).toHaveBeenCalled();

		playbackFacade.removeFromQueue(0);
		expect(queueCoordinator.removeFromQueue).toHaveBeenCalledWith(0);

		playbackFacade.clearQueue();
		expect(queueCoordinator.clearQueue).toHaveBeenCalled();

		const shuffledQueue = [makeTrack(41), makeTrack(42), makeTrack(43)];
		queueCoordinator.shuffleQueue.mockReturnValue({
			queue: shuffledQueue,
			queueIndex: 0,
			currentTrack: shuffledQueue[0]
		});
		playbackFacade.shuffleQueue();
		expect(queueCoordinator.shuffleQueue).toHaveBeenCalled();
		expect(playbackActions.loadTrack).toHaveBeenCalledWith(shuffledQueue[0]);
	});
});
