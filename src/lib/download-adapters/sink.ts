import type { DownloadSink } from '$lib/download-domain/interfaces';
import type { DownloadRequest, DownloadResult, TrackDownloadPayload } from '$lib/download-domain/types';
import { downloadTrackServerSide, triggerFileDownload } from '$lib/downloads';
import { formatArtists } from '$lib/utils/formatters';
import { losslessAPI } from '$lib/api';

const resolveTrackTitle = (title?: string | null, version?: string | null): string | undefined => {
	if (!title) return undefined;
	return version ? `${title} (${version})` : title;
};

export const createDownloadSink = (): DownloadSink => ({
	async saveLocal(payload: TrackDownloadPayload): Promise<DownloadResult> {
		triggerFileDownload(payload.blob, payload.filename);
		return { success: true, filename: payload.filename };
	},
	async saveServer(payload: TrackDownloadPayload, request: DownloadRequest): Promise<DownloadResult> {
		const { track, blob } = payload;
		const coverUrl =
			request.downloadCoverSeperately && track.album?.cover
				? losslessAPI.getCoverUrl(track.album.cover, '1280')
				: undefined;
		const resolvedTitle = resolveTrackTitle(track.title, track.version ?? null);
		const result = await downloadTrackServerSide(
			track.id,
			request.quality,
			track.album?.title ?? 'Unknown Album',
			formatArtists(track.artists),
			resolvedTitle,
			blob,
			track,
			{
				conflictResolution: request.conflictResolution,
				downloadCoverSeperately: request.downloadCoverSeperately,
				coverUrl,
				signal: request.signal,
				onProgress: (progress) => {
					request.onProgress?.({
						stage: 'uploading',
						uploadedBytes: progress.uploaded,
						totalBytes: progress.total,
						speed: progress.speed,
						eta: progress.eta
					});
				}
			}
		);

		if (!result.success) {
			return {
				success: false,
				error: result.error ?? 'Server upload failed',
				filename: payload.filename
			};
		}

		return {
			success: true,
			filename: payload.filename,
			filepath: result.filepath,
			message: result.message,
			action: result.action
		};
	}
});
