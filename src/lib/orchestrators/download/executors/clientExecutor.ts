import type { DownloadExecutionPort } from '../downloadExecutionPort';
import type { DownloadExecutionRequest, DownloadExecutionResult } from './types';
import { normalizeTrackProgress } from '../progressNormalizer';

export const createClientExecutor = (
	execution: DownloadExecutionPort
): {
	execute: (request: DownloadExecutionRequest) => Promise<DownloadExecutionResult>;
} => ({
	async execute(request) {
		await execution.downloadToClient(request.track.id, request.quality, request.filename, {
			signal: request.signal,
			convertAacToMp3: request.convertAacToMp3,
			downloadCoverSeperately: request.downloadCoverSeperately,
			ffmpegAutoTriggered: request.ffmpegAutoTriggered ?? false,
			onProgress: (progress) => {
				if (!request.onProgress) return;
				request.onProgress(normalizeTrackProgress(progress));
			},
			onFfmpegCountdown: (payload) => request.onFfmpegCountdown?.(payload),
			onFfmpegStart: () => request.onFfmpegStart?.(),
			onFfmpegProgress: (progress) => request.onFfmpegProgress?.(progress),
			onFfmpegComplete: () => request.onFfmpegComplete?.(),
			onFfmpegError: (error) => request.onFfmpegError?.(error)
		});

		return { success: true };
	}
});
