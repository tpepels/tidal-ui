import type { AudioQuality, Track } from '$lib/types';
import type { DownloadStorage } from '$lib/stores/downloadPreferences';

export type DownloadProgressStage = 'downloading' | 'embedding' | 'uploading';

export interface DownloadProgress {
	stage: DownloadProgressStage;
	receivedBytes?: number;
	totalBytes?: number;
	uploadedBytes?: number;
	progress?: number;
	speed?: number;
	eta?: number;
}

export interface DownloadRequest {
	track: Track;
	quality: AudioQuality;
	storage: DownloadStorage;
	convertAacToMp3: boolean;
	downloadCoverSeperately: boolean;
	conflictResolution?: 'overwrite' | 'skip' | 'rename' | 'overwrite_if_different';
	signal?: AbortSignal;
	onProgress?: (progress: DownloadProgress) => void;
}

export type DownloadResult =
	| {
			success: true;
			filename: string;
			filepath?: string;
			message?: string;
			action?: string;
	  }
	| {
			success: false;
			error: string;
			filename?: string;
	  };

export interface TrackDownloadPayload {
	track: Track;
	quality: AudioQuality;
	blob: Blob;
	filename: string;
}
