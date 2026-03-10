import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { getSessionStorageKey } from '$lib/core/session';

export interface DownloadLogEntry {
	id: string;
	timestamp: Date;
	message: string;
	level: 'info' | 'success' | 'error' | 'warning';
}

interface DownloadLogState {
	entries: DownloadLogEntry[];
}

const STORAGE_KEY = 'downloadLog';
const LEGACY_STORAGE_KEY = 'tidal-ui.downloadLog';
const MAX_DOWNLOAD_LOG_ENTRIES = 300;

const getScopedStorageKey = (): string => getSessionStorageKey(STORAGE_KEY);

const migrateLegacyLog = (scopedKey: string): string | null => {
	try {
		const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
		if (legacy) {
			localStorage.setItem(scopedKey, legacy);
			localStorage.removeItem(LEGACY_STORAGE_KEY);
			return legacy;
		}
	} catch {
		// Ignore migration failures.
	}
	return null;
};

function readInitialEntries(): DownloadLogEntry[] {
	if (!browser) return [];
	try {
		const scopedKey = getScopedStorageKey();
		let raw = localStorage.getItem(scopedKey);
		if (!raw) {
			raw = migrateLegacyLog(scopedKey);
		}
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed
				.map((entry) => ({
					...entry,
					timestamp: new Date(entry.timestamp)
				}))
				.filter(
					(entry) =>
						entry.id &&
						entry.message &&
						['info', 'success', 'error', 'warning'].includes(entry.level)
				);
		}
	} catch (error) {
		console.warn('Unable to read download log from storage', error);
	}
	return [];
}

export function createDownloadLogStore() {
	const { subscribe, set, update } = writable<DownloadLogState>({
		entries: readInitialEntries()
	});

	function addEntry(message: string, level: 'info' | 'success' | 'error' | 'warning') {
		const entry: DownloadLogEntry = {
			id: `${Date.now()}-${Math.random()}`,
			timestamp: new Date(),
			message,
			level
		};
		update((state) => {
			const newEntries = [...state.entries, entry].slice(-MAX_DOWNLOAD_LOG_ENTRIES);

			// Persist to localStorage
			if (browser) {
				try {
					localStorage.setItem(getScopedStorageKey(), JSON.stringify(newEntries));
				} catch (error) {
					console.warn('Failed to persist download log entries', error);
				}
			}

			return {
				...state,
				entries: newEntries
			};
		});
	}

	return {
		subscribe,
		log: (message: string, level: 'info' | 'success' | 'error' | 'warning' = 'info') => {
			addEntry(message, level);
		},
		success: (message: string) => {
			addEntry(message, 'success');
		},
		error: (message: string) => {
			addEntry(message, 'error');
		},
		warning: (message: string) => {
			addEntry(message, 'warning');
		},
		clear: () => {
			if (browser) {
				try {
					localStorage.removeItem(getScopedStorageKey());
				} catch (error) {
					console.warn('Failed to clear download log from storage', error);
				}
			}
			set({ entries: [] });
		}
	};
}

export const downloadLogStore = createDownloadLogStore();
