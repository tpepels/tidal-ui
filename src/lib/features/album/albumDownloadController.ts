import { isAlbumDownloadQueueActive, type AlbumDownloadStatus } from '$lib/controllers/albumDownloadUi';
import { downloadAlbum } from '$lib/downloads';
import type { DownloadMode, DownloadStorage } from '$lib/stores/downloadPreferences';
import type { Album, AudioQuality, Track } from '$lib/types';
import {
	repairAlbumInLibrary,
	type AlbumRepairResult,
	type AlbumRepairTrackInput
} from '$lib/utils/mediaLibraryClient';
import {
	createAdaptivePollingController,
	type AdaptivePollingController
} from '$lib/utils/adaptivePolling';
import { pollAlbumQueueJob, requestAlbumQueueAction } from './albumQueueController';

export type AlbumRouteQueueState = {
	queueStatus: AlbumDownloadStatus;
	queueJobId: string | null;
	queueCompletedTracks: number;
	queueTotalTracks: number;
	isDownloadingAll: boolean;
	downloadedCount: number;
	downloadError: string | null;
};

export type AlbumRouteMaintenanceState = {
	isRepairingAlbum: boolean;
	repairMessage: string | null;
};

export type AlbumRouteDownloadPreferences = {
	quality: AudioQuality;
	mode: DownloadMode;
	convertAacToMp3: boolean;
	experimentalMusicBrainzTagging: boolean;
	strictMusicBrainzMatching: boolean;
	storage: DownloadStorage;
};

type AlbumDownloadControllerOptions = {
	getAlbum: () => Album | null;
	getTracks: () => Track[];
	getCurrentAlbumId: () => number | null;
	getQueueState: () => AlbumRouteQueueState;
	patchQueueState: (patch: Partial<AlbumRouteQueueState>) => void;
	getMaintenanceState: () => AlbumRouteMaintenanceState;
	patchMaintenanceState: (patch: Partial<AlbumRouteMaintenanceState>) => void;
	isAlbumInLibrary: () => boolean;
	isMusicBrainzReleaseLookupLoading: () => boolean;
	getSelectedMusicBrainzReleaseId: () => string;
	getDownloadPreferences: () => AlbumRouteDownloadPreferences;
	confirmServerOverwrite: () => boolean;
	confirmClientRedownload: () => boolean;
	confirmProceedWithoutMusicBrainz: () => boolean;
	refreshAlbumLibraryState?: (options?: { force?: boolean }) => Promise<void>;
	downloadAlbumFn?: typeof downloadAlbum;
	repairAlbumInLibraryFn?: typeof repairAlbumInLibrary;
	fetchImpl?: typeof fetch;
	pollIntervalMs?: number;
};

const DEFAULT_QUEUE_RESET_STATE: AlbumRouteQueueState = {
	queueStatus: 'idle',
	queueJobId: null,
	queueCompletedTracks: 0,
	queueTotalTracks: 0,
	isDownloadingAll: false,
	downloadedCount: 0,
	downloadError: null
};

const DEFAULT_MAINTENANCE_RESET_STATE: AlbumRouteMaintenanceState = {
	isRepairingAlbum: false,
	repairMessage: null
};

export const FORCE_OVERWRITE_CONFIRMATION =
	'This album is already in your local library. Redownload it and overwrite existing files?';
export const CLIENT_REDOWNLOAD_CONFIRMATION =
	'This album is already in your local library. Browser downloads cannot overwrite existing files and may append (2) to filenames. Continue anyway?';
export const MUSICBRAINZ_PENDING_DOWNLOAD_CONFIRMATION =
	'MusicBrainz release matching is still running. Waiting a few seconds can improve tagging metadata. Continue download now?';

function hasActiveQueueDownload(state: AlbumRouteQueueState): boolean {
	return (
		state.queueStatus === 'submitting' ||
		state.queueStatus === 'queued' ||
		state.queueStatus === 'processing'
	);
}

function buildFailedTrackMessage(failedCount: number): string | null {
	if (failedCount <= 0) {
		return null;
	}
	return `${failedCount} track${failedCount > 1 ? 's' : ''} failed after 3 attempts.`;
}

export function buildAlbumCoverUrl(coverId?: string | null): string | undefined {
	if (!coverId || typeof coverId !== 'string') {
		return undefined;
	}
	return `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/1280x1280.jpg`;
}

