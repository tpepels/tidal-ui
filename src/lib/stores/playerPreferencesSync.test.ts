import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const buildLegacyPreferences = (quality: string) =>
	JSON.stringify({
		playbackQuality: quality,
		convertAacToMp3: false,
		downloadCoversSeperately: false,
		performanceMode: 'low'
	});

describe('player store quality sync', () => {
	beforeEach(() => {
		const storage = new Map<string, string>();
		const localStorageMock = {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => {
				storage.set(key, value);
			},
			removeItem: (key: string) => {
				storage.delete(key);
			},
			clear: () => {
				storage.clear();
			}
		};
		Object.defineProperty(globalThis, 'localStorage', {
			value: localStorageMock,
			writable: true
		});
		vi.resetModules();
		vi.doMock('$app/environment', () => ({
			dev: false,
			browser: true,
			building: false,
			version: '3.3'
		}));
	});

	it('initializes player quality from persisted user preferences', async () => {
		localStorage.setItem('tidal-ui.userPreferences', buildLegacyPreferences('HIGH'));
		const { userPreferencesStore } = await import('./userPreferences');
		const { playerStore } = await import('./player');

		expect(get(userPreferencesStore).playbackQuality).toBe('HIGH');
		expect(get(playerStore).quality).toBe('HIGH');
	});

	it('updates player quality when user preferences change', async () => {
		localStorage.setItem('tidal-ui.userPreferences', buildLegacyPreferences('LOSSLESS'));
		const { userPreferencesStore } = await import('./userPreferences');
		const { playerStore } = await import('./player');

		userPreferencesStore.setPlaybackQuality('LOW');
		expect(get(playerStore).quality).toBe('LOW');
	});
});
