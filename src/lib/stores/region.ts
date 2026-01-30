import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import { areTestHooksEnabled } from '$lib/utils/testHooks';

export type RegionOption = 'auto' | 'us' | 'eu';

const STORAGE_KEY = 'tidal-ui.region';
const TEST_QUERY_KEY = 'testRegion';

const isRegionOption = (value: string | null): value is RegionOption =>
	value === 'us' || value === 'eu' || value === 'auto';

const isTestHookEnabled = areTestHooksEnabled();

const readTestRegion = (): RegionOption | null => {
	if (!browser || !isTestHookEnabled) {
		return null;
	}

	const params = new URLSearchParams(window.location.search);
	const value = params.get(TEST_QUERY_KEY);
	return isRegionOption(value) ? value : null;
};

const readInitialRegion = (): RegionOption => {
	if (!browser) {
		return 'auto';
	}

	const testRegion = readTestRegion();
	if (testRegion) {
		return testRegion;
	}

	const stored = localStorage.getItem(STORAGE_KEY);
	if (isRegionOption(stored)) {
		return stored;
	}

	return 'auto';
};

const createRegionStore = () => {
	const { subscribe, set, update } = writable<RegionOption>(readInitialRegion());

	if (browser) {
		subscribe((value) => {
			try {
				localStorage.setItem(STORAGE_KEY, value);
			} catch (error) {
				console.warn('Failed to persist region preference', error);
			}
		});

		window.addEventListener('storage', (event) => {
			if (event.key !== STORAGE_KEY) return;
			const value = event.newValue;
			if (isRegionOption(value)) {
				set(value);
			}
		});
	}

	const store = {
		subscribe,
		setRegion(value: RegionOption) {
			update(() => value);
		}
	};

	if (browser && isTestHookEnabled) {
		(window as typeof window & { __tidalSetRegion?: (value: RegionOption) => void }).__tidalSetRegion =
			(value: RegionOption) => {
				if (isRegionOption(value)) {
					store.setRegion(value);
				}
			};
	}

	return store;
};

export const regionStore = createRegionStore();
