import { get, writable } from 'svelte/store';
import { downloadUiStore } from '$lib/stores/downloadUi';
import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
import { downloadOrchestrator } from '$lib/orchestrators';
import type { PlayableTrack } from '$lib/types';
import type { DownloadOrchestratorResult } from '$lib/orchestrators';

type TrackId = number | string;

type NotificationMode = 'alert' | 'toast' | 'silent';

interface TrackDownloadUiOptions<TTrack extends PlayableTrack> {
	resolveSubtitle: (track: TTrack) => string;
	notificationMode?: NotificationMode;
	autoConvertSonglink?: boolean;
	skipFfmpegCountdown?: boolean;
}

export function createTrackDownloadUi<TTrack extends PlayableTrack = PlayableTrack>(
	options: TrackDownloadUiOptions<TTrack>
) {
	const downloadingIds = writable(new Set<TrackId>());
	const cancelledIds = writable(new Set<TrackId>());
	const downloadTaskIds = writable(new Map<TrackId, string>());

	const markCancelled = (trackId: TrackId) => {
		cancelledIds.update((current) => {
			const next = new Set(current);
			next.add(trackId);
			return next;
		});
		setTimeout(() => {
			cancelledIds.update((current) => {
				const next = new Set(current);
				next.delete(trackId);
				return next;
			});
		}, 1500);
	};

	const handleCancelDownload = (trackId: TrackId, event?: MouseEvent) => {
		event?.stopPropagation();
		const taskId = get(downloadTaskIds).get(trackId);
		if (taskId) {
			downloadUiStore.cancelTrackDownload(taskId);
		}
		downloadingIds.update((current) => {
			const next = new Set(current);
			next.delete(trackId);
			return next;
		});
		downloadTaskIds.update((current) => {
			const next = new Map(current);
			next.delete(trackId);
			return next;
		});
		markCancelled(trackId);
	};

	const handleDownload = async (track: TTrack, event?: MouseEvent) => {
		event?.stopPropagation();
		const uiTrackId = track.id as TrackId;

		if (get(downloadingIds).has(uiTrackId)) {
			return;
		}

		downloadingIds.update((current) => {
			const next = new Set(current);
			next.add(uiTrackId);
			return next;
		});

		let result: DownloadOrchestratorResult | undefined;
		try {
			result = await downloadOrchestrator.downloadTrack(track, {
				quality: get(downloadPreferencesStore).downloadQuality,
				subtitle: options.resolveSubtitle(track),
				notificationMode: options.notificationMode ?? 'alert',
				ffmpegAutoTriggered: false,
				skipFfmpegCountdown: options.skipFfmpegCountdown ?? true,
				autoConvertSonglink: options.autoConvertSonglink ?? false
			});

			const taskId = result?.taskId;
			if (result?.success && taskId) {
				downloadTaskIds.update((current) => {
					const next = new Map(current);
					next.set(uiTrackId, taskId);
					return next;
				});
			} else if (!result?.success && result?.error?.code === 'DOWNLOAD_CANCELLED') {
				markCancelled(uiTrackId);
			}
		} finally {
			downloadingIds.update((current) => {
				const next = new Set(current);
				next.delete(uiTrackId);
				return next;
			});
			downloadTaskIds.update((current) => {
				const next = new Map(current);
				next.delete(uiTrackId);
				return next;
			});
		}
		return result;
	};

	return {
		downloadingIds,
		cancelledIds,
		handleCancelDownload,
		handleDownload
	};
}
