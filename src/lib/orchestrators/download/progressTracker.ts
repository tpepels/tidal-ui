import type { DownloadStorage } from '$lib/stores/downloadPreferences';
import type { DownloadProgress } from '$lib/download-domain/types';
import type { DownloadUiPort } from './downloadUiPort';
import {
	calculateDownloadFraction,
	calculateEmbeddingFraction,
	calculateUploadFraction,
	calculateWeightedProgress
} from './progress';

interface ProgressTrackerOptions {
	taskId: string;
	storage: DownloadStorage;
	ui: DownloadUiPort;
	downloadWeight?: number;
}

export const createProgressTracker = ({
	taskId,
	storage,
	ui,
	downloadWeight = 0.55
}: ProgressTrackerOptions) => {
	const isServer = storage === 'server';
	let downloadFraction = 0;
	let uploadFraction = 0;

	const updateWeightedStage = () => {
		if (!isServer) {
			return;
		}
		const overall = calculateWeightedProgress(downloadFraction, uploadFraction, downloadWeight);
		ui.updateTrackStage(taskId, overall);
	};

	return (progress: DownloadProgress) => {
		if (progress.stage === 'downloading') {
			ui.updateTrackPhase(taskId, 'downloading');

			if (isServer) {
				const fraction = calculateDownloadFraction({
					receivedBytes: progress.receivedBytes ?? 0,
					totalBytes: progress.totalBytes,
					previous: downloadFraction
				});
				downloadFraction = Math.max(downloadFraction, fraction);
				updateWeightedStage();
			} else {
				ui.updateTrackProgress(taskId, progress.receivedBytes ?? 0, progress.totalBytes);
			}
			return;
		}

		if (progress.stage === 'embedding') {
			ui.updateTrackPhase(taskId, 'embedding');

			if (isServer) {
				const fraction = calculateEmbeddingFraction(progress.progress ?? 0);
				downloadFraction = Math.max(downloadFraction, fraction);
				updateWeightedStage();
			} else {
				ui.updateTrackStage(taskId, progress.progress ?? 0);
			}
			return;
		}

		if (progress.stage === 'uploading') {
			if (!isServer) {
				return;
			}
			ui.updateTrackPhase(taskId, 'uploading');
			const fraction = calculateUploadFraction({
				uploadedBytes: progress.uploadedBytes ?? 0,
				totalBytes: progress.totalBytes,
				previous: uploadFraction
			});
			uploadFraction = Math.max(uploadFraction, fraction);
			updateWeightedStage();
		}
	};
};
