import { get, writable } from 'svelte/store';
import type { PlayableTrack } from '../types';
import type { DownloadStorage } from './downloadPreferences';
import { isSonglinkTrack } from '../types';
import { formatArtists } from '../utils/formatters';
import { validateInvariant } from '../core/invariants';

export type FfmpegPhase = 'idle' | 'countdown' | 'loading' | 'ready' | 'error';

export interface FfmpegBannerState {
	phase: FfmpegPhase;
	countdownSeconds: number;
	countdownActive: boolean;
	totalBytes?: number;
	progress: number;
	dismissible: boolean;
	autoTriggered: boolean;
	error?: string;
	startedAt?: number;
	updatedAt?: number;
}

export type TrackDownloadStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
export type TrackDownloadPhase = 'downloading' | 'uploading' | 'embedding' | 'finalizing';

export interface TrackDownloadTask {
	id: string;
	trackId: number | string;
	title: string;
	subtitle?: string;
	filename: string;
	status: TrackDownloadStatus;
	phase?: TrackDownloadPhase;
	storage?: DownloadStorage;
	receivedBytes: number;
	totalBytes?: number;
	progress: number;
	error?: string;
	startedAt: number;
	updatedAt: number;
	cancellable: boolean;
	controller?: AbortController;
}

interface DownloadUiState {
	ffmpeg: FfmpegBannerState;
	tasks: TrackDownloadTask[];
}

const MAX_VISIBLE_TASKS = 8;
const COUNTDOWN_DEFAULT_SECONDS = 5;
const ACTIVE_TASK_STATUSES = new Set<TrackDownloadStatus>(['pending', 'running']);
const isTestHookEnabled = import.meta.env.DEV || import.meta.env.VITE_E2E === 'true';

const initialState: DownloadUiState = {
	ffmpeg: {
		phase: 'idle',
		countdownSeconds: COUNTDOWN_DEFAULT_SECONDS,
		countdownActive: false,
		totalBytes: undefined,
		progress: 0,
		dismissible: true,
		autoTriggered: true,
		startedAt: undefined,
		updatedAt: undefined
	},
	tasks: []
};

const store = writable<DownloadUiState>(initialState);

let countdownInterval: ReturnType<typeof setInterval> | null = null;

const enforceDownloadInvariants = (state: DownloadUiState): DownloadUiState => {
	validateInvariant(
		state.ffmpeg.phase !== 'countdown' || state.ffmpeg.countdownActive,
		'FFmpeg countdown phase should be active when phase is countdown',
		{ phase: state.ffmpeg.phase, countdownActive: state.ffmpeg.countdownActive }
	);
	validateInvariant(
		!state.ffmpeg.countdownActive || state.ffmpeg.phase === 'countdown',
		'FFmpeg countdown active while phase is not countdown',
		{ phase: state.ffmpeg.phase, countdownActive: state.ffmpeg.countdownActive }
	);
	validateInvariant(
		state.ffmpeg.countdownSeconds >= 0,
		'FFmpeg countdown seconds should not be negative',
		{ countdownSeconds: state.ffmpeg.countdownSeconds }
	);

	const taskIds = new Set<string>();
	for (const task of state.tasks) {
		if (taskIds.has(task.id)) {
			validateInvariant(false, 'Duplicate download task id detected', { taskId: task.id });
		}
		taskIds.add(task.id);
		validateInvariant(
			task.progress >= 0 && task.progress <= 1,
			'Download task progress must be within 0..1',
			{ taskId: task.id, progress: task.progress }
		);
		if (typeof task.totalBytes === 'number') {
			validateInvariant(
				task.receivedBytes <= task.totalBytes,
				'Download task received bytes exceed total bytes',
				{ taskId: task.id, receivedBytes: task.receivedBytes, totalBytes: task.totalBytes }
			);
		}
	}

	return state;
};

const updateStore = (updater: (state: DownloadUiState) => DownloadUiState): void => {
	store.update((state) => enforceDownloadInvariants(updater(state)));
};

const setStore = (state: DownloadUiState): void => {
	store.set(enforceDownloadInvariants(state));
};

function nextTaskId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function clampProgress(value: number | null | undefined): number {
	if (!Number.isFinite(value ?? NaN)) return 0;
	return Math.max(0, Math.min(1, Number(value)));
}

function stopCountdownTicker() {
	if (countdownInterval) {
		clearInterval(countdownInterval);
		countdownInterval = null;
	}
}

