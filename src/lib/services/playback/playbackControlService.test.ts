import { beforeEach, describe, expect, it, vi } from 'vitest';

const createPlayerStoreMock = () => {
	const state = { duration: 120, currentTime: 0, queueIndex: 1 };
	const subscribers = new Set<(value: typeof state) => void>();
	const notify = () => subscribers.forEach((callback) => callback({ ...state }));

	return {
		state,
		playerStore: {
			subscribe: (run: (value: typeof state) => void) => {
				run({ ...state });
				subscribers.add(run);
				return () => subscribers.delete(run);
			},
			setCurrentTime: vi.fn((value: number) => {
				state.currentTime = value;
				notify();
			}),
			previous: vi.fn(),
			setVolume: vi.fn()
		}
	};
};

const setup = async () => {
	vi.resetModules();
	const store = createPlayerStoreMock();
	vi.doMock('$lib/stores/player', () => ({
		playerStore: store.playerStore
	}));

	const module = await vi.importActual<
		typeof import('./playbackControlService')
	>('./playbackControlService');
	return { module, store };
};

describe('playbackControlService', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('seeks within duration and updates the store', async () => {
		const { module, store } = await setup();
		const audio = { currentTime: 0 } as HTMLAudioElement;
		module.seekToPosition(audio, 140);
		expect(audio.currentTime).toBe(120);
		expect(store.playerStore.setCurrentTime).toHaveBeenCalledWith(120);
	});

	it('handles previous track behavior based on time and queue index', async () => {
		const { module, store } = await setup();
		const audio = { currentTime: 0 } as HTMLAudioElement;
		store.state.currentTime = 10;
		module.handlePreviousTrack(audio);
		expect(store.playerStore.setCurrentTime).toHaveBeenCalledWith(0);

		store.playerStore.setCurrentTime.mockClear();
		store.state.currentTime = 2;
		store.state.queueIndex = 2;
		module.handlePreviousTrack(audio);
		expect(store.playerStore.previous).toHaveBeenCalledTimes(1);
	});

	it('clamps volume updates', async () => {
		const { module, store } = await setup();
		module.setVolume(2);
		expect(store.playerStore.setVolume).toHaveBeenCalledWith(1);
		module.setVolume(-1);
		expect(store.playerStore.setVolume).toHaveBeenCalledWith(0);
	});

	it('retries play after a pause when initial play fails', async () => {
		const { module } = await setup();
		const play = vi
			.fn()
			.mockRejectedValueOnce(new Error('first fail'))
			.mockResolvedValueOnce(undefined);
		const pause = vi.fn();
		const audio = { play, pause } as unknown as HTMLAudioElement;

		await module.requestAudioPlayback(audio);
		expect(play).toHaveBeenCalledTimes(2);
		expect(pause).toHaveBeenCalledTimes(1);
	});
});
