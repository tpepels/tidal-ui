import { get } from 'svelte/store';
import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
import {
	buildTrackLinksCsv,
	downloadTrackToServer,
	getExtensionForQuality,
	sanitizeForFilename,
	type ServerDownloadProgress
} from '$lib/downloads';
import { downloadPreferencesStore, type DownloadMode, type DownloadStorage } from '$lib/stores/downloadPreferences';
import { downloadUiStore } from '$lib/stores/downloadUi';
import { machineCurrentTrack, machineQueue } from '$lib/stores/playerDerived';
import { toasts } from '$lib/stores/toasts';
import { type AudioQuality, type PlayableTrack, type Track, isSonglinkTrack } from '$lib/types';
import { formatArtists } from '$lib/utils/formatters';

export type SettingsQueueExportControllerOptions = {
	maxQueueZipTracks?: number;
	getDownloadMode: () => DownloadMode;
	getStorage: () => DownloadStorage;
	setDownloadMode: (mode: DownloadMode) => void;
	isServerStorage: () => boolean;
	isQueueActionBusy: () => boolean;
	getConvertAacToMp3: () => boolean;
	getDownloadCoversSeparately: () => boolean;
	getExperimentalMusicBrainzTagging: () => boolean;
	getStrictMusicBrainzMatching: () => boolean;
	setZipDownloading: (downloading: boolean) => void;
	setCsvExporting: (exporting: boolean) => void;
	setLegacyQueueDownloading: (downloading: boolean) => void;
};

type QueueState = {
	tracks: PlayableTrack[];
	quality: AudioQuality;
};

function collectQueueState(): QueueState {
	const queue = get(machineQueue);
	const currentTrack = get(machineCurrentTrack);
	const tracks = queue.length ? queue : currentTrack ? [currentTrack] : [];
	return { tracks, quality: get(downloadPreferencesStore).downloadQuality };
}

function filterExportableQueueTracks(tracks: PlayableTrack[]): Track[] {
	const exportable = tracks.filter((track): track is Track => !isSonglinkTrack(track));
	const skipped = tracks.length - exportable.length;
	if (skipped > 0 && exportable.length > 0) {
		toasts.warning(
			`Skipped ${skipped} Songlink track${skipped === 1 ? '' : 's'}; convert to TIDAL before exporting.`
		);
	}
	return exportable;
}

function createServerProgressHandler(taskId: string) {
	const downloadWeight = 0.55;
	let downloadFraction = 0;
	let uploadFraction = 0;
	return (progress: ServerDownloadProgress) => {
		if (progress.stage === 'downloading') {
			downloadUiStore.updateTrackPhase(taskId, 'downloading');
			const fraction = progress.totalBytes
				? progress.receivedBytes / progress.totalBytes
				: Math.min(downloadFraction + 0.05, 0.9);
			downloadFraction = Math.max(downloadFraction, Math.min(1, fraction));
		} else if (progress.stage === 'embedding') {
			downloadUiStore.updateTrackPhase(taskId, 'embedding');
			const fraction = 0.85 + progress.progress * 0.15;
			downloadFraction = Math.max(downloadFraction, Math.min(1, fraction));
		} else if (progress.stage === 'uploading') {
			downloadUiStore.updateTrackPhase(taskId, 'uploading');
			const fraction = progress.totalBytes ? progress.uploadedBytes / progress.totalBytes : uploadFraction;
			uploadFraction = Math.max(uploadFraction, Math.min(1, fraction));
		}
		const overall = Math.min(1, downloadFraction * downloadWeight + uploadFraction * (1 - downloadWeight));
		downloadUiStore.updateTrackStage(taskId, overall);
	};
}

function triggerFileDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

function timestampedFilename(extension: string): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	return `tidal-export-${stamp}.${extension}`;
}

function buildQueueFilename(
	track: PlayableTrack,
	index: number,
	quality: AudioQuality,
	convertAacToMp3: boolean,
	isServerStorage: boolean
): string {
	const ext = getExtensionForQuality(quality, convertAacToMp3 && !isServerStorage);
	const order = `${index + 1}`.padStart(2, '0');
	const artistName = sanitizeForFilename(
		isSonglinkTrack(track) ? track.artistName : formatArtists(track.artists)
	);
	const titleName = sanitizeForFilename(track.title ?? `Track ${order}`);
	return `${order} - ${artistName} - ${titleName}.${ext}`;
}