function updateCountdownTicker() {
	stopCountdownTicker();
	countdownInterval = setInterval(() => {
		updateStore((state) => {
			if (state.ffmpeg.phase !== 'countdown') {
				stopCountdownTicker();
				return state;
			}

			const nextSeconds = Math.max(0, state.ffmpeg.countdownSeconds - 1);
			const nextPhase: FfmpegPhase = nextSeconds === 0 ? 'loading' : 'countdown';
			return {
				...state,
				ffmpeg: {
					...state.ffmpeg,
					phase: nextPhase,
					countdownSeconds: nextSeconds,
					countdownActive: nextPhase === 'countdown',
					progress: 0,
					updatedAt: Date.now(),
					dismissible: nextPhase !== 'loading'
				}
			};
		});
	}, 1000);
}

function upsertTask(task: TrackDownloadTask): void {
	updateStore((state) => {
		const existingIndex = state.tasks.findIndex((entry) => entry.id === task.id);
		const tasks = state.tasks.slice();
		if (existingIndex >= 0) {
			tasks[existingIndex] = { ...tasks[existingIndex]!, ...task, updatedAt: Date.now() };
		} else {
			tasks.unshift({ ...task, updatedAt: Date.now() });
		}
		return {
			...state,
			tasks: pruneTasks(tasks)
		};
	});
}

function pruneTasks(tasks: TrackDownloadTask[]): TrackDownloadTask[] {
	const inactiveTasks = tasks.filter((task) => !ACTIVE_TASK_STATUSES.has(task.status));
	if (inactiveTasks.length <= MAX_VISIBLE_TASKS) {
		return tasks;
	}

	const allowedInactiveIds = new Set(
		inactiveTasks
			.slice()
			.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
			.slice(0, MAX_VISIBLE_TASKS)
			.map((task) => task.id)
	);

	return tasks.filter(
		(task) => ACTIVE_TASK_STATUSES.has(task.status) || allowedInactiveIds.has(task.id)
	);
}

function mutateTask(id: string, updater: (task: TrackDownloadTask) => TrackDownloadTask): void {
	updateStore((state) => {
		const index = state.tasks.findIndex((entry) => entry.id === id);
		if (index === -1) {
			// INVARIANT VIOLATION: Task must exist to be mutated
			console.error(`[DownloadUi] INVARIANT VIOLATION: Cannot mutate task ${id} - task not found in store`);
			console.error(`[DownloadUi] Current tasks:`, state.tasks.map(t => ({ id: t.id, status: t.status })));

			if (import.meta.env.DEV) {
				throw new Error(
					`Download task lifecycle violation: Attempted to mutate task ${id} but it does not exist. ` +
					`This indicates a bug where the service is trying to update a task that was already removed. ` +
					`Current task count: ${state.tasks.length}`
				);
			}
			return state;
		}
		const tasks = state.tasks.slice();
		const nextTask = updater({ ...tasks[index]! });
		tasks[index] = { ...nextTask, updatedAt: Date.now() };
		return { ...state, tasks: pruneTasks(tasks) };
	});
}

function removeTask(id: string): void {
	updateStore((state) => ({
		...state,
		tasks: state.tasks.filter((task) => task.id !== id)
	}));
}

function getTaskController(taskId: string): AbortController | null {
	const state = get(store);
	const task = state.tasks.find((entry) => entry.id === taskId);
	return task?.controller ?? null;
}

