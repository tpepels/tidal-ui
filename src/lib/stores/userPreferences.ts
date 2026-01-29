import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { AudioQuality } from '../types';
import { type PerformanceLevel } from '../utils/performance';
import { getSessionStorageKey } from '$lib/core/session';
import { debouncedSave, loadFromStorage } from '../utils/persistence';

export type PerformanceMode = 'medium' | 'low';

export interface UserPreferencesState {
	playbackQuality: AudioQuality;
	convertAacToMp3: boolean;
	downloadCoversSeperately: boolean;
	performanceMode: PerformanceMode;
}

const STORAGE_KEY = 'user-preferences';
const DEFAULT_STATE: UserPreferencesState = {
	playbackQuality: 'HI_RES_LOSSLESS',
	convertAacToMp3: false,
	downloadCoversSeperately: false,
	performanceMode: 'low'
};

const readInitialPreferences = (): UserPreferencesState => {
	if (!browser) {
		return DEFAULT_STATE;
	}
	try {
		const stored = loadFromStorage(STORAGE_KEY, null) as UserPreferencesState | null;
		if (stored && typeof stored === 'object') {
			return stored;
		}

		return DEFAULT_STATE;
	} catch (error) {
		console.warn('Unable to read user preferences from storage', error);
		return DEFAULT_STATE;
	}
};

const createUserPreferencesStore = () => {
	const { subscribe, set, update } = writable<UserPreferencesState>(readInitialPreferences());

	if (browser) {
		subscribe((state) => {
			try {
				debouncedSave(STORAGE_KEY, state);
			} catch (error) {
				console.warn('Failed to persist user preferences', error);
			}
		});

		const scopedKey = getSessionStorageKey(STORAGE_KEY);
		const legacyKey = `tidal-ui:${STORAGE_KEY}`;
		window.addEventListener('storage', (event) => {
			if (event.key === scopedKey || event.key === legacyKey) {
				const stored = loadFromStorage(STORAGE_KEY, DEFAULT_STATE) as UserPreferencesState;
				set(stored);
				return;
			}
		});
	}

	return {
		subscribe,
		setPlaybackQuality(quality: AudioQuality) {
			update((state) => {
				if (state.playbackQuality === quality) {
					return state;
				}
				return { ...state, playbackQuality: quality };
			});
		},
		setConvertAacToMp3(value: boolean) {
			update((state) => {
				if (state.convertAacToMp3 === value) {
					return state;
				}
				return { ...state, convertAacToMp3: value };
			});
		},
		toggleConvertAacToMp3() {
			update((state) => ({ ...state, convertAacToMp3: !state.convertAacToMp3 }));
		},
		setDownloadCoversSeperately(value: boolean) {
			update((state) => {
				if (state.downloadCoversSeperately === value) {
					return state;
				}
				return { ...state, downloadCoversSeperately: value };
			});
		},
		toggleDownloadCoversSeperately() {
			update((state) => ({ ...state, downloadCoversSeperately: !state.downloadCoversSeperately }));
		},
		setPerformanceMode(mode: PerformanceMode) {
			update((state) => {
				if (state.performanceMode === mode) {
					return state;
				}
				return { ...state, performanceMode: mode };
			});
		},
		getEffectivePerformanceLevel(): PerformanceLevel {
			// Read current store state instead of localStorage
			let currentState: UserPreferencesState | undefined;
			const unsubscribe = subscribe((state) => {
				currentState = state;
			});
			unsubscribe(); // Immediately unsubscribe after getting current state
			return (currentState?.performanceMode ?? DEFAULT_STATE.performanceMode) as PerformanceLevel;
		},
		reset() {
			set(DEFAULT_STATE);
		}
	};
};

export const userPreferencesStore = createUserPreferencesStore();
