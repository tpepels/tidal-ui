import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { AudioQuality } from '../types';
import { type PerformanceLevel } from '../utils/performance';
import { getSessionStorageKey } from '$lib/core/session';
import { debouncedSave, loadFromStorage } from '../utils/persistence';
import { areTestHooksEnabled } from '$lib/utils/testHooks';

export type PerformanceMode = 'medium' | 'low';

export interface UserPreferencesState {
	playbackQuality: AudioQuality;
	convertAacToMp3: boolean;
	downloadCoversSeperately: boolean;
	experimentalMusicBrainzTagging: boolean;
	strictMusicBrainzMatching: boolean;
	performanceMode: PerformanceMode;
}

const STORAGE_KEY = 'user-preferences';
const DEFAULT_STATE: UserPreferencesState = {
	playbackQuality: 'HI_RES_LOSSLESS',
	convertAacToMp3: false,
	downloadCoversSeperately: false,
	experimentalMusicBrainzTagging: false,
	strictMusicBrainzMatching: false,
	performanceMode: 'low'
};

function normalizePerformanceMode(value: unknown): PerformanceMode {
	return value === 'medium' ? 'medium' : 'low';
}

function normalizePlaybackQuality(value: unknown): AudioQuality {
	if (
		value === 'HI_RES_LOSSLESS' ||
		value === 'LOSSLESS' ||
		value === 'HIGH' ||
		value === 'LOW'
	) {
		return value;
	}
	return DEFAULT_STATE.playbackQuality;
}

function normalizePreferences(value: unknown): UserPreferencesState {
	const raw = value as Partial<UserPreferencesState> | null | undefined;
	return {
		playbackQuality: normalizePlaybackQuality(raw?.playbackQuality),
		convertAacToMp3: raw?.convertAacToMp3 === true,
		downloadCoversSeperately: raw?.downloadCoversSeperately === true,
		experimentalMusicBrainzTagging: raw?.experimentalMusicBrainzTagging === true,
		strictMusicBrainzMatching: raw?.strictMusicBrainzMatching === true,
		performanceMode: normalizePerformanceMode(raw?.performanceMode)
	};
}

const readInitialPreferences = (): UserPreferencesState => {
	if (!browser) {
		return DEFAULT_STATE;
	}
	try {
		const stored = loadFromStorage(STORAGE_KEY, null) as unknown;
		if (stored && typeof stored === 'object') {
			return normalizePreferences(stored);
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
				const stored = loadFromStorage(STORAGE_KEY, DEFAULT_STATE) as unknown;
				set(normalizePreferences(stored));
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
		setExperimentalMusicBrainzTagging(value: boolean) {
			update((state) => {
				if (state.experimentalMusicBrainzTagging === value) {
					return state;
				}
				return { ...state, experimentalMusicBrainzTagging: value };
			});
		},
		toggleExperimentalMusicBrainzTagging() {
			update((state) => ({
				...state,
				experimentalMusicBrainzTagging: !state.experimentalMusicBrainzTagging
			}));
		},
		setStrictMusicBrainzMatching(value: boolean) {
			update((state) => {
				if (state.strictMusicBrainzMatching === value) {
					return state;
				}
				return { ...state, strictMusicBrainzMatching: value };
			});
		},
		toggleStrictMusicBrainzMatching() {
			update((state) => ({
				...state,
				strictMusicBrainzMatching: !state.strictMusicBrainzMatching
			}));
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

const isTestHookEnabled = areTestHooksEnabled();
if (browser && isTestHookEnabled) {
	(
		window as typeof window & {
			__tidalSetUserPlaybackQuality?: (quality: AudioQuality) => void;
		}
	).__tidalSetUserPlaybackQuality = (quality: AudioQuality) => {
		userPreferencesStore.setPlaybackQuality(quality);
		// Also dispatch directly to playback machine to avoid async subscription chain timing issues.
		// This mirrors the behavior of __tidalSetPlaybackQuality which goes direct.
		// The subscription chain (userPreferencesStore → playbackMachine) is
		// asynchronous and can cause race conditions, especially in CI environments.
		if (typeof window.__tidalSetPlaybackQuality === 'function') {
			window.__tidalSetPlaybackQuality(quality);
		}
	};
}
