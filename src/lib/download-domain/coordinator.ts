import type { DownloadCoordinator, DownloadCoordinatorDeps } from './interfaces';
import type { DownloadRequest, DownloadResult } from './types';

export const createDownloadCoordinator = (
	deps: DownloadCoordinatorDeps
): DownloadCoordinator => ({
	async download(request: DownloadRequest): Promise<DownloadResult> {
		const payload = await deps.source.fetchTrack(request);
		let nextPayload = payload;

		if (request.storage === 'client' && request.convertAacToMp3 && deps.transcoder) {
			nextPayload = await deps.transcoder.convertIfNeeded(payload, 'mp3');
		}

		if (request.storage === 'server') {
			return deps.sink.saveServer(nextPayload, request);
		}

		return deps.sink.saveLocal(nextPayload, request.signal);
	}
});
