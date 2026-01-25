import type { DownloadExecutionPort } from '../downloadExecutionPort';
import type { DownloadExecutionRequest, DownloadExecutionResult } from './types';

export const createCoordinatorExecutor = (
	execution: DownloadExecutionPort
): {
	execute: (request: DownloadExecutionRequest) => Promise<DownloadExecutionResult>;
} => ({
	async execute(request) {
		const result = await execution.downloadWithCoordinator({
			track: request.track,
			quality: request.quality,
			storage: request.storage,
			convertAacToMp3: request.convertAacToMp3,
			downloadCoverSeperately: request.downloadCoverSeperately,
			conflictResolution: request.conflictResolution,
			signal: request.signal,
			onProgress: request.onProgress
		});

		if (!result.success) {
			return {
				success: false,
				error: result.error ?? 'Download failed'
			};
		}

		return {
			success: true,
			message: result.message
		};
	}
});
