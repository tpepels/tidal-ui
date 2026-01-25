import type { DownloadExecutionPort } from '../downloadExecutionPort';
import type { DownloadExecutionRequest, DownloadExecutionResult } from './types';
import { normalizeServerProgress } from '../progressNormalizer';

export const createServerExecutor = (
	execution: DownloadExecutionPort
): {
	execute: (request: DownloadExecutionRequest) => Promise<DownloadExecutionResult>;
} => ({
	async execute(request) {
		const result = await execution.downloadToServer(request.track, request.quality, {
			downloadCoverSeperately: request.downloadCoverSeperately,
			conflictResolution: request.conflictResolution,
			signal: request.signal,
			onProgress: (progress) => {
				if (!request.onProgress) return;
				request.onProgress(normalizeServerProgress(progress));
			}
		});

		if (!result.success) {
			return {
				success: false,
				error: result.error ?? 'Server download failed'
			};
		}

		return {
			success: true,
			message: result.message
		};
	}
});
