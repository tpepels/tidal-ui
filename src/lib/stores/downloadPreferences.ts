import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type DownloadMode = 'individual' | 'zip' | 'csv';
export type DownloadStorage = 'client' | 'server';

interface DownloadPreferencesState {
	mode: DownloadMode;
	storage: DownloadStorage;
}

const createDownloadPreferencesStore = () => {
	const STORAGE_KEY_MODE = 'tidal-ui.downloadMode';
	const STORAGE_KEY_STORAGE = 'tidal-ui.downloadStorage';

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
			return 'client';
		}

		const stored = localStorage.getItem(STORAGE_KEY_STORAGE);
		if (stored === 'client' || stored === 'server') {
			return stored;
		}
		return 'client';
	};

	const { subscribe, set, update } = writable<DownloadPreferencesState>({
		mode: readInitialMode(),
		storage: readInitialStorage()
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
		}
	};
};

export const downloadPreferencesStore = createDownloadPreferencesStore();
