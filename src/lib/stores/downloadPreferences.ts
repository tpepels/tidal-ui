import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { AudioQuality } from '../types';

export type DownloadMode = 'individual' | 'zip' | 'csv';
export type DownloadStorage = 'client' | 'server';

interface DownloadPreferencesState {
	mode: DownloadMode;
	storage: DownloadStorage;
	downloadQuality: AudioQuality;
}

const createDownloadPreferencesStore = () => {
	const STORAGE_KEY_MODE = 'tidal-ui.downloadMode';
	const STORAGE_KEY_STORAGE = 'tidal-ui.downloadStorage';
	const STORAGE_KEY_QUALITY = 'tidal-ui.downloadQuality';

	const readInitialMode = (): DownloadMode => {
		if (!browser) {
			return 'individual';
		}

		const stored = localStorage.getItem(STORAGE_KEY_MODE);
		if (stored === 'individual' || stored === 'zip' || stored === 'csv') {
			return stored;
		}
		return 'individual';
	};

	const readInitialStorage = (): DownloadStorage => {
		if (!browser) {
			return 'server';
		}

		const stored = localStorage.getItem(STORAGE_KEY_STORAGE);
		if (stored === 'client' || stored === 'server') {
			return stored;
		}
		return 'server';
	};

	const readInitialQuality = (): AudioQuality => {
		if (!browser) {
			return 'HI_RES_LOSSLESS';
		}

		const stored = localStorage.getItem(STORAGE_KEY_QUALITY);
		if (
			stored === 'HI_RES_LOSSLESS' ||
			stored === 'LOSSLESS' ||
			stored === 'HIGH' ||
			stored === 'LOW'
		) {
			return stored;
		}
		return 'HI_RES_LOSSLESS';
	};

	const { subscribe, update } = writable<DownloadPreferencesState>({
		mode: readInitialMode(),
		storage: readInitialStorage(),
		downloadQuality: readInitialQuality()
	});

	if (browser) {
		window.addEventListener('storage', (event) => {
			if (event.key === STORAGE_KEY_MODE) {
				const value = event.newValue;
				if (value === 'individual' || value === 'zip' || value === 'csv') {
					update((state) => ({ ...state, mode: value }));
				}
			} else if (event.key === STORAGE_KEY_STORAGE) {
				const value = event.newValue;
				if (value === 'client' || value === 'server') {
					update((state) => ({ ...state, storage: value }));
				}
			} else if (event.key === STORAGE_KEY_QUALITY) {
				const value = event.newValue;
				if (
					value === 'HI_RES_LOSSLESS' ||
					value === 'LOSSLESS' ||
					value === 'HIGH' ||
					value === 'LOW'
				) {
					update((state) => ({ ...state, downloadQuality: value }));
				}
			}
		});
	}

	return {
		subscribe,
		setMode(mode: DownloadMode) {
			update((state) => {
				if (browser) {
					try {
						localStorage.setItem(STORAGE_KEY_MODE, mode);
					} catch (error) {
						console.warn('Failed to persist download mode preference', error);
					}
				}
				return { ...state, mode };
			});
		},
		setStorage(storage: DownloadStorage) {
			update((state) => {
				if (browser) {
					try {
						localStorage.setItem(STORAGE_KEY_STORAGE, storage);
					} catch (error) {
						console.warn('Failed to persist download storage preference', error);
					}
				}
				return { ...state, storage };
			});
		},
		setDownloadQuality(quality: AudioQuality) {
			update((state) => {
				if (browser) {
					try {
						localStorage.setItem(STORAGE_KEY_QUALITY, quality);
					} catch (error) {
						console.warn('Failed to persist download quality preference', error);
					}
				}
				return { ...state, downloadQuality: quality };
			});
		}
	};
};

export const downloadPreferencesStore = createDownloadPreferencesStore();