export function createSettingsQueueExportController(options: SettingsQueueExportControllerOptions) {
	const maxQueueZipTracks = options.maxQueueZipTracks ?? 75;

	async function downloadQueueAsZip(tracks: PlayableTrack[], quality: AudioQuality): Promise<void> {
		options.setZipDownloading(true);
		const convertAacToMp3 = options.getConvertAacToMp3();

		try {
			const exportableTracks = filterExportableQueueTracks(tracks);
			if (exportableTracks.length === 0) {
				toasts.warning('No exportable TIDAL tracks in the queue.');
				return;
			}
			if (exportableTracks.length > maxQueueZipTracks) {
				toasts.warning(`ZIP export is limited to ${maxQueueZipTracks} tracks to avoid memory issues.`);
				return;
			}
			const { default: JSZip } = await import('jszip');
			const zip = new JSZip();
			for (const [index, track] of exportableTracks.entries()) {
				const filename = buildQueueFilename(
					track,
					index,
					quality,
					convertAacToMp3,
					options.isServerStorage()
				);
				const { blob } = await losslessAPI.fetchTrackBlob(track.id, quality, filename, {
					ffmpegAutoTriggered: false,
					convertAacToMp3,
					enableExperimentalMusicBrainz: options.getExperimentalMusicBrainzTagging(),
					strictMusicBrainzMatching: options.getStrictMusicBrainzMatching()
				});
				zip.file(filename, blob);
			}
			const zipBlob = await zip.generateAsync({
				type: 'blob',
				compression: 'DEFLATE',
				compressionOptions: { level: 6 },
				streamFiles: true
			});
			triggerFileDownload(zipBlob, timestampedFilename('zip'));
		} catch (error) {
			console.error('Failed to build ZIP export', error);
			toasts.error('Unable to build ZIP export. Please try again.');
		} finally {
			options.setZipDownloading(false);
		}
	}

	async function exportQueueAsCsv(tracks: PlayableTrack[], quality: AudioQuality): Promise<void> {
		options.setCsvExporting(true);

		try {
			const exportableTracks = filterExportableQueueTracks(tracks);
			if (exportableTracks.length === 0) {
				toasts.warning('No exportable TIDAL tracks in the queue.');
				return;
			}
			const csvContent = await buildTrackLinksCsv(exportableTracks, quality);
			const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
			triggerFileDownload(blob, timestampedFilename('csv'));
		} catch (error) {
			console.error('Failed to export queue as CSV', error);
			toasts.error('Unable to export CSV. Please try again.');
		} finally {
			options.setCsvExporting(false);
		}
	}

	async function handleExportQueueCsv(): Promise<void> {
		const { tracks, quality } = collectQueueState();
		if (tracks.length === 0) {
			toasts.warning('Add tracks to the queue before exporting.');
			return;
		}
		await exportQueueAsCsv(tracks, quality);
	}

	async function downloadQueueIndividually(
		tracks: PlayableTrack[],
		quality: AudioQuality
	): Promise<void> {
		options.setLegacyQueueDownloading(true);
		const convertAacToMp3 = options.getConvertAacToMp3();
		const downloadCoversSeparately = options.getDownloadCoversSeparately();
		const experimentalMusicBrainzTagging = options.getExperimentalMusicBrainzTagging();
		const strictMusicBrainzMatching = options.getStrictMusicBrainzMatching();
		const errors: string[] = [];
		const storage = options.getStorage();

		try {
			for (const [index, track] of tracks.entries()) {
				const trackId = isSonglinkTrack(track) ? track.tidalId : track.id;
				if (!trackId) continue;
				const filename = buildQueueFilename(
					track,
					index,
					quality,
					convertAacToMp3,
					options.isServerStorage()
				);
				const { taskId, controller } = downloadUiStore.beginTrackDownload(track as Track, filename, {
					subtitle: isSonglinkTrack(track)
						? track.artistName
						: (track.album?.title ?? formatArtists(track.artists)),
					storage
				});
				downloadUiStore.skipFfmpegCountdown();

				try {
					if (storage === 'server') {
						let resolvedTrack = track as Track;
						if (isSonglinkTrack(track)) {
							const lookup = await losslessAPI.getTrack(trackId, quality);
							resolvedTrack = lookup.track;
						}
						const progressHandler = createServerProgressHandler(taskId);
						const serverResult = await downloadTrackToServer(resolvedTrack, quality, {
							downloadCoverSeperately: downloadCoversSeparately,
							experimentalMusicBrainzTagging,
							strictMusicBrainzMatching,
							conflictResolution: 'overwrite_if_different',
							signal: controller.signal,
							onProgress: progressHandler
						});
						if (!serverResult.success) {
							const serverError = serverResult.error ?? 'Server download failed';
							downloadUiStore.errorTrackDownload(taskId, serverError);
							const label = `${formatArtists(resolvedTrack.artists)} - ${resolvedTrack.title ?? 'Unknown Track'}`;
							errors.push(`${label}: ${serverError}`);
						} else {
							downloadUiStore.completeTrackDownload(taskId);
						}
						continue;
					}

					await losslessAPI.downloadTrack(trackId, quality, filename, {
						signal: controller.signal,
						onProgress: (progress: TrackDownloadProgress) => {
							if (progress.stage === 'downloading') {
								downloadUiStore.updateTrackProgress(taskId, progress.receivedBytes, progress.totalBytes);
							} else {
								downloadUiStore.updateTrackStage(taskId, progress.progress);
							}
						},
						onFfmpegCountdown: ({ totalBytes }) => {
							const bytes = typeof totalBytes === 'number' ? totalBytes : 0;
							downloadUiStore.startFfmpegCountdown(bytes, { autoTriggered: false });
						},
						onFfmpegStart: () => downloadUiStore.startFfmpegLoading(),
						onFfmpegProgress: (value) => downloadUiStore.updateFfmpegProgress(value),
						onFfmpegComplete: () => downloadUiStore.completeFfmpeg(),
						onFfmpegError: (error) => downloadUiStore.errorFfmpeg(error),
						ffmpegAutoTriggered: false,
						convertAacToMp3,
						downloadCoverSeperately: downloadCoversSeparately,
						enableExperimentalMusicBrainz: experimentalMusicBrainzTagging,
						strictMusicBrainzMatching
					});
					downloadUiStore.completeTrackDownload(taskId);
				} catch (error) {
					if (error instanceof DOMException && error.name === 'AbortError') {
						downloadUiStore.completeTrackDownload(taskId);
						continue;
					}
					console.error('Failed to download track from queue:', error);
					downloadUiStore.errorTrackDownload(taskId, error);
					const label = `${isSonglinkTrack(track) ? track.artistName : formatArtists(track.artists)} - ${track.title ?? 'Unknown Track'}`;
					const message =
						error instanceof Error && error.message
							? error.message
							: 'Failed to download track. Please try again.';
					errors.push(`${label}: ${message}`);
				}
			}

			if (errors.length > 0) {
				const summary = [
					'Unable to download some tracks individually:',
					...errors.slice(0, 3),
					errors.length > 3 ? `…and ${errors.length - 3} more` : undefined
				]
					.filter(Boolean)
					.join('\n');
				toasts.error(summary, { duration: 10000 });
			}
		} finally {
			options.setLegacyQueueDownloading(false);
		}
	}

	async function handleQueueDownload(): Promise<void> {
		if (options.isQueueActionBusy()) return;

		const { tracks, quality } = collectQueueState();
		const storage = options.getStorage();
		const downloadMode = options.getDownloadMode();
		if (tracks.length === 0) {
			toasts.warning('Add tracks to the queue before downloading.');
			return;
		}
		if (storage === 'server' && downloadMode !== 'individual') {
			options.setDownloadMode('individual');
			toasts.info('Server downloads are saved as individual files.');
		}
		if (downloadMode === 'csv') {
			await exportQueueAsCsv(tracks, quality);
			return;
		}
		const useZip = downloadMode === 'zip' && tracks.length > 1;
		if (useZip) {
			await downloadQueueAsZip(tracks, quality);
			return;
		}
		await downloadQueueIndividually(tracks, quality);
	}

	return {
		handleExportQueueCsv,
		handleQueueDownload
	};
}
