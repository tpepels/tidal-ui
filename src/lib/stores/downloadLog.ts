import { writable } from 'svelte/store';

export interface DownloadLogEntry {
	id: string;
	timestamp: Date;
	message: string;
	level: 'info' | 'success' | 'error' | 'warning';
}

interface DownloadLogState {
	entries: DownloadLogEntry[];
	isVisible: boolean;
}

export function createDownloadLogStore() {
	const { subscribe, set, update } = writable<DownloadLogState>({
		entries: [],
		isVisible: false
	});

	function addEntry(message: string, level: 'info' | 'success' | 'error' | 'warning') {
		const entry: DownloadLogEntry = {
			id: `${Date.now()}-${Math.random()}`,
			timestamp: new Date(),
			message,
			level
		};
		update((state) => ({
			...state,
			entries: [...state.entries, entry].slice(-100) // Keep only last 100 entries
		}));
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
		show: () => {
			console.log('[DownloadLogStore] Showing log panel');
			update((state) => ({ ...state, isVisible: true }));
		},
		hide: () => {
			console.log('[DownloadLogStore] Hiding log panel');
			update((state) => ({ ...state, isVisible: false }));
		},
		toggle: () => {
			update((state) => {
				const newState = { ...state, isVisible: !state.isVisible };
				console.log('[DownloadLogStore] Toggled visibility to:', newState.isVisible);
				return newState;
			});
		},
		clear: () => {
			set({ entries: [], isVisible: false });
		}
	};
}

export const downloadLogStore = createDownloadLogStore();
