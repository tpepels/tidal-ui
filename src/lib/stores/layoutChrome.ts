import { writable } from 'svelte/store';

export type FloatingUtilitySlot = 'none' | 'download-summary' | 'download-panel' | 'download-toggle';

type LayoutChromeState = {
	floatingUtilitySlot: FloatingUtilitySlot;
};

const initialState: LayoutChromeState = {
	floatingUtilitySlot: 'none'
};

function createLayoutChromeStore() {
	const { subscribe, update, set } = writable<LayoutChromeState>(initialState);

	return {
		subscribe,
		reset: () => set(initialState),
		setFloatingUtilitySlot: (floatingUtilitySlot: FloatingUtilitySlot) =>
			update((state) => ({ ...state, floatingUtilitySlot }))
	};
}

export const layoutChrome = createLayoutChromeStore();
