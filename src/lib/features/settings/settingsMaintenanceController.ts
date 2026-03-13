import { deduplicateLibraryInLibrary, repairFullLibraryInLibrary, sweepTemporaryLibraryArtifacts, correctAndDeduplicateLibrary } from '$lib/utils/mediaLibraryClient';
import { toasts } from '$lib/stores/toasts';
import type { AudioQuality } from '$lib/types';

export const settingsMaintenancePrompts = {
	FULL_LIBRARY_REPAIR:
		'Scan your full local library and queue automatic repairs for corrupt tracks only? This can queue many downloads.',
	LIBRARY_TRANSIENT_SWEEP: 'Remove stale temporary publish/backup album folders left from interrupted jobs?',
	LIBRARY_CORRECTION_DEDUP: 'Run correction sweep first and then deduplicate the library in one run?',
	LIBRARY_DEDUP:
		'Merge duplicate album folders and remove duplicate tracks by track number? Duplicates are moved to a backup folder first.'
} as const;

type DownloadLogLevel = 'info' | 'success' | 'warning' | 'error';

type SettingsMaintenanceControllerOptions = {
	confirm: (message: string) => boolean;
	getDownloadQuality: () => AudioQuality;
	isFullLibraryRepairing: () => boolean;
	setFullLibraryRepairing: (value: boolean) => void;
	setFullLibraryRepairSummary: (value: string | null) => void;
	setFullLibraryRepairProgress: (value: string | null) => void;
	startFullLibraryRepairPolling: () => void;
	stopFullLibraryRepairPolling: () => void;
	isLibraryTransientSweeping: () => boolean;
	setLibraryTransientSweeping: (value: boolean) => void;
	setLibraryTransientSweepSummary: (value: string | null) => void;
	isCorrectionDedupRunning: () => boolean;
	setCorrectionDedupRunning: (value: boolean) => void;
	setCorrectionDedupSummary: (value: string | null) => void;
	setCorrectionDedupProgress: (value: string | null) => void;
	startCorrectionDedupPolling: () => void;
	stopCorrectionDedupPolling: () => void;
	isLibraryDeduplicating: () => boolean;
	setLibraryDeduplicating: (value: boolean) => void;
	setLibraryDeduplicateSummary: (value: string | null) => void;
	setLibraryDeduplicateProgress: (value: string | null) => void;
	startLibraryDeduplicatePolling: () => void;
	stopLibraryDeduplicatePolling: () => void;
	resetMaintenanceLogScope: (scope: string) => void;
	logMaintenanceMessage: (
		scope: string,
		message: string,
		level?: DownloadLogLevel,
		dedupe?: boolean
	) => void;
};