export const downloadUiStore = {
	subscribe: store.subscribe,
	reset(): void {
		stopCountdownTicker();
		setStore(initialState);
	},
	beginTrackDownload(
		track: PlayableTrack,
		filename: string,
		options?: { subtitle?: string; storage?: DownloadStorage; phase?: TrackDownloadPhase }
	): {
		taskId: string;
		controller: AbortController;
	} {
		const id = nextTaskId('track');
		const controller = new AbortController();

		let subtitle = options?.subtitle;
		if (!subtitle) {
			if (isSonglinkTrack(track)) {
				subtitle = track.artistName;
			} else {
				subtitle = formatArtists(track.artists);
			}
		}

		upsertTask({
			id,
			trackId: track.id,
			title: track.title,
			subtitle,
			filename,
			status: 'running',
			phase: options?.phase ?? 'downloading',
			storage: options?.storage,
			receivedBytes: 0,
			totalBytes: undefined,
			progress: 0,
			error: undefined,
			startedAt: Date.now(),
			updatedAt: Date.now(),
			cancellable: true,
			controller
		});
		return { taskId: id, controller };
	},
	updateTrackProgress(taskId: string, received: number, total?: number): void {
		mutateTask(taskId, (task) => ({
			...task,
			phase: task.phase ?? 'downloading',
			receivedBytes: received,
			totalBytes: total,
			progress: total ? clampProgress(received / total) : received > 0 ? 0.5 : 0
		}));
	},
	updateTrackStage(taskId: string, progress: number): void {
		mutateTask(taskId, (task) => ({
			...task,
			phase: task.phase ?? 'downloading',
			progress: clampProgress(progress)
		}));
	},
	updateTrackPhase(taskId: string, phase: TrackDownloadPhase): void {
		mutateTask(taskId, (task) => ({
			...task,
			phase
		}));
	},
	completeTrackDownload(taskId: string): void {
		const controller = getTaskController(taskId);
		if (controller) {
			controller.abort();
		}
		mutateTask(taskId, (task) => ({
			...task,
			status: task.status === 'cancelled' ? 'cancelled' : 'completed',
			progress: task.status === 'cancelled' ? task.progress : 1,
			cancellable: false,
			controller: undefined
		}));
	},
	errorTrackDownload(taskId: string, error: unknown): void {
		const controller = getTaskController(taskId);
		if (controller) {
			controller.abort();
		}
		mutateTask(taskId, (task) => ({
			...task,
			status: 'error',
			error:
				error instanceof Error
					? error.message
					: typeof error === 'string'
						? error
						: 'Download failed',
			cancellable: false,
			controller: undefined
		}));
	},
	cancelTrackDownload(taskId: string): void {
		const controller = getTaskController(taskId);
		if (controller) {
			controller.abort();
		}
		mutateTask(taskId, (task) => ({
			...task,
			status: 'cancelled',
			error: undefined,
			cancellable: false,
			controller: undefined
		}));
	},
	dismissTrackTask(taskId: string): void {
		removeTask(taskId);
	},
	startFfmpegCountdown(totalBytes: number, options?: { autoTriggered?: boolean }): void {
		const autoTriggered = options?.autoTriggered ?? true;
		setStore({
			...get(store),
			ffmpeg: {
				phase: autoTriggered ? 'countdown' : 'loading',
				countdownSeconds: autoTriggered ? COUNTDOWN_DEFAULT_SECONDS : 0,
				countdownActive: autoTriggered,
				totalBytes: totalBytes > 0 ? totalBytes : undefined,
				progress: 0,
				dismissible: autoTriggered,
				autoTriggered,
				error: undefined,
				startedAt: Date.now(),
				updatedAt: Date.now()
			}
		});
		if (autoTriggered) {
			updateCountdownTicker();
		} else {
			stopCountdownTicker();
		}
	},
	skipFfmpegCountdown(): void {
		updateStore((state) => {
			if (state.ffmpeg.phase !== 'countdown') {
				return state;
			}
			stopCountdownTicker();
			return {
				...state,
				ffmpeg: {
					...state.ffmpeg,
					phase: 'loading',
					countdownSeconds: 0,
					countdownActive: false,
					progress: 0,
					dismissible: false,
					updatedAt: Date.now()
				}
			};
		});
	},
	startFfmpegLoading(): void {
		stopCountdownTicker();
		updateStore((state) => ({
			...state,
			ffmpeg: {
				...state.ffmpeg,
				phase: 'loading',
				countdownSeconds: 0,
				countdownActive: false,
				progress: 0,
				dismissible: false,
				updatedAt: Date.now()
			}
		}));
	},
	updateFfmpegProgress(progress: number): void {
		updateStore((state) => ({
			...state,
			ffmpeg: {
				...state.ffmpeg,
				phase: 'loading',
				progress: clampProgress(progress),
				dismissible: false,
				updatedAt: Date.now()
			}
		}));
	},
	completeFfmpeg(): void {
		stopCountdownTicker();
		updateStore((state) => ({
			...state,
			ffmpeg: {
				...state.ffmpeg,
				phase: 'ready',
				progress: 1,
				countdownSeconds: 0,
				countdownActive: false,
				dismissible: true,
				updatedAt: Date.now()
			}
		}));
	},
	errorFfmpeg(error: unknown): void {
		stopCountdownTicker();
		updateStore((state) => ({
			...state,
			ffmpeg: {
				...state.ffmpeg,
				phase: 'error',
				progress: 0,
				countdownActive: false,
				dismissible: true,
				error:
					error instanceof Error
						? error.message
						: typeof error === 'string'
							? error
							: 'Failed to load FFmpeg',
				updatedAt: Date.now()
			}
		}));
	},
	dismissFfmpeg(): void {
		stopCountdownTicker();
		updateStore((state) => ({
			...state,
			ffmpeg: {
				phase: 'idle',
				countdownSeconds: COUNTDOWN_DEFAULT_SECONDS,
				countdownActive: false,
				totalBytes: undefined,
				progress: 0,
				dismissible: true,
				autoTriggered: true,
				error: undefined,
				startedAt: undefined,
				updatedAt: Date.now()
			}
		}));
	}
};

if (typeof window !== 'undefined' && isTestHookEnabled) {
	(window as typeof window & { __tidalResetDownloads?: () => void }).__tidalResetDownloads = () => {
		downloadUiStore.reset();
	};
}
