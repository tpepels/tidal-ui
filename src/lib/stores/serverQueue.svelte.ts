/**
 * Server queue store - polls /api/download-queue/stats for real-time queue status
 * Replaces client-side queue polling with server-side state
 */

import { writable, derived } from 'svelte/store';
import { createAdaptivePollingController } from '$lib/utils/adaptivePolling';

export interface ServerQueueStatus {
	queued: number;
	processing: number;
	paused: number;
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
	queueSource?: 'redis' | 'memory';
	lastUpdated: number;
	lastAttemptAt: number;
	nextPollAt: number;
	pollIntervalMs: number;
	pollingError?: string;
	backendError?: string;
	backendWarning?: string;
	error?: string;
	warning?: string;
	localMode?: boolean;
}

const initialState: ServerQueueState = {
	queue: {
		queued: 0,
		processing: 0,
		paused: 0,
		completed: 0,
		failed: 0,
		total: 0
	},
	worker: {
		running: false,
		activeDownloads: 0,
		maxConcurrent: 4
	},
	queueSource: undefined,
	lastUpdated: 0,
	lastAttemptAt: 0,
	nextPollAt: 0,
	pollIntervalMs: 500
};

// Create the store
function createServerQueueStore() {
	const { subscribe, update } = writable<ServerQueueState>(initialState);

	let pollingIntervalMs = 500;
	let pollInFlight = false;
	let adaptivePoller = createAdaptivePollingController({
		run: async () => {
			await poll();
		},
		visibleIntervalMs: pollingIntervalMs,
		hiddenIntervalMs: Math.max(5_000, pollingIntervalMs * 10),
		pauseWhenHidden: false,
		onSchedule: (nextPollAt, intervalMs) => {
			update((state) => ({
				...state,
				nextPollAt,
				pollIntervalMs: intervalMs
			}));
		},
		onPaused: () => {
			update((state) => ({
				...state,
				nextPollAt: 0
			}));
		}
	});

	async function poll() {
		if (pollInFlight) {
			return;
		}
		pollInFlight = true;
		const attemptAt = Date.now();
		update((state) => ({
			...state,
			lastAttemptAt: attemptAt
		}));

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
					lastAttemptAt: attemptAt,
					nextPollAt: Date.now() + pollingIntervalMs,
					pollIntervalMs: pollingIntervalMs,
					pollingError: undefined,
					backendError: undefined,
					backendWarning: data.warning,
					error: undefined,
					warning: data.warning
				}));
			} else {
				update(state => ({
					...state,
					lastAttemptAt: attemptAt,
					nextPollAt: Date.now() + pollingIntervalMs,
					pollIntervalMs: pollingIntervalMs,
					backendError: data.error || 'Queue polling failed',
					pollingError: undefined,
					backendWarning: data.warning,
					error: data.error || 'Queue polling failed',
					warning: data.warning
				}));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			update(state => ({
				...state,
				lastAttemptAt: attemptAt,
				nextPollAt: Date.now() + pollingIntervalMs,
				pollIntervalMs: pollingIntervalMs,
				pollingError: message,
				backendError: undefined,
				backendWarning: undefined,
				error: message,
				warning: undefined
			}));
		} finally {
			pollInFlight = false;
		}
	}

	return {
		subscribe,
		startPolling: (intervalMs: number = 500) => {
			pollingIntervalMs = intervalMs;
			adaptivePoller.stop();
			adaptivePoller = createAdaptivePollingController({
				run: async () => {
					await poll();
				},
				visibleIntervalMs: pollingIntervalMs,
				hiddenIntervalMs: Math.max(5_000, pollingIntervalMs * 10),
				pauseWhenHidden: false,
				onSchedule: (nextPollAt, effectiveIntervalMs) => {
					update((state) => ({
						...state,
						pollIntervalMs: effectiveIntervalMs,
						nextPollAt
					}));
				},
				onPaused: () => {
					update((state) => ({
						...state,
						nextPollAt: 0
					}));
				}
			});
			update((state) => ({
				...state,
				pollIntervalMs: intervalMs,
				nextPollAt: Date.now() + intervalMs
			}));
			adaptivePoller.start();
		},
		stopPolling: () => {
			adaptivePoller.stop();
			update((state) => ({
				...state,
				nextPollAt: 0
			}));
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
