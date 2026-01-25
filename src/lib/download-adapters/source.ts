import type { DownloadSource } from '$lib/download-domain/interfaces';
import type { TrackDownloadPayload } from '$lib/download-domain/types';
import { buildTrackFilename, downloadTrackWithRetry } from '$lib/downloads';
import { formatArtists } from '$lib/utils/formatters';

export const createDownloadSource = (): DownloadSource => ({
	async fetchTrack(request): Promise<TrackDownloadPayload> {
		const { track, quality, signal, convertAacToMp3 } = request;
		const filename = buildTrackFilename(
			track.album,
			track,
			quality,
			formatArtists(track.artists),
			convertAacToMp3
		);

		const result = await downloadTrackWithRetry(track.id, quality, filename, track, undefined, {
			convertAacToMp3,
			downloadCoverSeperately: false,
			storage: request.storage,
			signal,
			onProgress: (progress) => {
				if (progress.stage === 'downloading') {
					request.onProgress?.({
						stage: 'downloading',
						receivedBytes: progress.receivedBytes,
						totalBytes: progress.totalBytes
					});
				} else if (progress.stage === 'embedding') {
					request.onProgress?.({ stage: 'embedding', progress: progress.progress });
				}
			}
		});

		if (!result.success || !result.blob) {
			throw result.error ?? new Error('Failed to fetch track blob');
		}

		return {
			track,
			quality,
			blob: result.blob,
			filename
		};
	}
});
