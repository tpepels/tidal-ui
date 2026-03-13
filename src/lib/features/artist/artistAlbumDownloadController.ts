import { downloadAlbum } from '$lib/downloads';
import type { DownloadMode, DownloadStorage } from '$lib/stores/downloadPreferences';
import type { Album, AudioQuality } from '$lib/types';
import type { ArtistAlbumDownloadState } from './artistAlbumQueueController';

export type ArtistAlbumDownloadPreferences = {
	quality: AudioQuality;
	mode: DownloadMode;
	convertAacToMp3: boolean;
	experimentalMusicBrainzTagging: boolean;
	strictMusicBrainzMatching: boolean;
	storage: DownloadStorage;
};

export type QueueActionResult = {
	success: boolean;
	error?: string;
};

type DownloadEventLike = {
	preventDefault?: () => void;
	stopPropagation?: () => void;
};

type ArtistAlbumDownloadControllerOptions = {
	getAlbumDownloadState: (albumId: number) => ArtistAlbumDownloadState;
	patchAlbumDownloadState: (
		albumId: number,
		patch: Partial<ArtistAlbumDownloadState>
	) => void;
	isAlbumQueueDownloadCancellable: (state: ArtistAlbumDownloadState) => boolean;
	requestQueueCancel: (albumId: number) => Promise<QueueActionResult>;
	requestQueueResume: (albumId: number) => Promise<QueueActionResult>;
	startQueuePolling: (albumId: number, jobId: string) => void;
	isDiscographyDownloading: () => boolean;
	setDiscographyDownloading: (downloading: boolean) => void;
	setDiscographyProgress: (progress: { completed: number; total: number }) => void;
	setDiscographyError: (error: string | null) => void;
	resolveAlbumInLibrary: (albumId: number) => boolean;
	confirmServerOverwrite: () => boolean;
	confirmClientRedownload: () => boolean;
	getDownloadPreferences: () => ArtistAlbumDownloadPreferences;
	resolveArtistName: () => string | undefined;
	downloadAlbumFn?: typeof downloadAlbum;
};

const FORCE_OVERWRITE_CONFIRMATION =
	'This album is already in your local library. Redownload it and overwrite existing files?';
const CLIENT_REDOWNLOAD_CONFIRMATION =
	'This album is already in your local library. Browser downloads cannot overwrite existing files and may append (2) to filenames. Continue anyway?';

function stopEvent(event?: DownloadEventLike): void {
	event?.preventDefault?.();
	event?.stopPropagation?.();
}

