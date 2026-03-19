/**
 * Server queue store - polls the queue dashboard projection for real-time queue status
 */

import { writable, derived } from 'svelte/store';
import {
	queueClient,
	type QueueDashboardPayload,
	type QueueJobRecord,
	type QueueMetrics,
	type QueueStats,
	type QueueWorkerStatus
} from '$lib/clients/queueClient';
import { createAdaptivePollingController } from '$lib/utils/adaptivePolling';

export interface ServerQueueState {
	jobs: QueueJobRecord[];
	queue: QueueStats;
	metrics: QueueMetrics;
	worker: QueueWorkerStatus;
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
	jobs: [],
	queue: {
		queued: 0,
		processing: 0,
		paused: 0,
		completed: 0,
		failed: 0,
		total: 0
	},
	metrics: {
		total_jobs: 0,
		queued: 0,
		processing: 0,
		paused: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
		avg_success_rate: 0,
		avg_retry_count: 0,
		total_download_time_ms: 0,
		avg_job_duration_ms: 0,
		failure_by_code: {}
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
			const data = await queueClient.getDashboard();

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
				update((state) => ({
					...state,
					lastAttemptAt: attemptAt,
					nextPollAt: Date.now() + pollingIntervalMs,
					pollIntervalMs: pollingIntervalMs,
					backendError: (data as QueueDashboardPayload).error || 'Queue polling failed',
					pollingError: undefined,
					backendWarning: (data as QueueDashboardPayload).warning,
					error: (data as QueueDashboardPayload).error || 'Queue polling failed',
					warning: (data as QueueDashboardPayload).warning
				}));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			update((state) => ({
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
export const queueStats = derived(serverQueue, ($sq) => $sq.queue);
export const workerStatus = derived(serverQueue, ($sq) => $sq.worker);
export const hasActiveDownloads = derived(
	queueStats,
	($stats) => $stats.processing > 0 || $stats.queued > 0
);
export const hasFailed = derived(queueStats, ($stats) => $stats.failed > 0);
export const totalDownloads = derived(
	queueStats,
	($stats) => $stats.processing + $stats.queued
);
