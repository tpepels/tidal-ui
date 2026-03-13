import type {
	FullLibraryRepairStatusResult,
	MediaLibraryCorrectAndDeduplicateStatusResult,
	MediaLibraryDeduplicateStatusResult
} from '$lib/utils/mediaLibraryClient';
import { createAdaptivePollingController } from '$lib/utils/adaptivePolling';

type SettingsStatusPollerOptions<TStatus> = {
	fetchStatus: () => Promise<TStatus>;
	isRunningStatus: (status: TStatus) => boolean;
	mapProgress: (status: TStatus) => string;
	onProgress: (message: string) => void;
	intervalMs?: number;
	onError?: (error: unknown) => void;
};

type SettingsStatusPoller = {
	start: () => void;
	stop: () => void;
};

export function createSettingsStatusPoller<TStatus>(
	options: SettingsStatusPollerOptions<TStatus>
): SettingsStatusPoller {
	const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(100, options.intervalMs ?? 1000) : 1000;
	let pollToken = 0;
	let pollController = createAdaptivePollingController({
		run: async () => {
			await runPoll(pollToken);
		},
		visibleIntervalMs: intervalMs,
		hiddenIntervalMs: Math.max(intervalMs * 4, intervalMs + 2_000),
		pauseWhenHidden: true
	});

	const stop = (): void => {
		pollToken += 1;
		pollController.stop();
	};

	const runPoll = async (token: number): Promise<void> => {
		if (token !== pollToken) return;

		try {
			const status = await options.fetchStatus();
			if (token !== pollToken || !options.isRunningStatus(status)) return;

			const message = options.mapProgress(status)?.trim();
			if (!message) return;
			options.onProgress(message);
		} catch (error) {
			options.onError?.(error);
		}
	};

	const start = (): void => {
		stop();
		const token = pollToken;
		pollController = createAdaptivePollingController({
			run: async () => {
				await runPoll(token);
			},
			visibleIntervalMs: intervalMs,
			hiddenIntervalMs: Math.max(intervalMs * 4, intervalMs + 2_000),
			pauseWhenHidden: true
		});
		pollController.start();
	};

	return { start, stop };
}

export function formatFullLibraryRepairProgress(status: FullLibraryRepairStatusResult): string {
	const processed = status.summary?.albumsProcessed ?? 0;
	const discovered = status.summary?.albumsDiscovered ?? 0;
	const currentAlbum = status.currentAlbum;
	const queued = status.summary?.tracksQueued ?? 0;
	const currentLabel =
		currentAlbum && currentAlbum.albumTitle
			? ` Currently: ${currentAlbum.artistName} - ${currentAlbum.albumTitle}.`
			: '';
	return `Scanning library: ${processed}/${discovered} album(s) processed.${currentLabel} Queued ${queued} track repair(s).`;
}

export function formatCorrectionDedupProgress(
	status: MediaLibraryCorrectAndDeduplicateStatusResult
): string {
	if (status.phase === 'sweep') {
		return 'Step 1/2: Sweeping stale publish/backup folders...';
	}
	if (status.phase === 'deduplicate') {
		const progress = status.progress;
		if (!progress) {
			return 'Step 2/2: Deduplicating media library...';
		}
		const current =
			progress.currentArtistDir && progress.currentAlbumDir
				? ` Current: ${progress.currentArtistDir} - ${progress.currentAlbumDir}.`
				: '';
		return `Step 2/2: ${progress.message} (${progress.processed}/${progress.total}).${current}`;
	}
	return 'Running correction sweep + dedupe...';
}

export function formatLibraryDeduplicateProgress(
	status: MediaLibraryDeduplicateStatusResult
): string {
	const progress = status.progress;
	if (!progress) return 'Preparing deduplication...';

	const processed = progress.processed ?? 0;
	const total = progress.total ?? 0;
	const current =
		progress.currentArtistDir && progress.currentAlbumDir
			? ` Current: ${progress.currentArtistDir} - ${progress.currentAlbumDir}.`
			: '';
	const merged = progress.summary?.albumsMerged ?? 0;
	const backedUp = progress.summary?.duplicateFilesBackedUp ?? 0;
	const manualReview = progress.summary?.manualReviewRequired ?? 0;
	return `${progress.message} (${processed}/${total}). Merged ${merged}, backed up ${backedUp}, manual review ${manualReview}.${current}`;
}
