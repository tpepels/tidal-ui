import { get, writable } from 'svelte/store';
import type { PlayableTrack } from '../types';
import type { DownloadStorage } from './downloadPreferences';
import { isSonglinkTrack } from '../types';
import { formatArtists } from '../utils/formatters';
import { downloadCache } from '../cache/downloadCache';
import { areTestHooksEnabled } from '$lib/utils/testHooks';
import {
	applyCancelTrackDownload,
	applyCompleteFfmpeg,
	applyCompleteTrackDownload,
	applyCountdownTick,
	applyDismissFfmpeg,
	applyErrorFfmpeg,
	applyErrorTrackDownload,
	applySkipFfmpegCountdown,
	applyStartFfmpegCountdown,
	applyStartFfmpegLoading,
	applyTaskRemoval,
	applyTaskUpsert,
	applyTrackPhase,
	applyTrackProgress,
	applyTrackStage,
	applyUpdateFfmpegProgress,
	createInitialDownloadState,
	createTrackTask,
	enforceDownloadInvariants,
	findTaskController,
	nextTaskId,
	type DownloadUiState,
	type TrackDownloadPhase
} from './downloadState';

export type {
	FfmpegPhase,
	FfmpegBannerState,
	TrackDownloadStatus,
	TrackDownloadPhase,
	TrackDownloadTask
} from './downloadState';

const isTestHookEnabled = areTestHooksEnabled();

const initialState = createInitialDownloadState();
const store = writable(initialState);

let countdownInterval: ReturnType<typeof setInterval> | null = null;

const updateStore = (updater: (state: DownloadUiState) => DownloadUiState): void => {
	store.update((state) => enforceDownloadInvariants(updater(state)));
};

const setStore = (state: DownloadUiState): void => {
	store.set(enforceDownloadInvariants(state));
};

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
			const nextState = applyCountdownTick(state);
			if (nextState.ffmpeg.phase !== 'countdown') {
				stopCountdownTicker();
			}
			return nextState;
		});
	}, 1000);
}

function getTaskController(taskId: string): AbortController | null {
	const state = get(store);
	return findTaskController(state, taskId);
}

export const downloadUiStore = {
	subscribe: store.subscribe,
	reset(): void {
		stopCountdownTicker();
		downloadCache.clear();
		setStore(createInitialDownloadState());
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

		const task = createTrackTask({
			id,
			trackId: track.id,
			title: track.title,
			subtitle,
			filename,
			phase: options?.phase,
			storage: options?.storage,
			controller
		});

		updateStore((state) => applyTaskUpsert(state, task));
		downloadCache.recordStart(task);
		return { taskId: id, controller };
	},
	updateTrackProgress(taskId: string, received: number, total?: number): void {
		updateStore((state) => applyTrackProgress(state, taskId, received, total));
	},
	updateTrackStage(taskId: string, progress: number): void {
		updateStore((state) => applyTrackStage(state, taskId, progress));
	},
	updateTrackPhase(taskId: string, phase: TrackDownloadPhase): void {
		updateStore((state) => applyTrackPhase(state, taskId, phase));
	},
	completeTrackDownload(taskId: string): void {
		const controller = getTaskController(taskId);
		if (controller) {
			controller.abort();
		}
		updateStore((state) => applyCompleteTrackDownload(state, taskId));
		downloadCache.markCompleted(taskId);
	},
	errorTrackDownload(taskId: string, error: unknown): void {
		const controller = getTaskController(taskId);
		if (controller) {
			controller.abort();
		}
		updateStore((state) => applyErrorTrackDownload(state, taskId, error));
		downloadCache.markFailed(taskId, error instanceof Error ? error.message : undefined);
	},
	cancelTrackDownload(taskId: string): void {
		const controller = getTaskController(taskId);
		if (controller) {
			controller.abort();
		}
		updateStore((state) => applyCancelTrackDownload(state, taskId));
		downloadCache.markCancelled(taskId);
	},
	dismissTrackTask(taskId: string): void {
		updateStore((state) => applyTaskRemoval(state, taskId));
		downloadCache.remove(taskId);
	},
	startFfmpegCountdown(totalBytes: number, options?: { autoTriggered?: boolean }): void {
		const autoTriggered = options?.autoTriggered ?? true;
		const nextState = applyStartFfmpegCountdown(get(store), totalBytes, { autoTriggered });
		setStore(nextState);
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
			return applySkipFfmpegCountdown(state);
		});
	},
	startFfmpegLoading(): void {
		stopCountdownTicker();
		updateStore((state) => applyStartFfmpegLoading(state));
	},
	updateFfmpegProgress(progress: number): void {
		updateStore((state) => applyUpdateFfmpegProgress(state, progress));
	},
	completeFfmpeg(): void {
		stopCountdownTicker();
		updateStore((state) => applyCompleteFfmpeg(state));
	},
	errorFfmpeg(error: unknown): void {
		stopCountdownTicker();
		updateStore((state) => applyErrorFfmpeg(state, error));
	},
	dismissFfmpeg(): void {
		stopCountdownTicker();
		updateStore((state) => applyDismissFfmpeg(state));
	}
};

if (typeof window !== 'undefined' && isTestHookEnabled) {
	(window as typeof window & { __tidalResetDownloads?: () => void }).__tidalResetDownloads = () => {
		downloadUiStore.reset();
	};
}
