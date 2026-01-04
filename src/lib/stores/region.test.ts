import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const STORAGE_KEY = 'tidal-ui.region';

const loadRegionStore = async () => {
	vi.resetModules();
	vi.unmock('$lib/stores/region');
	return await vi.importActual<typeof import('./region')>('./region');
};

const setSearch = (search: string) => {
	const url = new URL(window.location.href);
	url.search = search;
	window.history.replaceState({}, '', url);
};

afterEach(() => {
	localStorage.clear();
	setSearch('');
	vi.unstubAllEnvs();
});

describe('regionStore', () => {
	it('prefers the test query param when enabled', async () => {
		vi.stubEnv('VITE_E2E', 'true');
		setSearch('?testRegion=eu');
		localStorage.setItem(STORAGE_KEY, 'us');

		const { regionStore } = await loadRegionStore();
		expect(get(regionStore)).toBe('eu');
		expect(localStorage.getItem(STORAGE_KEY)).toBe('eu');
	});

	it('persists updates and reacts to storage events', async () => {
		vi.stubEnv('VITE_E2E', 'true');
		const { regionStore } = await loadRegionStore();

		regionStore.setRegion('us');
		expect(localStorage.getItem(STORAGE_KEY)).toBe('us');

		window.dispatchEvent(
			new StorageEvent('storage', { key: STORAGE_KEY, newValue: 'eu' })
		);
		expect(get(regionStore)).toBe('eu');
	});

	it('exposes a test hook for direct updates', async () => {
		vi.stubEnv('VITE_E2E', 'true');
		const { regionStore } = await loadRegionStore();
		const hook = (window as typeof window & { __tidalSetRegion?: (value: string) => void })
			.__tidalSetRegion;
		expect(typeof hook).toBe('function');

		hook?.('us');
		expect(get(regionStore)).toBe('us');
	});
});