export function createArtistAlbumDownloadController(options: ArtistAlbumDownloadControllerOptions) {
	const downloadAlbumFn = options.downloadAlbumFn ?? downloadAlbum;

	async function cancelAlbumQueueDownload(
		albumId: number,
		event?: DownloadEventLike
	): Promise<void> {
		stopEvent(event);
		const result = await options.requestQueueCancel(albumId);
		if (result.success || !result.error) {
			return;
		}
		options.patchAlbumDownloadState(albumId, {
			error: result.error || 'Unable to stop this album download right now.'
		});
	}

	async function resumeAlbumQueueDownload(
		albumId: number,
		event?: DownloadEventLike
	): Promise<void> {
		stopEvent(event);
		const result = await options.requestQueueResume(albumId);
		if (result.success || !result.error) {
			return;
		}
		options.patchAlbumDownloadState(albumId, {
			error: result.error || 'Unable to resume this album download right now.'
		});
	}

	async function handleAlbumDownload(album: Album, event?: DownloadEventLike): Promise<void> {
		stopEvent(event);
		const currentState = options.getAlbumDownloadState(album.id);
		if (options.isDiscographyDownloading()) {
			return;
		}

		if (options.isAlbumQueueDownloadCancellable(currentState)) {
			await cancelAlbumQueueDownload(album.id);
			return;
		}
		if (currentState.status === 'paused') {
			await resumeAlbumQueueDownload(album.id);
			return;
		}

		const inLibrary = options.resolveAlbumInLibrary(album.id);
		let forceOverwrite = false;
		const preferences = options.getDownloadPreferences();
		if (inLibrary && currentState.status === 'idle') {
			if (preferences.storage === 'server') {
				forceOverwrite = options.confirmServerOverwrite();
				if (!forceOverwrite) {
					return;
				}
			} else if (!options.confirmClientRedownload()) {
				return;
			}
		}

		if (currentState.downloading || currentState.status === 'submitting') {
			return;
		}

		options.patchAlbumDownloadState(album.id, {
			status: 'submitting',
			downloading: true,
			completed: 0,
			total: album.numberOfTracks ?? 0,
			error: null,
			failedTracks: 0,
			queueJobId: null
		});

		try {
			let failedCount = 0;
			const result = await downloadAlbumFn(
				album,
				preferences.quality,
				{
					onTotalResolved: (total) => {
						options.patchAlbumDownloadState(album.id, { total });
					},
					onTrackDownloaded: (completed, total) => {
						options.patchAlbumDownloadState(album.id, {
							status: 'processing',
							downloading: true,
							completed,
							total
						});
					},
					onTrackFailed: (_track, _error, attempt) => {
						if (attempt >= 3) {
							failedCount += 1;
							options.patchAlbumDownloadState(album.id, { failedTracks: failedCount });
						}
					}
				},
				options.resolveArtistName(),
				{
					mode: preferences.mode,
					convertAacToMp3: preferences.convertAacToMp3,
					experimentalMusicBrainzTagging: preferences.experimentalMusicBrainzTagging,
					strictMusicBrainzMatching: preferences.strictMusicBrainzMatching,
					storage: preferences.storage,
					forceOverwrite
				}
			);

			if (result.storage === 'server' && result.jobId) {
				options.patchAlbumDownloadState(album.id, {
					status: 'queued',
					downloading: false,
					completed: 0,
					total: result.totalTracks,
					error: null,
					queueJobId: result.jobId
				});
				options.startQueuePolling(album.id, result.jobId);
				return;
			}

			const finalState = options.getAlbumDownloadState(album.id);
			options.patchAlbumDownloadState(album.id, {
				status: failedCount > 0 ? 'failed' : 'completed',
				downloading: false,
				completed: finalState.total ?? result.completedTracks ?? finalState.completed ?? 0,
				error:
					failedCount > 0
						? `${failedCount} track${failedCount > 1 ? 's' : ''} failed after 3 attempts`
						: null,
				queueJobId: null
			});
		} catch (error) {
			console.error('Failed to download album:', error);
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Failed to download album. Please try again.';
			options.patchAlbumDownloadState(album.id, {
				status: 'failed',
				downloading: false,
				error: message,
				queueJobId: null
			});
		}
	}

	async function handleDownloadDiscography(albums: Album[]): Promise<void> {
		if (albums.length === 0 || options.isDiscographyDownloading()) {
			return;
		}

		options.setDiscographyDownloading(true);
		options.setDiscographyError(null);

		let estimatedTotal = albums.reduce((sum, album) => sum + (album.numberOfTracks ?? 0), 0);
		if (!Number.isFinite(estimatedTotal) || estimatedTotal < 0) {
			estimatedTotal = 0;
		}

		let completed = 0;
		let total = estimatedTotal;
		options.setDiscographyProgress({ completed, total });
		const preferences = options.getDownloadPreferences();

		for (const album of albums) {
			let albumEstimate = album.numberOfTracks ?? 0;
			let albumFailedCount = 0;
			try {
				await downloadAlbumFn(
					album,
					preferences.quality,
					{
						onTotalResolved: (resolvedTotal) => {
							if (resolvedTotal !== albumEstimate) {
								total += resolvedTotal - albumEstimate;
								albumEstimate = resolvedTotal;
								options.setDiscographyProgress({ completed, total });
							} else if (total === 0 && resolvedTotal > 0) {
								total += resolvedTotal;
								options.setDiscographyProgress({ completed, total });
							}
						},
						onTrackDownloaded: () => {
							completed += 1;
							options.setDiscographyProgress({ completed, total });
						},
						onTrackFailed: (_track, _error, attempt) => {
							if (attempt >= 3) {
								albumFailedCount += 1;
							}
						}
					},
					options.resolveArtistName(),
					{
						mode: preferences.mode,
						convertAacToMp3: preferences.convertAacToMp3,
						experimentalMusicBrainzTagging: preferences.experimentalMusicBrainzTagging,
						strictMusicBrainzMatching: preferences.strictMusicBrainzMatching,
						storage: preferences.storage
					}
				);
				if (albumFailedCount > 0) {
					console.warn(
						`[Discography] ${albumFailedCount} track(s) failed in album: ${album.title}`
					);
				}
			} catch (error) {
				console.error('Failed to download discography album:', error);
				const message =
					error instanceof Error && error.message
						? error.message
						: 'Failed to download part of the discography.';
				options.setDiscographyError(message);
				break;
			}
		}

		options.setDiscographyDownloading(false);
	}

	return {
		cancelAlbumQueueDownload,
		resumeAlbumQueueDownload,
		handleAlbumDownload,
		handleDownloadDiscography
	};
}

export const artistAlbumDownloadPrompts = {
	FORCE_OVERWRITE_CONFIRMATION,
	CLIENT_REDOWNLOAD_CONFIRMATION
};
