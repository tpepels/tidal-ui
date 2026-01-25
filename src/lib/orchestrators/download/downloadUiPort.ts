import type { PlayableTrack } from '$lib/types';
import type { DownloadStorage } from '$lib/stores/downloadPreferences';
import type { TrackDownloadPhase } from '$lib/stores/downloadUi';
import { downloadUiStore } from '$lib/stores/downloadUi';

export interface DownloadUiPort {
	beginTrackDownload: (
		track: PlayableTrack,
		filename: string,
		options?: { subtitle?: string; storage?: DownloadStorage; phase?: TrackDownloadPhase }
	) => { taskId: string; controller: AbortController };
	updateTrackProgress: (taskId: string, received: number, total?: number) => void;
	updateTrackStage: (taskId: string, progress: number) => void;
	updateTrackPhase: (taskId: string, phase: TrackDownloadPhase) => void;
	completeTrackDownload: (taskId: string) => void;
	errorTrackDownload: (taskId: string, error: unknown) => void;
	cancelTrackDownload: (taskId: string) => void;
	startFfmpegCountdown: (totalBytes: number, options?: { autoTriggered?: boolean }) => void;
	skipFfmpegCountdown: () => void;
	startFfmpegLoading: () => void;
	updateFfmpegProgress: (progress: number) => void;
	completeFfmpeg: () => void;
	errorFfmpeg: (error: unknown) => void;
}

export const createDownloadUiPort = (): DownloadUiPort => ({
	beginTrackDownload: (...args) => downloadUiStore.beginTrackDownload(...args),
	updateTrackProgress: (...args) => downloadUiStore.updateTrackProgress(...args),
	updateTrackStage: (...args) => downloadUiStore.updateTrackStage(...args),
	updateTrackPhase: (...args) => downloadUiStore.updateTrackPhase(...args),
	completeTrackDownload: (...args) => downloadUiStore.completeTrackDownload(...args),
	errorTrackDownload: (...args) => downloadUiStore.errorTrackDownload(...args),
	cancelTrackDownload: (...args) => downloadUiStore.cancelTrackDownload(...args),
	startFfmpegCountdown: (...args) => downloadUiStore.startFfmpegCountdown(...args),
	skipFfmpegCountdown: () => downloadUiStore.skipFfmpegCountdown(),
	startFfmpegLoading: () => downloadUiStore.startFfmpegLoading(),
	updateFfmpegProgress: (...args) => downloadUiStore.updateFfmpegProgress(...args),
	completeFfmpeg: () => downloadUiStore.completeFfmpeg(),
	errorFfmpeg: (...args) => downloadUiStore.errorFfmpeg(...args)
});
