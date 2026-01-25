import type { DownloadResult, TrackDownloadPayload, DownloadRequest } from './types';

export interface DownloadSource {
	fetchTrack(request: DownloadRequest): Promise<TrackDownloadPayload>;
}

export interface DownloadSink {
	saveLocal(payload: TrackDownloadPayload, signal?: AbortSignal): Promise<DownloadResult>;
	saveServer(payload: TrackDownloadPayload, request: DownloadRequest): Promise<DownloadResult>;
}

export interface Transcoder {
	convertIfNeeded(payload: TrackDownloadPayload, targetFormat?: 'mp3'): Promise<TrackDownloadPayload>;
}

export interface CoverService {
	fetchCover(url: string, signal?: AbortSignal): Promise<ArrayBuffer>;
}

export interface DownloadCoordinator {
	download(request: DownloadRequest): Promise<DownloadResult>;
}

export interface DownloadCoordinatorDeps {
	source: DownloadSource;
	sink: DownloadSink;
	transcoder?: Transcoder;
	coverService?: CoverService;
}
