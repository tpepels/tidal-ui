import type { AudioQuality, Track } from '$lib/types';
import type { DownloadStorage } from '$lib/stores/downloadPreferences';
import type { DownloadProgress } from '$lib/download-domain/types';

export interface DownloadExecutionRequest {
	track: Track;
	quality: AudioQuality;
	filename: string;
	storage: DownloadStorage;
	convertAacToMp3: boolean;
	downloadCoverSeperately: boolean;
	conflictResolution?: 'overwrite' | 'skip' | 'rename' | 'overwrite_if_different';
	signal?: AbortSignal;
	onProgress?: (progress: DownloadProgress) => void;
	ffmpegAutoTriggered?: boolean;
	onFfmpegCountdown?: (payload: { totalBytes?: number; autoTriggered: boolean }) => void;
	onFfmpegStart?: () => void;
	onFfmpegProgress?: (progress: number) => void;
	onFfmpegComplete?: () => void;
	onFfmpegError?: (error: unknown) => void;
}

export type DownloadExecutionResult =
	| { success: true; message?: string }
	| { success: false; error: string };

export interface DownloadExecutionStrategy {
	execute: (request: DownloadExecutionRequest) => Promise<DownloadExecutionResult>;
}
