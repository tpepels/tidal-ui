import type { DownloadStorage } from '$lib/stores/downloadPreferences';
import type { DownloadOrchestratorOptions } from '../downloadOrchestrator';

export interface UserPreferencesSnapshot {
	convertAacToMp3: boolean;
	downloadCoversSeperately: boolean;
}

export interface DownloadPreferencesSnapshot {
	storage: DownloadStorage;
}

export type ResolvedDownloadOptions = Required<Omit<DownloadOrchestratorOptions, 'signal'>> &
	Pick<DownloadOrchestratorOptions, 'signal'>;

export const resolveDownloadOptions = (
	options: DownloadOrchestratorOptions | undefined,
	userPrefs: UserPreferencesSnapshot,
	downloadPrefs: DownloadPreferencesSnapshot
): ResolvedDownloadOptions => ({
	quality: options?.quality ?? 'LOSSLESS',
	convertAacToMp3: options?.convertAacToMp3 ?? userPrefs.convertAacToMp3,
	downloadCoversSeperately: options?.downloadCoversSeperately ?? userPrefs.downloadCoversSeperately,
	autoConvertSonglink: options?.autoConvertSonglink ?? true,
	notificationMode: options?.notificationMode ?? 'alert',
	subtitle: options?.subtitle ?? '',
	ffmpegAutoTriggered: options?.ffmpegAutoTriggered ?? false,
	skipFfmpegCountdown: options?.skipFfmpegCountdown ?? false,
	useCoordinator: options?.useCoordinator ?? false,
	storage: options?.storage ?? downloadPrefs.storage,
	conflictResolution: options?.conflictResolution ?? 'overwrite_if_different',
	signal: options?.signal
});
