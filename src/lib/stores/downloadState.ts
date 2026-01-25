import { validateInvariant } from '../core/invariants';
import type { DownloadStorage } from './downloadPreferences';

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

export interface DownloadUiState {
	ffmpeg: FfmpegBannerState;
	tasks: TrackDownloadTask[];
}

export const COUNTDOWN_DEFAULT_SECONDS = 5;

const MAX_VISIBLE_TASKS = 8;
const ACTIVE_TASK_STATUSES = new Set<TrackDownloadStatus>(['pending', 'running']);

export const createInitialDownloadState = (): DownloadUiState => ({
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
});

export const enforceDownloadInvariants = (state: DownloadUiState): DownloadUiState => {
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

export const nextTaskId = (prefix: string): string =>
	`${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

export const clampProgress = (value: number | null | undefined): number => {
	if (!Number.isFinite(value ?? NaN)) return 0;
	return Math.max(0, Math.min(1, Number(value)));
};

export const pruneTasks = (tasks: TrackDownloadTask[]): TrackDownloadTask[] => {
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
};

export const applyTaskUpsert = (
	state: DownloadUiState,
	task: TrackDownloadTask
): DownloadUiState => {
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
};

export const applyTaskMutation = (
	state: DownloadUiState,
	id: string,
	updater: (task: TrackDownloadTask) => TrackDownloadTask
): DownloadUiState => {
	const index = state.tasks.findIndex((entry) => entry.id === id);
	if (index === -1) {
		// INVARIANT VIOLATION: Task must exist to be mutated
		console.error(`[DownloadUi] INVARIANT VIOLATION: Cannot mutate task ${id} - task not found in store`);
		console.error(`[DownloadUi] Current tasks:`, state.tasks.map((task) => ({ id: task.id, status: task.status })));

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
};

export const applyTaskRemoval = (state: DownloadUiState, id: string): DownloadUiState => ({
	...state,
	tasks: state.tasks.filter((task) => task.id !== id)
});

export const findTaskController = (
	state: DownloadUiState,
	taskId: string
): AbortController | null => {
	const task = state.tasks.find((entry) => entry.id === taskId);
	return task?.controller ?? null;
};

export const createTrackTask = (params: {
	id: string;
	trackId: number | string;
	title: string;
	subtitle?: string;
	filename: string;
	phase?: TrackDownloadPhase;
	storage?: DownloadStorage;
	controller: AbortController;
}): TrackDownloadTask => ({
	id: params.id,
	trackId: params.trackId,
	title: params.title,
	subtitle: params.subtitle,
	filename: params.filename,
	status: 'running',
	phase: params.phase ?? 'downloading',
	storage: params.storage,
	receivedBytes: 0,
	totalBytes: undefined,
	progress: 0,
	error: undefined,
	startedAt: Date.now(),
	updatedAt: Date.now(),
	cancellable: true,
	controller: params.controller
});

export const applyTrackProgress = (
	state: DownloadUiState,
	taskId: string,
	received: number,
	total?: number
): DownloadUiState =>
	applyTaskMutation(state, taskId, (task) => ({
		...task,
		phase: task.phase ?? 'downloading',
		receivedBytes: received,
		totalBytes: total,
		progress: total ? clampProgress(received / total) : received > 0 ? 0.5 : 0
	}));

export const applyTrackStage = (
	state: DownloadUiState,
	taskId: string,
	progress: number
): DownloadUiState =>
	applyTaskMutation(state, taskId, (task) => ({
		...task,
		phase: task.phase ?? 'downloading',
		progress: clampProgress(progress)
	}));

export const applyTrackPhase = (
	state: DownloadUiState,
	taskId: string,
	phase: TrackDownloadPhase
): DownloadUiState =>
	applyTaskMutation(state, taskId, (task) => ({
		...task,
		phase
	}));

export const applyCompleteTrackDownload = (
	state: DownloadUiState,
	taskId: string
): DownloadUiState =>
	applyTaskMutation(state, taskId, (task) => ({
		...task,
		status: task.status === 'cancelled' ? 'cancelled' : 'completed',
		progress: task.status === 'cancelled' ? task.progress : 1,
		cancellable: false,
		controller: undefined
	}));

export const applyErrorTrackDownload = (
	state: DownloadUiState,
	taskId: string,
	error: unknown
): DownloadUiState =>
	applyTaskMutation(state, taskId, (task) => ({
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

export const applyCancelTrackDownload = (
	state: DownloadUiState,
	taskId: string
): DownloadUiState =>
	applyTaskMutation(state, taskId, (task) => ({
		...task,
		status: 'cancelled',
		error: undefined,
		cancellable: false,
		controller: undefined
	}));

export const applyStartFfmpegCountdown = (
	state: DownloadUiState,
	totalBytes: number,
	options?: { autoTriggered?: boolean }
): DownloadUiState => {
	const autoTriggered = options?.autoTriggered ?? true;
	return {
		...state,
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
	};
};

export const applyCountdownTick = (state: DownloadUiState): DownloadUiState => {
	if (state.ffmpeg.phase !== 'countdown') {
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
};

export const applySkipFfmpegCountdown = (state: DownloadUiState): DownloadUiState => {
	if (state.ffmpeg.phase !== 'countdown') {
		return state;
	}

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
};

export const applyStartFfmpegLoading = (state: DownloadUiState): DownloadUiState => ({
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
});

export const applyUpdateFfmpegProgress = (
	state: DownloadUiState,
	progress: number
): DownloadUiState => ({
	...state,
	ffmpeg: {
		...state.ffmpeg,
		phase: 'loading',
		progress: clampProgress(progress),
		dismissible: false,
		updatedAt: Date.now()
	}
});

export const applyCompleteFfmpeg = (state: DownloadUiState): DownloadUiState => ({
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
});

export const applyErrorFfmpeg = (state: DownloadUiState, error: unknown): DownloadUiState => ({
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
});

export const applyDismissFfmpeg = (state: DownloadUiState): DownloadUiState => ({
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
});