export function buildAlbumRepairTrackInputs(tracks: Track[]): AlbumRepairTrackInput[] {
	return tracks.map((track) => ({
		trackId: track.id,
		trackTitle: track.version ? `${track.title} (${track.version})` : track.title,
		trackNumber: track.trackNumber,
		durationSeconds: track.duration
	}));
}

export function buildAlbumRepairMessage(
	summary: AlbumRepairResult['summary'] | undefined
): string {
	if (!summary) {
		return 'Album integrity verified: all tracks are complete and healthy.';
	}
	if (summary.queued > 0) {
		return (
			`Queued ${summary.queued} repair download(s): ` +
			`${summary.corrupt} corrupt file(s) targeted.`
		);
	}
	return 'Album integrity verified: all tracks are complete and healthy.';
}

export function createAlbumDownloadController(options: AlbumDownloadControllerOptions) {
	const downloadAlbumFn = options.downloadAlbumFn ?? downloadAlbum;
	const repairAlbumInLibraryFn = options.repairAlbumInLibraryFn ?? repairAlbumInLibrary;
	const fetchImpl = options.fetchImpl ?? fetch;
	const pollIntervalMs = options.pollIntervalMs ?? 1_000;
	let queuePollController: AdaptivePollingController | null = null;
	let queuePollToken = 0;
	let lifecycleToken = 0;

	function isCurrentAlbumContext(albumId: number, token: number): boolean {
		return token === lifecycleToken && options.getCurrentAlbumId() === albumId;
	}

	function stopQueuePolling(): void {
		queuePollToken += 1;
		if (queuePollController) {
			queuePollController.stop();
			queuePollController = null;
		}
	}

	async function refreshAlbumLibraryState(
		albumId: number,
		token: number,
		input?: { force?: boolean }
	): Promise<void> {
		if (!isCurrentAlbumContext(albumId, token)) {
			return;
		}
		try {
			await options.refreshAlbumLibraryState?.(input);
		} catch {
			// Keep the completed queue state even if library-state refresh fails.
		}
	}

	async function pollQueueJob(jobId: string, albumId: number, pollToken: number): Promise<void> {
		if (!jobId || pollToken !== queuePollToken || !isCurrentAlbumContext(albumId, lifecycleToken)) {
			return;
		}
		try {
			const queueState = options.getQueueState();
			const snapshot = await pollAlbumQueueJob({
				jobId,
				currentTotalTracks: queueState.queueTotalTracks,
				fallbackTrackCount: options.getTracks().length,
				fetchImpl
			});
			if (!snapshot || pollToken !== queuePollToken || !isCurrentAlbumContext(albumId, lifecycleToken)) {
				return;
			}

			options.patchQueueState({
				queueTotalTracks: snapshot.totalTracks,
				queueCompletedTracks: snapshot.completedTracks
			});

			switch (snapshot.status) {
				case 'queued':
					options.patchQueueState({
						queueStatus: 'queued',
						downloadError: null
					});
					break;
				case 'processing':
					options.patchQueueState({
						queueStatus: 'processing',
						downloadError: null
					});
					break;
				case 'paused':
					options.patchQueueState({
						queueStatus: 'paused',
						downloadError: null
					});
					stopQueuePolling();
					break;
				case 'completed':
					options.patchQueueState({
						queueStatus: 'completed',
						queueCompletedTracks: snapshot.totalTracks || snapshot.completedTracks,
						queueJobId: null,
						isDownloadingAll: false,
						downloadError: null
					});
					stopQueuePolling();
					await refreshAlbumLibraryState(albumId, lifecycleToken, { force: true });
					break;
				case 'cancelled':
					options.patchQueueState({
						queueStatus: 'cancelled',
						queueJobId: null,
						isDownloadingAll: false,
						downloadError: null
					});
					stopQueuePolling();
					break;
				case 'failed':
					options.patchQueueState({
						queueStatus: 'failed',
						queueJobId: null,
						isDownloadingAll: false,
						downloadError: snapshot.error ?? 'Album download failed.'
					});
					stopQueuePolling();
					break;
				default:
					break;
			}
		} catch {
			// Keep optimistic queue state until a subsequent poll succeeds.
		}
	}

	function startQueuePolling(jobId: string, albumId: number): void {
		stopQueuePolling();
		const pollToken = queuePollToken;
		queuePollController = createAdaptivePollingController({
			run: async () => {
				await pollQueueJob(jobId, albumId, pollToken);
			},
			visibleIntervalMs: pollIntervalMs,
			hiddenIntervalMs: Math.max(pollIntervalMs * 4, pollIntervalMs + 4_000),
			pauseWhenHidden: true
		});
		queuePollController.start();
	}

	function reset(): void {
		lifecycleToken += 1;
		stopQueuePolling();
		options.patchQueueState(DEFAULT_QUEUE_RESET_STATE);
		options.patchMaintenanceState(DEFAULT_MAINTENANCE_RESET_STATE);
	}

	async function cancelQueueDownload(): Promise<void> {
		const albumId = options.getCurrentAlbumId();
		const queueState = options.getQueueState();
		if (!albumId || !queueState.queueJobId) {
			return;
		}
		const currentToken = lifecycleToken;
		try {
			await requestAlbumQueueAction({
				jobId: queueState.queueJobId,
				action: 'cancel',
				fetchImpl
			});
			if (!isCurrentAlbumContext(albumId, currentToken)) {
				return;
			}
			options.patchQueueState({
				queueStatus: 'cancelled',
				queueJobId: null,
				isDownloadingAll: false,
				downloadError: null
			});
			stopQueuePolling();
		} catch (error) {
			if (!isCurrentAlbumContext(albumId, currentToken)) {
				return;
			}
			options.patchQueueState({
				downloadError:
					error instanceof Error && error.message
						? error.message
						: 'Unable to stop this download right now.'
			});
		}
	}

	async function resumeQueueDownload(): Promise<void> {
		const albumId = options.getCurrentAlbumId();
		const queueState = options.getQueueState();
		if (!albumId || queueState.queueStatus !== 'paused' || !queueState.queueJobId) {
			return;
		}
		const currentToken = lifecycleToken;
		try {
			await requestAlbumQueueAction({
				jobId: queueState.queueJobId,
				action: 'resume',
				fetchImpl
			});
			if (!isCurrentAlbumContext(albumId, currentToken)) {
				return;
			}
			options.patchQueueState({
				queueStatus: 'queued',
				downloadError: null
			});
			startQueuePolling(queueState.queueJobId, albumId);
		} catch (error) {
			if (!isCurrentAlbumContext(albumId, currentToken)) {
				return;
			}
			options.patchQueueState({
				downloadError:
					error instanceof Error && error.message
						? error.message
						: 'Unable to resume this download right now.'
			});
		}
	}

	async function handleDownloadAll(): Promise<void> {
		const album = options.getAlbum();
		const tracks = options.getTracks();
		if (!album || tracks.length === 0) {
			return;
		}

		const queueState = options.getQueueState();
		if (isAlbumDownloadQueueActive(queueState.queueStatus)) {
			await cancelQueueDownload();
			return;
		}
		if (queueState.queueStatus === 'paused') {
			await resumeQueueDownload();
			return;
		}

		let forceOverwrite = false;
		const preferences = options.getDownloadPreferences();
		if (
			options.isAlbumInLibrary() &&
			queueState.queueStatus !== 'failed' &&
			queueState.queueStatus !== 'cancelled'
		) {
			if (preferences.storage === 'server') {
				forceOverwrite = options.confirmServerOverwrite();
				if (!forceOverwrite) {
					return;
				}
			} else if (!options.confirmClientRedownload()) {
				return;
			}
		}

		if (queueState.isDownloadingAll || hasActiveQueueDownload(queueState)) {
			return;
		}
		if (
			options.isMusicBrainzReleaseLookupLoading() &&
			!options.getSelectedMusicBrainzReleaseId() &&
			!options.confirmProceedWithoutMusicBrainz()
		) {
			return;
		}

		const currentToken = lifecycleToken;
		const albumId = album.id;
		options.patchQueueState({
			queueStatus: 'submitting',
			queueJobId: null,
			queueCompletedTracks: 0,
			queueTotalTracks: 0,
			isDownloadingAll: true,
			downloadedCount: 0,
			downloadError: null
		});

		try {
			let failedCount = 0;
			const result = await downloadAlbumFn(
				album,
				preferences.quality,
				{
					onTotalResolved: (total) => {
						if (!isCurrentAlbumContext(albumId, currentToken)) {
							return;
						}
						options.patchQueueState({
							queueTotalTracks: total,
							downloadedCount: 0
						});
					},
					onTrackDownloaded: (completed) => {
						if (!isCurrentAlbumContext(albumId, currentToken)) {
							return;
						}
						options.patchQueueState({
							queueStatus: 'processing',
							downloadedCount: completed,
							queueCompletedTracks: completed
						});
					},
					onTrackFailed: (_track, _error, attempt) => {
						if (attempt >= 3) {
							failedCount += 1;
						}
					}
				},
				album.artist?.name,
				{
					mode: preferences.mode,
					convertAacToMp3: preferences.convertAacToMp3,
					experimentalMusicBrainzTagging: preferences.experimentalMusicBrainzTagging,
					strictMusicBrainzMatching: preferences.strictMusicBrainzMatching,
					musicBrainzReleaseId:
						preferences.experimentalMusicBrainzTagging &&
						options.getSelectedMusicBrainzReleaseId()
							? options.getSelectedMusicBrainzReleaseId()
							: undefined,
					storage: preferences.storage,
					forceOverwrite
				}
			);

			if (!isCurrentAlbumContext(albumId, currentToken)) {
				return;
			}

			if (result.storage === 'server' && result.jobId) {
				options.patchQueueState({
					queueStatus: 'queued',
					queueJobId: result.jobId,
					queueTotalTracks: result.totalTracks,
					queueCompletedTracks: 0,
					isDownloadingAll: false,
					downloadError: null
				});
				startQueuePolling(result.jobId, albumId);
				return;
			}

			options.patchQueueState({
				queueJobId: null,
				queueTotalTracks: result.totalTracks,
				queueCompletedTracks: result.completedTracks,
				queueStatus: failedCount > 0 ? 'failed' : 'completed',
				downloadError: buildFailedTrackMessage(failedCount)
			});
			if (result.storage === 'server' && failedCount <= 0) {
				await refreshAlbumLibraryState(albumId, currentToken, { force: true });
			}
		} catch (error) {
			if (!isCurrentAlbumContext(albumId, currentToken)) {
				return;
			}
			console.error('Failed to download album:', error);
			options.patchQueueState({
				queueStatus: 'failed',
				downloadError:
					error instanceof Error && error.message
						? error.message
						: 'Failed to download one or more tracks.'
			});
		} finally {
			if (!isCurrentAlbumContext(albumId, currentToken)) {
				return;
			}
			if (!options.getQueueState().queueJobId) {
				options.patchQueueState({
					isDownloadingAll: false
				});
			}
		}
	}

	async function handleRepairAlbum(): Promise<void> {
		const album = options.getAlbum();
		const tracks = options.getTracks();
		const maintenanceState = options.getMaintenanceState();
		if (!album || tracks.length === 0 || maintenanceState.isRepairingAlbum) {
			return;
		}

		const currentToken = lifecycleToken;
		const albumId = album.id;
		options.patchMaintenanceState({
			isRepairingAlbum: true,
			repairMessage: null
		});
		options.patchQueueState({
			downloadError: null
		});

		try {
			const result = await repairAlbumInLibraryFn({
				albumId: album.id,
				artistName: album.artist?.name,
				albumTitle: album.title,
				quality: options.getDownloadPreferences().quality,
				coverUrl: buildAlbumCoverUrl(album.cover),
				tracks: buildAlbumRepairTrackInputs(tracks)
			});
			if (!isCurrentAlbumContext(albumId, currentToken)) {
				return;
			}
			if (!result.success || !result.summary) {
				throw new Error(result.error || 'Album integrity scan failed');
			}
			options.patchMaintenanceState({
				repairMessage: buildAlbumRepairMessage(result.summary)
			});
			await refreshAlbumLibraryState(albumId, currentToken, { force: true });
		} catch (error) {
			if (!isCurrentAlbumContext(albumId, currentToken)) {
				return;
			}
			options.patchQueueState({
				downloadError:
					error instanceof Error
						? error.message
						: 'Failed to inspect and repair this album.'
			});
		} finally {
			if (!isCurrentAlbumContext(albumId, currentToken)) {
				return;
			}
			options.patchMaintenanceState({
				isRepairingAlbum: false
			});
		}
	}

	function destroy(): void {
		reset();
	}

	return {
		cancelQueueDownload,
		resumeQueueDownload,
		handleDownloadAll,
		handleRepairAlbum,
		reset,
		destroy
	};
}
