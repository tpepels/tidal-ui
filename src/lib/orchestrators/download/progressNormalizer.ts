import type { TrackDownloadProgress } from '$lib/api';
import type { ServerDownloadProgress } from '$lib/downloads';
import type { DownloadProgress } from '$lib/download-domain/types';

export const normalizeTrackProgress = (progress: TrackDownloadProgress): DownloadProgress => {
	if (progress.stage === 'downloading') {
		return {
			stage: 'downloading',
			receivedBytes: progress.receivedBytes,
			totalBytes: progress.totalBytes
		};
	}

	return {
		stage: 'embedding',
		progress: progress.progress
	};
};

export const normalizeServerProgress = (progress: ServerDownloadProgress): DownloadProgress => {
	if (progress.stage === 'downloading') {
		return {
			stage: 'downloading',
			receivedBytes: progress.receivedBytes,
			totalBytes: progress.totalBytes
		};
	}

	if (progress.stage === 'embedding') {
		return {
			stage: 'embedding',
			progress: progress.progress
		};
	}

	return {
		stage: 'uploading',
		uploadedBytes: progress.uploadedBytes,
		totalBytes: progress.totalBytes,
		speed: progress.speed,
		eta: progress.eta
	};
};
