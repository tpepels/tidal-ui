import { browser } from '$app/environment';

export interface PersistedState {
	version: number;
	timestamp: number;
	data: unknown;
}

const STORAGE_PREFIX = 'tidal-ui:';
const CURRENT_VERSION = 1;

export const saveToStorage = (key: string, data: unknown) => {
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

export const loadFromStorage = (key: string, defaultValue: unknown): unknown => {
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

		// Validate timestamp (not too old or future)
		const now = Date.now();
		const age = now - state.timestamp;
		if (age < 0 || age > 30 * 24 * 60 * 60 * 1000) {
			// 30 days
			console.warn(`Stored data for ${key} has invalid timestamp`);
			return defaultValue;
		}

		// Basic validation
		if (!state.data || typeof state.data !== 'object') {
			console.warn(`Invalid stored data for ${key}`);
			return defaultValue;
		}

		return state.data;
	} catch (e) {
		console.warn(`Failed to load ${key} from storage:`, e);
		return defaultValue;
	}
};

// Debounced save to avoid excessive writes
const saveTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};
export const debouncedSave = (key: string, data: unknown, delay = 1000) => {
	if (saveTimeouts[key]) clearTimeout(saveTimeouts[key]);
	saveTimeouts[key] = setTimeout(() => saveToStorage(key, data), delay);
};
