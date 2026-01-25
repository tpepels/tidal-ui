import { losslessAPI } from '$lib/api';
import { downloadTrackToServer } from '$lib/downloads';
import { createDownloadCoordinator } from '$lib/download-domain/coordinator';
import type { DownloadRequest, DownloadResult } from '$lib/download-domain/types';
import { createDownloadSource, createDownloadSink } from '$lib/download-adapters';

export interface DownloadExecutionPort {
	downloadWithCoordinator: (request: DownloadRequest) => Promise<DownloadResult>;
	downloadToServer: typeof downloadTrackToServer;
	downloadToClient: typeof losslessAPI.downloadTrack;
}

export const createDownloadExecutionPort = (): DownloadExecutionPort => {
	const coordinator = createDownloadCoordinator({
		source: createDownloadSource(),
		sink: createDownloadSink()
	});

	return {
		downloadWithCoordinator: (request) => coordinator.download(request),
		downloadToServer: (...args) => downloadTrackToServer(...args),
		downloadToClient: (...args) => losslessAPI.downloadTrack(...args)
	};
};
