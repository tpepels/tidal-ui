/**
 * Server queue store - polls /api/download-queue/stats for real-time queue status
 * Replaces client-side queue polling with server-side state
 */

import { writable, derived } from 'svelte/store';

export interface ServerQueueStatus {
	queued: number;
	processing: number;
	completed: number;
	failed: number;
	total: number;
}

export interface WorkerStatus {
	running: boolean;
	activeDownloads: number;
	maxConcurrent: number;
}

export interface ServerQueueState {
	queue: ServerQueueStatus;
	worker: WorkerStatus;
	lastUpdated: number;
	error?: string;
}

const initialState: ServerQueueState = {
	queue: {
		queued: 0,
		processing: 0,
		completed: 0,
		failed: 0,
		total: 0
	},
	worker: {
		running: false,
		activeDownloads: 0,
		maxConcurrent: 4
	},
	lastUpdated: 0
};

// Create the store
function createServerQueueStore() {
	const { subscribe, update } = writable<ServerQueueState>(initialState);

	// Polling interval
	let pollInterval: NodeJS.Timeout | null = null;

	async function poll() {
		try {
			const response = await fetch('/api/download-queue/stats');
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const data = await response.json();

			if (data.success) {
				update(() => ({
					...data,
					lastUpdated: Date.now(),
					error: undefined
				}));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			update(state => ({
				...state,
				error: message,
				lastUpdated: Date.now()
			}));
		}
	}

	return {
		subscribe,
		startPolling: (intervalMs: number = 500) => {
			if (pollInterval) clearInterval(pollInterval);
			poll(); // Initial fetch
			pollInterval = setInterval(poll, intervalMs);
		},
		stopPolling: () => {
			if (pollInterval) {
				clearInterval(pollInterval);
				pollInterval = null;
			}
		},
		poll
	};
}

export const serverQueue = createServerQueueStore();

// Derived stores for easier access
export const queueStats = derived(serverQueue, $sq => $sq.queue);
export const workerStatus = derived(serverQueue, $sq => $sq.worker);
export const hasActiveDownloads = derived(
	queueStats,
	$stats => $stats.processing > 0 || $stats.queued > 0
);
export const hasFailed = derived(queueStats, $stats => $stats.failed > 0);
export const totalDownloads = derived(
	queueStats,
	$stats => $stats.processing + $stats.queued
);