export function createSettingsMaintenanceController(options: SettingsMaintenanceControllerOptions) {
	async function handleFullLibraryRepair(): Promise<void> {
		if (options.isFullLibraryRepairing()) return;
		if (!options.confirm(settingsMaintenancePrompts.FULL_LIBRARY_REPAIR)) return;

		options.setFullLibraryRepairing(true);
		options.setFullLibraryRepairSummary(null);
		options.setFullLibraryRepairProgress('Starting full-library integrity scan...');
		options.resetMaintenanceLogScope('Library Repair');
		options.logMaintenanceMessage('Library Repair', 'Starting full-library integrity scan...', 'info', false);
		options.startFullLibraryRepairPolling();

		try {
			const quality = options.getDownloadQuality();
			const result = await repairFullLibraryInLibrary({ quality, queue: true });
			if (!result.success || !result.summary) {
				throw new Error(result.error || 'Failed to auto-repair full library');
			}

			const summary = result.summary;
			const summaryLine = `Scanned ${summary.albumsProcessed}/${summary.albumsDiscovered} album(s); queued ${summary.tracksQueued} repair track(s).`;
			options.setFullLibraryRepairProgress(null);
			options.setFullLibraryRepairSummary(summaryLine);
			toasts.success(summaryLine);
			options.logMaintenanceMessage('Library Repair', summaryLine, 'success');

			if (summary.albumsUnresolved > 0) {
				const warning = `${summary.albumsUnresolved} album(s) could not be confidently matched to TIDAL and were skipped.`;
				toasts.warning(warning);
				options.logMaintenanceMessage('Library Repair', warning, 'warning', false);
			}
			if (summary.albumsErrored > 0) {
				const warning = `${summary.albumsErrored} album(s) failed during auto-repair. Check server logs for details.`;
				toasts.warning(warning);
				options.logMaintenanceMessage('Library Repair', warning, 'warning', false);
			}
		} catch (error) {
			const message =
				error instanceof Error && error.message ? error.message : 'Failed to auto-repair full library';
			options.setFullLibraryRepairProgress(null);
			options.setFullLibraryRepairSummary(null);
			toasts.error(message);
			options.logMaintenanceMessage('Library Repair', message, 'error', false);
		} finally {
			options.stopFullLibraryRepairPolling();
			options.setFullLibraryRepairing(false);
		}
	}

	async function handleSweepTransientArtifacts(): Promise<void> {
		if (options.isLibraryTransientSweeping()) return;
		if (!options.confirm(settingsMaintenancePrompts.LIBRARY_TRANSIENT_SWEEP)) return;

		options.setLibraryTransientSweeping(true);
		options.setLibraryTransientSweepSummary(null);
		options.resetMaintenanceLogScope('Library Sweep');
		options.logMaintenanceMessage('Library Sweep', 'Starting stale publish/backup folder sweep...', 'info', false);

		try {
			const result = await sweepTemporaryLibraryArtifacts({ dryRun: false });
			if (!result.success) throw new Error(result.error || 'Failed to sweep temporary album artifacts');
			const found = result.artifactDirsFound ?? 0;
			const removed = result.artifactDirsRemoved ?? 0;
			const summary =
				`Transient sweep complete: removed ${removed}/${found} temporary folder(s). ` +
				`Skipped active ${result.skippedActive ?? 0}, too fresh ${result.skippedTooFresh ?? 0}.`;
			options.setLibraryTransientSweepSummary(summary);
			toasts.success(summary);
			options.logMaintenanceMessage('Library Sweep', summary, 'success');
			if (result.reportPath) {
				toasts.info(`Sweep report saved to ${result.reportPath}`);
				options.logMaintenanceMessage('Library Sweep', `Report saved to ${result.reportPath}`, 'info', false);
			}
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Failed to sweep temporary album artifacts';
			options.setLibraryTransientSweepSummary(null);
			toasts.error(message);
			options.logMaintenanceMessage('Library Sweep', message, 'error', false);
		} finally {
			options.setLibraryTransientSweeping(false);
		}
	}

	async function handleCorrectionSweepThenDedupe(): Promise<void> {
		if (
			options.isCorrectionDedupRunning() ||
			options.isLibraryTransientSweeping() ||
			options.isLibraryDeduplicating()
		) {
			return;
		}
		if (!options.confirm(settingsMaintenancePrompts.LIBRARY_CORRECTION_DEDUP)) return;

		options.setCorrectionDedupRunning(true);
		options.setCorrectionDedupSummary(null);
		options.setCorrectionDedupProgress('Running correction dry-run...');
		options.resetMaintenanceLogScope('Correction + Dedupe');
		options.logMaintenanceMessage('Correction + Dedupe', 'Running correction dry-run...', 'info', false);
		let executionStarted = false;

		try {
			const preview = await correctAndDeduplicateLibrary({ dryRun: true, forceRescan: true });
			if (!preview.success || !preview.sweep || !preview.deduplicate) {
				throw new Error(preview.error || 'Correction + dedupe dry-run failed');
			}

			const previewFound = preview.sweep.artifactDirsFound ?? 0;
			const previewRemoved = preview.sweep.artifactDirsRemoved ?? 0;
			const previewDedupe = preview.deduplicate;
			const previewSummary =
				`Dry-run plan: sweep ${previewRemoved}/${previewFound} temp folder(s), ` +
				`merge ${previewDedupe.albumsMerged ?? 0} album folder(s), move ${previewDedupe.filesMovedBetweenAlbums ?? 0} file(s), ` +
				`backup ${previewDedupe.duplicateFilesBackedUp ?? 0} duplicate track file(s), ` +
				`manual review ${previewDedupe.manualReviewRequired ?? 0}.`;
			options.logMaintenanceMessage('Correction + Dedupe', previewSummary, 'info', false);
			const plannedChanges =
				(previewDedupe.filesMovedBetweenAlbums ?? 0) + (previewDedupe.duplicateFilesBackedUp ?? 0);

			if (preview.reportPath) {
				toasts.info(`Correction dry-run report saved to ${preview.reportPath}`);
				options.logMaintenanceMessage(
					'Correction + Dedupe',
					`Dry-run report saved to ${preview.reportPath}`,
					'info',
					false
				);
			}

			if (plannedChanges <= 0) {
				options.setCorrectionDedupProgress(null);
				options.setCorrectionDedupSummary(`${previewSummary} No execute pass needed.`);
				toasts.success('Correction dry-run found no actionable changes.');
				options.logMaintenanceMessage(
					'Correction + Dedupe',
					'Dry-run found no actionable changes. Execute pass skipped.',
					'success'
				);
				return;
			}

			if (!options.confirm(`${previewSummary}\n\nRun execute pass now?`)) {
				options.setCorrectionDedupProgress(null);
				options.setCorrectionDedupSummary(`${previewSummary} Execute pass cancelled.`);
				toasts.info('Correction dry-run complete. Execute pass cancelled.');
				options.logMaintenanceMessage(
					'Correction + Dedupe',
					'Execute pass cancelled by user.',
					'warning',
					false
				);
				return;
			}

			options.setCorrectionDedupProgress('Running correction sweep + dedupe...');
			options.logMaintenanceMessage(
				'Correction + Dedupe',
				'Running correction sweep + dedupe...',
				'info',
				false
			);
			options.startCorrectionDedupPolling();
			executionStarted = true;

			const result = await correctAndDeduplicateLibrary({ dryRun: false, forceRescan: true });
			if (!result.success || !result.sweep || !result.deduplicate) {
				throw new Error(result.error || 'Correction + dedupe failed');
			}
			const durationLabel =
				typeof result.durationMs === 'number' && Number.isFinite(result.durationMs)
					? ` in ${Math.max(1, Math.round(result.durationMs / 1000))}s`
					: '';
			const found = result.sweep.artifactDirsFound ?? 0;
			const removed = result.sweep.artifactDirsRemoved ?? 0;
			const dedupeResult = result.deduplicate;
			const summary =
				`Correction + dedupe complete${durationLabel}: swept ${removed}/${found} temp folder(s), ` +
				`merged ${dedupeResult.albumsMerged ?? 0} album folder(s), moved ${dedupeResult.filesMovedBetweenAlbums ?? 0} file(s), ` +
				`and backed up ${dedupeResult.duplicateFilesBackedUp ?? 0} duplicate track file(s). ` +
				`Skipped active ${result.sweep.skippedActive ?? 0}, too fresh ${result.sweep.skippedTooFresh ?? 0}, ` +
				`manual review ${dedupeResult.manualReviewRequired ?? 0}.`;
			options.setCorrectionDedupProgress(null);
			options.setCorrectionDedupSummary(summary);
			toasts.success(summary);
			options.logMaintenanceMessage('Correction + Dedupe', summary, 'success');
			if (result.reportPath) {
				toasts.info(`Correction report saved to ${result.reportPath}`);
				options.logMaintenanceMessage('Correction + Dedupe', `Report saved to ${result.reportPath}`, 'info', false);
			}
			if (dedupeResult.backupRoot) {
				toasts.info(`Duplicate backups saved to ${dedupeResult.backupRoot}`);
				options.logMaintenanceMessage(
					'Correction + Dedupe',
					`Duplicate backups saved to ${dedupeResult.backupRoot}`,
					'info',
					false
				);
			}
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Failed to run correction sweep + dedupe';
			options.setCorrectionDedupProgress(null);
			options.setCorrectionDedupSummary(null);
			toasts.error(message);
			options.logMaintenanceMessage('Correction + Dedupe', message, 'error', false);
		} finally {
			if (executionStarted) options.stopCorrectionDedupPolling();
			options.setCorrectionDedupRunning(false);
		}
	}

	async function handleLibraryDeduplicate(): Promise<void> {
		if (options.isLibraryDeduplicating() || options.isCorrectionDedupRunning()) return;
		if (!options.confirm(settingsMaintenancePrompts.LIBRARY_DEDUP)) return;

		options.setLibraryDeduplicating(true);
		options.setLibraryDeduplicateSummary(null);
		options.setLibraryDeduplicateProgress('Running deduplication dry-run...');
		options.resetMaintenanceLogScope('Library Dedupe');
		options.logMaintenanceMessage('Library Dedupe', 'Running deduplication dry-run...', 'info', false);
		let executionStarted = false;

		try {
			const preview = await deduplicateLibraryInLibrary({ dryRun: true, forceRescan: true });
			if (!preview.success) throw new Error(preview.error || 'Failed to run dedupe dry-run');
			const previewSummary =
				`Dry-run plan: merge ${preview.albumsMerged ?? 0} album folder(s), move ${preview.filesMovedBetweenAlbums ?? 0} file(s), ` +
				`backup ${preview.duplicateFilesBackedUp ?? 0} duplicate track file(s), manual review ${preview.manualReviewRequired ?? 0}.`;
			options.logMaintenanceMessage('Library Dedupe', previewSummary, 'info', false);
			const plannedChanges =
				(preview.filesMovedBetweenAlbums ?? 0) + (preview.duplicateFilesBackedUp ?? 0);
			if (preview.report?.reportPath) {
				toasts.info(`Dedupe dry-run report saved to ${preview.report.reportPath}`);
				options.logMaintenanceMessage(
					'Library Dedupe',
					`Dry-run report saved to ${preview.report.reportPath}`,
					'info',
					false
				);
			}
			if (plannedChanges <= 0) {
				options.setLibraryDeduplicateProgress(null);
				options.setLibraryDeduplicateSummary(`${previewSummary} No execute pass needed.`);
				toasts.success('Dedupe dry-run found no actionable changes.');
				options.logMaintenanceMessage(
					'Library Dedupe',
					'Dry-run found no actionable changes. Execute pass skipped.',
					'success'
				);
				return;
			}
			if (!options.confirm(`${previewSummary}\n\nRun execute pass now?`)) {
				options.setLibraryDeduplicateProgress(null);
				options.setLibraryDeduplicateSummary(`${previewSummary} Execute pass cancelled.`);
				toasts.info('Dedupe dry-run complete. Execute pass cancelled.');
				options.logMaintenanceMessage('Library Dedupe', 'Execute pass cancelled by user.', 'warning', false);
				return;
			}

			options.setLibraryDeduplicateProgress('Starting library deduplication...');
			options.logMaintenanceMessage('Library Dedupe', 'Starting library deduplication...', 'info', false);
			options.startLibraryDeduplicatePolling();
			executionStarted = true;

			const result = await deduplicateLibraryInLibrary({ dryRun: false, forceRescan: true });
			if (!result.success) throw new Error(result.error || 'Failed to deduplicate media library');
			const report = result.report;
			const durationLabel =
				report && Number.isFinite(report.durationMs)
					? ` in ${Math.max(1, Math.round(report.durationMs / 1000))}s`
					: '';
			const summary =
				`Dedupe complete${durationLabel}: scanned ${result.albumsScanned ?? 0} album folder(s), ` +
				`merged ${result.albumsMerged ?? 0}, moved ${result.filesMovedBetweenAlbums ?? 0}, ` +
				`duplicate groups ${result.duplicateTrackGroups ?? 0}, backed up ${result.duplicateFilesBackedUp ?? 0}, ` +
				`move errors ${result.filesMoveErrors ?? 0}, backup errors ${result.backupErrors ?? 0}, manual review ${result.manualReviewRequired ?? 0}.`;
			options.setLibraryDeduplicateProgress(null);
			options.setLibraryDeduplicateSummary(summary);
			toasts.success(summary);
			options.logMaintenanceMessage('Library Dedupe', summary, 'success');
			if (report?.reportPath) {
				toasts.info(`Dedupe report saved to ${report.reportPath}`);
				options.logMaintenanceMessage('Library Dedupe', `Report saved to ${report.reportPath}`, 'info', false);
			}
			if (result.backupRoot) {
				toasts.info(`Duplicate backups saved to ${result.backupRoot}`);
				options.logMaintenanceMessage(
					'Library Dedupe',
					`Duplicate backups saved to ${result.backupRoot}`,
					'info',
					false
				);
			}
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Failed to deduplicate media library';
			options.setLibraryDeduplicateProgress(null);
			options.setLibraryDeduplicateSummary(null);
			toasts.error(message);
			options.logMaintenanceMessage('Library Dedupe', message, 'error', false);
		} finally {
			if (executionStarted) options.stopLibraryDeduplicatePolling();
			options.setLibraryDeduplicating(false);
		}
	}

	return {
		handleFullLibraryRepair,
		handleSweepTransientArtifacts,
		handleCorrectionSweepThenDedupe,
		handleLibraryDeduplicate
	};
}
