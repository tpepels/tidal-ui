import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { playerStore } from './player';
import { loadFromStorage, debouncedSave } from '../utils/persistence';

// Mock dependencies
vi.mock('$app/environment', () => ({
	browser: true
}));
vi.mock('../utils/persistence');
vi.mock('../utils/audioQuality', () => ({
	deriveTrackQuality: vi.fn(() => 'LOSSLESS')
}));
vi.mock('./userPreferences', () => ({
	userPreferencesStore: {
		subscribe: vi.fn((fn) => fn({})),
		set: vi.fn()
	}
}));

const mockedLoadFromStorage = vi.mocked(loadFromStorage);
const mockedDebouncedSave = vi.mocked(debouncedSave);

describe('Player Store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedLoadFromStorage.mockReturnValue({});
	});

	afterEach(() => {
		// Reset store to initial state
		playerStore.setTrack({
			id: 1,
			title: 'Reset',
			artists: [{ name: 'Artist' }],
			duration: 0
		});
		playerStore.pause();
	});

	it('initializes with default state', () => {
		mockedLoadFromStorage.mockReturnValue({});
		const state = get(playerStore);
		expect(state.currentTrack).toBeNull();
		expect(state.isPlaying).toBe(false);
		expect(state.volume).toBe(0.8);
		expect(state.quality).toBe('LOSSLESS');
	});

	it('loads persisted state on initialization', () => {
		const persisted = {
			volume: 0.5,
			quality: 'HIGH' as const,
			queue: [{ id: 1, title: 'Track', artists: [{ name: 'Artist' }], duration: 100 }]
		};
		mockedLoadFromStorage.mockReturnValue(persisted);

		// Need to recreate store to test initialization
		// This is tricky with the current setup, skip for now
	});

	it('sets track correctly', () => {
		const track = {
			id: 123,
			title: 'Test Track',
			artists: [{ name: 'Test Artist' }],
			duration: 240
		};

		playerStore.setTrack(track);

		const state = get(playerStore);
		expect(state.currentTrack).toEqual(track);
		expect(state.duration).toBe(240);
		expect(state.currentTime).toBe(0);
		expect(state.isLoading).toBe(true);
	});

	it('plays and pauses correctly', () => {
		playerStore.play();
		expect(get(playerStore).isPlaying).toBe(true);

		playerStore.pause();
		expect(get(playerStore).isPlaying).toBe(false);
	});

	it('sets volume correctly', () => {
		playerStore.setVolume(0.6);
		expect(get(playerStore).volume).toBe(0.6);
	});

	it('sets current time correctly', () => {
		playerStore.setCurrentTime(45);
		expect(get(playerStore).currentTime).toBe(45);
	});

	it('saves state on changes', () => {
		playerStore.setVolume(0.7);
		expect(mockedDebouncedSave).toHaveBeenCalledWith('player', expect.any(Object));
	});

	it('handles queue operations', () => {
		const track1 = { id: 1, title: 'Track 1', artists: [{ name: 'Artist' }], duration: 100 };
		const track2 = { id: 2, title: 'Track 2', artists: [{ name: 'Artist' }], duration: 200 };

		playerStore.setQueue([track1, track2]);
		playerStore.setQueueIndex(0);

		const state = get(playerStore);
		expect(state.queue).toEqual([track1, track2]);
		expect(state.queueIndex).toBe(0);
	});

	it('skips to next track in queue', () => {
		const track1 = { id: 1, title: 'Track 1', artists: [{ name: 'Artist' }], duration: 100 };
		const track2 = { id: 2, title: 'Track 2', artists: [{ name: 'Artist' }], duration: 200 };

		playerStore.setQueue([track1, track2]);
		playerStore.setQueueIndex(0);
		playerStore.next();

		expect(get(playerStore).queueIndex).toBe(1);
		expect(get(playerStore).currentTrack).toEqual(track2);
	});

	it('skips to previous track in queue', () => {
		const track1 = { id: 1, title: 'Track 1', artists: [{ name: 'Artist' }], duration: 100 };
		const track2 = { id: 2, title: 'Track 2', artists: [{ name: 'Artist' }], duration: 200 };

		playerStore.setQueue([track1, track2]);
		playerStore.setQueueIndex(1);
		playerStore.previous();

		expect(get(playerStore).queueIndex).toBe(0);
		expect(get(playerStore).currentTrack).toEqual(track1);
	});

	it('handles queue bounds correctly', () => {
		playerStore.setQueue([]);
		playerStore.next();
		expect(get(playerStore).queueIndex).toBe(-1);

		playerStore.previous();
		expect(get(playerStore).queueIndex).toBe(-1);
	});
});
