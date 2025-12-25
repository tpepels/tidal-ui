import { writable } from 'svelte/store';

export interface DownloadQueueItem {
	id: string;
	trackId: number;
	trackTitle: string;
	albumTitle: string;
	artistName: string;
	quality: string;
	status: 'pending' | 'downloading' | 'complete' | 'failed';
	progress: number; // 0-100
	error?: string;
}

export interface DownloadQueue {
	items: DownloadQueueItem[];
	isProcessing: boolean;
	maxConcurrent: number;
}

function createDownloadQueue() {
	const initialState: DownloadQueue = {
		items: [],
		isProcessing: false,
		maxConcurrent: 3 // Allow up to 3 parallel downloads
	};

	const { subscribe, set, update } = writable(initialState);

	return {
		subscribe,
		addItem: (item: Omit<DownloadQueueItem, 'id' | 'status' | 'progress'>) => {
			update((queue) => {
				const newItem: DownloadQueueItem = {
					...item,
					id: `${item.trackId}-${Date.now()}`,
					status: 'pending',
					progress: 0
				};
				return {
					...queue,
					items: [...queue.items, newItem]
				};
			});
		},
		updateItem: (id: string, changes: Partial<DownloadQueueItem>) => {
			update((queue) => ({
				...queue,
				items: queue.items.map((item) => (item.id === id ? { ...item, ...changes } : item))
			}));
		},
		removeItem: (id: string) => {
			update((queue) => ({
				...queue,
				items: queue.items.filter((item) => item.id !== id)
			}));
		},
		setProcessing: (isProcessing: boolean) => {
			update((queue) => ({ ...queue, isProcessing }));
		},
		clearCompleted: () => {
			update((queue) => ({
				...queue,
				items: queue.items.filter((item) => item.status !== 'complete')
			}));
		},
		reset: () => {
			set(initialState);
		}
	};
}

export const downloadQueue = createDownloadQueue();
