import { browser } from '$app/environment';

export interface PersistedState {
	version: number;
	timestamp: number;
	data: any;
}

const STORAGE_PREFIX = 'tidal-ui:';
const CURRENT_VERSION = 1;

export const saveToStorage = (key: string, data: any) => {
	if (!browser) return;
	try {
		const state: PersistedState = {
			version: CURRENT_VERSION,
			timestamp: Date.now(),
			data
		};
		localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(state));
		console.log(`Saved ${key} state to storage`);
	} catch (e) {
		console.error(`Failed to save ${key} to storage:`, e);
	}
};

export const loadFromStorage = (key: string, defaultValue: any): any => {
	if (!browser) return defaultValue;
	try {
		const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
		if (!stored) return defaultValue;

		const state: PersistedState = JSON.parse(stored);

		// Version check (future migrations)
		if (state.version !== CURRENT_VERSION) {
			console.warn(`Storage version mismatch for ${key}: ${state.version} vs ${CURRENT_VERSION}`);
			return defaultValue; // Reset on version change
		}

		// Basic validation
		if (!state.data || typeof state.data !== 'object') {
			console.warn(`Invalid stored data for ${key}`);
			return defaultValue;
		}

		console.log(`Loaded ${key} state from storage (version ${state.version})`);
		return state.data;
	} catch (e) {
		console.warn(`Failed to load ${key} from storage:`, e);
		return defaultValue;
	}
};

// Debounced save to avoid excessive writes
let saveTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};
export const debouncedSave = (key: string, data: any, delay = 1000) => {
	if (saveTimeouts[key]) clearTimeout(saveTimeouts[key]);
	saveTimeouts[key] = setTimeout(() => saveToStorage(key, data), delay);
};
