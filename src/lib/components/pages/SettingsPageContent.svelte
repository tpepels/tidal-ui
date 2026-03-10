<script lang="ts">
	import { get } from 'svelte/store';
	import { toasts } from '$lib/stores/toasts';
	import { machineCurrentTrack, machineQueue } from '$lib/stores/playerDerived';
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { downloadLogStore } from '$lib/stores/downloadLog';
	import { artistCacheStore } from '$lib/stores/artistCache';
	import {
		downloadPreferencesStore,
		type DownloadMode,
		type DownloadStorage
	} from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
	import {
		sanitizeForFilename,
		getExtensionForQuality,
		buildTrackLinksCsv,
		downloadTrackToServer,
		type ServerDownloadProgress
	} from '$lib/downloads';
	import { formatArtists } from '$lib/utils/formatters';
	import {
		correctAndDeduplicateLibrary,
		deduplicateLibraryInLibrary,
		fetchCorrectAndDeduplicateStatus,
		fetchLibraryDeduplicateStatus,
		fetchFullLibraryRepairStatus,
		repairFullLibraryInLibrary,
		sweepTemporaryLibraryArtifacts
	} from '$lib/utils/mediaLibraryClient';
	import { type Track, type AudioQuality, type PlayableTrack, isSonglinkTrack } from '$lib/types';
	import {
		Archive,
		FileSpreadsheet,
		LoaderCircle,
		Download,
		Check,
		Trash2,
		Activity
	} from 'lucide-svelte';
	import ApiTargetsStatusCard from '$lib/components/status/ApiTargetsStatusCard.svelte';
	import { onDestroy } from 'svelte';

	const MAX_QUEUE_ZIP_TRACKS = 75;
	const FULL_LIBRARY_REPAIR_CONFIRMATION =
		'Scan your full local library and queue automatic repairs for corrupt tracks only? This can queue many downloads.';
	const LIBRARY_TRANSIENT_SWEEP_CONFIRMATION =
		'Remove stale temporary publish/backup album folders left from interrupted jobs?';
	const LIBRARY_CORRECTION_DEDUP_CONFIRMATION =
		'Run correction sweep first and then deduplicate the library in one run?';
	const LIBRARY_DEDUP_CONFIRMATION =
		'Merge duplicate album folders and remove duplicate tracks by track number? Duplicates are moved to a backup folder first.';

	let isZipDownloading = $state(false);
	let isCsvExporting = $state(false);
	let isLegacyQueueDownloading = $state(false);
	let isCacheClearing = $state(false);
	let isLibraryTransientSweeping = $state(false);
	let libraryTransientSweepSummary = $state<string | null>(null);
	let isCorrectionDedupRunning = $state(false);
	let correctionDedupSummary = $state<string | null>(null);
	let correctionDedupProgress = $state<string | null>(null);
	let correctionDedupPollInterval = $state<ReturnType<typeof setInterval> | null>(null);
	let correctionDedupPollToken = $state(0);
	let isFullLibraryRepairing = $state(false);
	let fullLibraryRepairSummary = $state<string | null>(null);
	let fullLibraryRepairProgress = $state<string | null>(null);
	let isLibraryDeduplicating = $state(false);
	let libraryDeduplicateSummary = $state<string | null>(null);
	let libraryDeduplicateProgress = $state<string | null>(null);
	let libraryDeduplicatePollInterval = $state<ReturnType<typeof setInterval> | null>(null);
	let libraryDeduplicatePollToken = $state(0);
	let fullLibraryRepairPollInterval = $state<ReturnType<typeof setInterval> | null>(null);
	let fullLibraryRepairPollToken = $state(0);
	let statusPollInterval: ReturnType<typeof setInterval> | null = null;
	let apiTargetsStatusLoading = $state(false);
	let statusTargets = $state<{
		success?: boolean;
		source?: string;
		targetCount?: number;
		lastSuccessfulRefreshIso?: string | null;
		error?: string | null;
		targets?: Array<{ name: string; baseUrl: string; weight: number }>;
		refresh?: {
			updated?: boolean;
			count?: number;
			source?: string;
			lastUpdated?: string;
		};
	} | null>(null);
	let statusLastUpdatedAt = $state<number | null>(null);

	type DownloadLogLevel = 'info' | 'success' | 'warning' | 'error';
	const maintenanceLogLastByScope: Record<string, string> = {};

	const downloadMode = $derived($downloadPreferencesStore.mode);
	const isServerStorage = $derived($downloadPreferencesStore.storage === 'server');
	const queueActionBusy = $derived(
		downloadMode === 'zip'
			? Boolean(isZipDownloading || isLegacyQueueDownloading || isCsvExporting)
			: downloadMode === 'csv'
				? Boolean(isCsvExporting)
				: Boolean(isLegacyQueueDownloading)
	);
	const convertAacToMp3 = $derived($userPreferencesStore.convertAacToMp3);
	const downloadCoversSeperately = $derived($userPreferencesStore.downloadCoversSeperately);
	const experimentalMusicBrainzTagging = $derived(
		$userPreferencesStore.experimentalMusicBrainzTagging
	);

	const QUALITY_OPTIONS: Array<{
		value: AudioQuality;
		label: string;
		description: string;
		disabled?: boolean;
	}> = [
		{
			value: 'HI_RES_LOSSLESS',
			label: 'Hi-Res',
			description: '24-bit FLAC (DASH) up to 192 kHz',
			disabled: false
		},
		{
			value: 'LOSSLESS',
			label: 'CD Lossless',
			description: '16-bit / 44.1 kHz FLAC'
		},
		{
			value: 'HIGH',
			label: '320kbps AAC',
			description: 'High quality AAC streaming'
		},
		{
			value: 'LOW',
			label: '96kbps AAC',
			description: 'Data saver AAC streaming'
		}
	];

	const PERFORMANCE_OPTIONS: Array<{
		value: 'medium' | 'low';
		label: string;
		description: string;
	}> = [
		{
			value: 'medium',
			label: 'Balanced',
			description: 'Smooth animations with visual effects'
		},
		{
			value: 'low',
			label: 'Performance',
			description: 'Minimal effects for better performance'
		}
	];

	$effect(() => {
		if (isServerStorage && downloadMode !== 'individual') {
			downloadPreferencesStore.setMode('individual');
		}
	});

	$effect(() => {
		void refreshTargetsStatus();
		if (statusPollInterval) {
			clearInterval(statusPollInterval);
		}
		statusPollInterval = setInterval(() => {
			void refreshTargetsStatus();
		}, 15000);
		return () => {
			if (statusPollInterval) {
				clearInterval(statusPollInterval);
				statusPollInterval = null;
			}
		};
	});

	onDestroy(() => {
		stopCorrectionDedupPolling();
		stopFullLibraryRepairPolling();
		stopLibraryDeduplicatePolling();
		if (statusPollInterval) {
			clearInterval(statusPollInterval);
			statusPollInterval = null;
		}
	});

	function resetMaintenanceLogScope(scope: string): void {
		delete maintenanceLogLastByScope[scope];
	}

	function logMaintenanceMessage(
		scope: string,
		message: string,
		level: DownloadLogLevel = 'info',
		dedupe: boolean = true
	): void {
		const normalized = message.trim();
		if (!normalized) return;
		if (dedupe && maintenanceLogLastByScope[scope] === normalized) return;
		maintenanceLogLastByScope[scope] = normalized;
		const formatted = `[${scope}] ${normalized}`;
		switch (level) {
			case 'success':
				downloadLogStore.success(formatted);
				return;
			case 'warning':
				downloadLogStore.warning(formatted);
				return;
			case 'error':
				downloadLogStore.error(formatted);
				return;
			default:
				downloadLogStore.log(formatted);
		}
	}

	function selectDownloadQuality(quality: AudioQuality): void {
		downloadPreferencesStore.setDownloadQuality(quality);
	}

	function toggleAacConversion(): void {
		userPreferencesStore.toggleConvertAacToMp3();
	}

	function toggleDownloadCoversSeperately(): void {
		userPreferencesStore.toggleDownloadCoversSeperately();
	}

	function toggleExperimentalMusicBrainzTagging(): void {
		userPreferencesStore.toggleExperimentalMusicBrainzTagging();
	}

	function setDownloadMode(mode: DownloadMode): void {
		downloadPreferencesStore.setMode(mode);
	}

	function setDownloadStorage(storage: DownloadStorage): void {
		downloadPreferencesStore.setStorage(storage);
	}

	function setPerformanceMode(mode: 'medium' | 'low'): void {
		userPreferencesStore.setPerformanceMode(mode);
	}

	async function handleClearCaches(): Promise<void> {
		if (isCacheClearing) return;
		isCacheClearing = true;

		try {
			artistCacheStore.clear();
			if (typeof window !== 'undefined' && 'caches' in window) {
				const cacheKeys = await window.caches.keys();
				await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)));
			}

			const response = await fetch('/api/cache/clear', { method: 'POST' });
			if (!response.ok) {
				throw new Error(`Server cache clear failed (${response.status})`);
			}

			const payload = (await response.json()) as {
				cleared?: {
					officialMemoryCleared?: number;
					officialRedisCleared?: number;
					proxyRedisCleared?: number;
				};
			};
			const official = payload.cleared?.officialMemoryCleared ?? 0;
			const officialRedis = payload.cleared?.officialRedisCleared ?? 0;
			const proxyRedis = payload.cleared?.proxyRedisCleared ?? 0;
			toasts.success(
				`Caches cleared (artist: ${official}, official Redis: ${officialRedis}, proxy Redis: ${proxyRedis}).`
			);
		} catch (error) {
			console.error('Failed to clear caches:', error);
			toasts.error('Failed to clear caches. Check server logs for details.');
		} finally {
			isCacheClearing = false;
		}
	}

	function stopFullLibraryRepairPolling(): void {
		fullLibraryRepairPollToken += 1;
		if (fullLibraryRepairPollInterval) {
			clearInterval(fullLibraryRepairPollInterval);
			fullLibraryRepairPollInterval = null;
		}
	}

	function formatFullLibraryRepairProgress(status: {
		currentAlbum?: { index: number; total: number; artistName: string; albumTitle: string } | null;
		summary?: { albumsProcessed: number; albumsDiscovered: number; tracksQueued: number };
	}): string {
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

	async function pollFullLibraryRepairStatus(token: number): Promise<void> {
		if (token !== fullLibraryRepairPollToken) return;
		const status = await fetchFullLibraryRepairStatus();
		if (token !== fullLibraryRepairPollToken || !status.success) return;
		if (status.status === 'running') {
			fullLibraryRepairProgress = formatFullLibraryRepairProgress(status);
			logMaintenanceMessage('Library Repair', fullLibraryRepairProgress);
		}
	}

	function startFullLibraryRepairPolling(): void {
		stopFullLibraryRepairPolling();
		const token = fullLibraryRepairPollToken;
		void pollFullLibraryRepairStatus(token);
		fullLibraryRepairPollInterval = setInterval(() => {
			void pollFullLibraryRepairStatus(token);
		}, 1000);
	}

	async function handleFullLibraryRepair(): Promise<void> {
		if (isFullLibraryRepairing) return;
		if (typeof window !== 'undefined') {
			const confirmed = window.confirm(FULL_LIBRARY_REPAIR_CONFIRMATION);
			if (!confirmed) return;
		}
		isFullLibraryRepairing = true;
		fullLibraryRepairSummary = null;
		fullLibraryRepairProgress = 'Starting full-library integrity scan...';
		resetMaintenanceLogScope('Library Repair');
		logMaintenanceMessage('Library Repair', fullLibraryRepairProgress, 'info', false);
		startFullLibraryRepairPolling();

		try {
			const quality = get(downloadPreferencesStore).downloadQuality;
			const result = await repairFullLibraryInLibrary({ quality, queue: true });
			if (!result.success || !result.summary) {
				throw new Error(result.error || 'Failed to auto-repair full library');
			}

			const summary = result.summary;
			const summaryLine = `Scanned ${summary.albumsProcessed}/${summary.albumsDiscovered} album(s); queued ${summary.tracksQueued} repair track(s).`;
			fullLibraryRepairProgress = null;
			fullLibraryRepairSummary = summaryLine;
			toasts.success(summaryLine);
			logMaintenanceMessage('Library Repair', summaryLine, 'success');
			if (summary.albumsUnresolved > 0) {
				const warning = `${summary.albumsUnresolved} album(s) could not be confidently matched to TIDAL and were skipped.`;
				toasts.warning(warning);
				logMaintenanceMessage('Library Repair', warning, 'warning', false);
			}
			if (summary.albumsErrored > 0) {
				const warning = `${summary.albumsErrored} album(s) failed during auto-repair. Check server logs for details.`;
				toasts.warning(warning);
				logMaintenanceMessage('Library Repair', warning, 'warning', false);
			}
		} catch (error) {
			const message =
				error instanceof Error && error.message ? error.message : 'Failed to auto-repair full library';
			fullLibraryRepairProgress = null;
			fullLibraryRepairSummary = null;
			toasts.error(message);
			logMaintenanceMessage('Library Repair', message, 'error', false);
		} finally {
			stopFullLibraryRepairPolling();
			isFullLibraryRepairing = false;
		}
	}

	async function handleSweepTransientArtifacts(): Promise<void> {
		if (isLibraryTransientSweeping) return;
		if (typeof window !== 'undefined') {
			const confirmed = window.confirm(LIBRARY_TRANSIENT_SWEEP_CONFIRMATION);
			if (!confirmed) return;
		}
		isLibraryTransientSweeping = true;
		libraryTransientSweepSummary = null;
		resetMaintenanceLogScope('Library Sweep');
		logMaintenanceMessage('Library Sweep', 'Starting stale publish/backup folder sweep...', 'info', false);

		try {
			const result = await sweepTemporaryLibraryArtifacts({ dryRun: false });
			if (!result.success) throw new Error(result.error || 'Failed to sweep temporary album artifacts');
			const found = result.artifactDirsFound ?? 0;
			const removed = result.artifactDirsRemoved ?? 0;
			const summary =
				`Transient sweep complete: removed ${removed}/${found} temporary folder(s). ` +
				`Skipped active ${result.skippedActive ?? 0}, too fresh ${result.skippedTooFresh ?? 0}.`;
			libraryTransientSweepSummary = summary;
			toasts.success(summary);
			logMaintenanceMessage('Library Sweep', summary, 'success');
			if (result.reportPath) {
				toasts.info(`Sweep report saved to ${result.reportPath}`);
				logMaintenanceMessage('Library Sweep', `Report saved to ${result.reportPath}`, 'info', false);
			}
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Failed to sweep temporary album artifacts';
			libraryTransientSweepSummary = null;
			toasts.error(message);
			logMaintenanceMessage('Library Sweep', message, 'error', false);
		} finally {
			isLibraryTransientSweeping = false;
		}
	}

	async function handleCorrectionSweepThenDedupe(): Promise<void> {
		if (isCorrectionDedupRunning || isLibraryTransientSweeping || isLibraryDeduplicating) return;
		if (typeof window !== 'undefined') {
			const confirmed = window.confirm(LIBRARY_CORRECTION_DEDUP_CONFIRMATION);
			if (!confirmed) return;
		}
		isCorrectionDedupRunning = true;
		correctionDedupSummary = null;
		correctionDedupProgress = 'Running correction dry-run...';
		resetMaintenanceLogScope('Correction + Dedupe');
		logMaintenanceMessage('Correction + Dedupe', correctionDedupProgress, 'info', false);
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
			logMaintenanceMessage('Correction + Dedupe', previewSummary, 'info', false);
			const plannedChanges =
				(previewDedupe.filesMovedBetweenAlbums ?? 0) + (previewDedupe.duplicateFilesBackedUp ?? 0);

			if (preview.reportPath) {
				toasts.info(`Correction dry-run report saved to ${preview.reportPath}`);
				logMaintenanceMessage('Correction + Dedupe', `Dry-run report saved to ${preview.reportPath}`, 'info', false);
			}

			if (plannedChanges <= 0) {
				correctionDedupProgress = null;
				correctionDedupSummary = `${previewSummary} No execute pass needed.`;
				toasts.success('Correction dry-run found no actionable changes.');
				logMaintenanceMessage('Correction + Dedupe', 'Dry-run found no actionable changes. Execute pass skipped.', 'success');
				return;
			}

			let executeNow = true;
			if (typeof window !== 'undefined') {
				executeNow = window.confirm(`${previewSummary}\n\nRun execute pass now?`);
			}
			if (!executeNow) {
				correctionDedupProgress = null;
				correctionDedupSummary = `${previewSummary} Execute pass cancelled.`;
				toasts.info('Correction dry-run complete. Execute pass cancelled.');
				logMaintenanceMessage('Correction + Dedupe', 'Execute pass cancelled by user.', 'warning', false);
				return;
			}

			correctionDedupProgress = 'Running correction sweep + dedupe...';
			logMaintenanceMessage('Correction + Dedupe', correctionDedupProgress, 'info', false);
			startCorrectionDedupPolling();
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
			correctionDedupProgress = null;
			correctionDedupSummary = summary;
			toasts.success(summary);
			logMaintenanceMessage('Correction + Dedupe', summary, 'success');
			if (result.reportPath) {
				toasts.info(`Correction report saved to ${result.reportPath}`);
				logMaintenanceMessage('Correction + Dedupe', `Report saved to ${result.reportPath}`, 'info', false);
			}
			if (dedupeResult.backupRoot) {
				toasts.info(`Duplicate backups saved to ${dedupeResult.backupRoot}`);
				logMaintenanceMessage('Correction + Dedupe', `Duplicate backups saved to ${dedupeResult.backupRoot}`, 'info', false);
			}
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Failed to run correction sweep + dedupe';
			correctionDedupProgress = null;
			correctionDedupSummary = null;
			toasts.error(message);
			logMaintenanceMessage('Correction + Dedupe', message, 'error', false);
		} finally {
			if (executionStarted) stopCorrectionDedupPolling();
			isCorrectionDedupRunning = false;
		}
	}

	function stopCorrectionDedupPolling(): void {
		correctionDedupPollToken += 1;
		if (correctionDedupPollInterval) {
			clearInterval(correctionDedupPollInterval);
			correctionDedupPollInterval = null;
		}
	}

	function formatCorrectionDedupProgress(status: {
		phase?: 'idle' | 'sweep' | 'deduplicate' | 'completed' | 'failed';
		progress?: {
			message: string;
			processed: number;
			total: number;
			currentArtistDir?: string;
			currentAlbumDir?: string;
		} | null;
	}): string {
		if (status.phase === 'sweep') return 'Step 1/2: Sweeping stale publish/backup folders...';
		if (status.phase === 'deduplicate') {
			const progress = status.progress;
			if (!progress) return 'Step 2/2: Deduplicating media library...';
			const current =
				progress.currentArtistDir && progress.currentAlbumDir
					? ` Current: ${progress.currentArtistDir} - ${progress.currentAlbumDir}.`
					: '';
			return `Step 2/2: ${progress.message} (${progress.processed}/${progress.total}).${current}`;
		}
		return 'Running correction sweep + dedupe...';
	}

	async function pollCorrectionDedupStatus(token: number): Promise<void> {
		if (token !== correctionDedupPollToken) return;
		const status = await fetchCorrectAndDeduplicateStatus();
		if (token !== correctionDedupPollToken || !status.success) return;
		if (status.status === 'running') {
			correctionDedupProgress = formatCorrectionDedupProgress(status);
			logMaintenanceMessage('Correction + Dedupe', correctionDedupProgress);
		}
	}

	function startCorrectionDedupPolling(): void {
		stopCorrectionDedupPolling();
		const token = correctionDedupPollToken;
		void pollCorrectionDedupStatus(token);
		correctionDedupPollInterval = setInterval(() => {
			void pollCorrectionDedupStatus(token);
		}, 1000);
	}

	async function handleLibraryDeduplicate(): Promise<void> {
		if (isLibraryDeduplicating || isCorrectionDedupRunning) return;
		if (typeof window !== 'undefined') {
			const confirmed = window.confirm(LIBRARY_DEDUP_CONFIRMATION);
			if (!confirmed) return;
		}

		isLibraryDeduplicating = true;
		libraryDeduplicateSummary = null;
		libraryDeduplicateProgress = 'Running deduplication dry-run...';
		resetMaintenanceLogScope('Library Dedupe');
		logMaintenanceMessage('Library Dedupe', libraryDeduplicateProgress, 'info', false);
		let executionStarted = false;

		try {
			const preview = await deduplicateLibraryInLibrary({ dryRun: true, forceRescan: true });
			if (!preview.success) throw new Error(preview.error || 'Failed to run dedupe dry-run');
			const previewSummary =
				`Dry-run plan: merge ${preview.albumsMerged ?? 0} album folder(s), move ${preview.filesMovedBetweenAlbums ?? 0} file(s), ` +
				`backup ${preview.duplicateFilesBackedUp ?? 0} duplicate track file(s), manual review ${preview.manualReviewRequired ?? 0}.`;
			logMaintenanceMessage('Library Dedupe', previewSummary, 'info', false);
			const plannedChanges = (preview.filesMovedBetweenAlbums ?? 0) + (preview.duplicateFilesBackedUp ?? 0);
			if (preview.report?.reportPath) {
				toasts.info(`Dedupe dry-run report saved to ${preview.report.reportPath}`);
				logMaintenanceMessage('Library Dedupe', `Dry-run report saved to ${preview.report.reportPath}`, 'info', false);
			}
			if (plannedChanges <= 0) {
				libraryDeduplicateProgress = null;
				libraryDeduplicateSummary = `${previewSummary} No execute pass needed.`;
				toasts.success('Dedupe dry-run found no actionable changes.');
				logMaintenanceMessage('Library Dedupe', 'Dry-run found no actionable changes. Execute pass skipped.', 'success');
				return;
			}
			let executeNow = true;
			if (typeof window !== 'undefined') executeNow = window.confirm(`${previewSummary}\n\nRun execute pass now?`);
			if (!executeNow) {
				libraryDeduplicateProgress = null;
				libraryDeduplicateSummary = `${previewSummary} Execute pass cancelled.`;
				toasts.info('Dedupe dry-run complete. Execute pass cancelled.');
				logMaintenanceMessage('Library Dedupe', 'Execute pass cancelled by user.', 'warning', false);
				return;
			}

			libraryDeduplicateProgress = 'Starting library deduplication...';
			logMaintenanceMessage('Library Dedupe', libraryDeduplicateProgress, 'info', false);
			startLibraryDeduplicatePolling();
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
			libraryDeduplicateProgress = null;
			libraryDeduplicateSummary = summary;
			toasts.success(summary);
			logMaintenanceMessage('Library Dedupe', summary, 'success');
			if (report?.reportPath) {
				toasts.info(`Dedupe report saved to ${report.reportPath}`);
				logMaintenanceMessage('Library Dedupe', `Report saved to ${report.reportPath}`, 'info', false);
			}
			if (result.backupRoot) {
				toasts.info(`Duplicate backups saved to ${result.backupRoot}`);
				logMaintenanceMessage('Library Dedupe', `Duplicate backups saved to ${result.backupRoot}`, 'info', false);
			}
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Failed to deduplicate media library';
			libraryDeduplicateProgress = null;
			libraryDeduplicateSummary = null;
			toasts.error(message);
			logMaintenanceMessage('Library Dedupe', message, 'error', false);
		} finally {
			if (executionStarted) stopLibraryDeduplicatePolling();
			isLibraryDeduplicating = false;
		}
	}

	function stopLibraryDeduplicatePolling(): void {
		libraryDeduplicatePollToken += 1;
		if (libraryDeduplicatePollInterval) {
			clearInterval(libraryDeduplicatePollInterval);
			libraryDeduplicatePollInterval = null;
		}
	}

	function formatLibraryDeduplicateProgress(status: {
		progress?: {
			message: string;
			processed: number;
			total: number;
			currentArtistDir?: string;
			currentAlbumDir?: string;
			summary?: {
				albumsMerged?: number;
				duplicateFilesBackedUp?: number;
				manualReviewRequired?: number;
			};
		} | null;
	}): string {
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

	async function pollLibraryDeduplicateStatus(token: number): Promise<void> {
		if (token !== libraryDeduplicatePollToken) return;
		const status = await fetchLibraryDeduplicateStatus();
		if (token !== libraryDeduplicatePollToken || !status.success) return;
		if (status.status === 'running') {
			libraryDeduplicateProgress = formatLibraryDeduplicateProgress(status);
			logMaintenanceMessage('Library Dedupe', libraryDeduplicateProgress);
		}
	}

	function startLibraryDeduplicatePolling(): void {
		stopLibraryDeduplicatePolling();
		const token = libraryDeduplicatePollToken;
		void pollLibraryDeduplicateStatus(token);
		libraryDeduplicatePollInterval = setInterval(() => {
			void pollLibraryDeduplicateStatus(token);
		}, 1000);
	}

	async function refreshTargetsStatus(forceRefresh = false): Promise<void> {
		apiTargetsStatusLoading = true;
		const existing = statusTargets;
		try {
			const suffix = forceRefresh ? '?refresh=1' : '';
			const response = await fetch(`/api/targets/status${suffix}`);
			if (!response.ok) throw new Error(`Failed to fetch API target status (${response.status})`);
			statusTargets = (await response.json()) as typeof statusTargets;
			statusLastUpdatedAt = Date.now();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to fetch API target status';
			statusTargets = existing
				? { ...existing, success: false, error: message }
				: { success: false, source: 'unknown', targetCount: 0, error: message, targets: [] };
		} finally {
			apiTargetsStatusLoading = false;
		}
	}

	function collectQueueState(): { tracks: PlayableTrack[]; quality: AudioQuality } {
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

	function buildQueueFilename(track: PlayableTrack, index: number, quality: AudioQuality): string {
		const ext = getExtensionForQuality(quality, convertAacToMp3 && !isServerStorage);
		const order = `${index + 1}`.padStart(2, '0');
		const artistName = sanitizeForFilename(
			isSonglinkTrack(track) ? track.artistName : formatArtists(track.artists)
		);
		const titleName = sanitizeForFilename(track.title ?? `Track ${order}`);
		return `${order} - ${artistName} - ${titleName}.${ext}`;
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

	async function downloadQueueAsZip(tracks: PlayableTrack[], quality: AudioQuality): Promise<void> {
		isZipDownloading = true;
		try {
			const exportableTracks = filterExportableQueueTracks(tracks);
			if (exportableTracks.length === 0) {
				toasts.warning('No exportable TIDAL tracks in the queue.');
				return;
			}
			if (exportableTracks.length > MAX_QUEUE_ZIP_TRACKS) {
				toasts.warning(`ZIP export is limited to ${MAX_QUEUE_ZIP_TRACKS} tracks to avoid memory issues.`);
				return;
			}
			const { default: JSZip } = await import('jszip');
			const zip = new JSZip();
			for (const [index, track] of exportableTracks.entries()) {
				const filename = buildQueueFilename(track, index, quality);
				const { blob } = await losslessAPI.fetchTrackBlob(track.id, quality, filename, {
					ffmpegAutoTriggered: false,
					convertAacToMp3,
					enableExperimentalMusicBrainz: experimentalMusicBrainzTagging
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
			isZipDownloading = false;
		}
	}

	async function exportQueueAsCsv(tracks: PlayableTrack[], quality: AudioQuality): Promise<void> {
		isCsvExporting = true;
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
			isCsvExporting = false;
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

	async function downloadQueueIndividually(tracks: PlayableTrack[], quality: AudioQuality): Promise<void> {
		if (isLegacyQueueDownloading) return;
		isLegacyQueueDownloading = true;
		const errors: string[] = [];
		const storage = get(downloadPreferencesStore).storage;

		try {
			for (const [index, track] of tracks.entries()) {
				const trackId = isSonglinkTrack(track) ? track.tidalId : track.id;
				if (!trackId) continue;
				const filename = buildQueueFilename(track, index, quality);
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
							downloadCoverSeperately: downloadCoversSeperately,
							experimentalMusicBrainzTagging,
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
						downloadCoverSeperately: downloadCoversSeperately,
						enableExperimentalMusicBrainz: experimentalMusicBrainzTagging
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
			isLegacyQueueDownloading = false;
		}
	}

	async function handleQueueDownload(): Promise<void> {
		if (queueActionBusy) return;
		const { tracks, quality } = collectQueueState();
		const storage = get(downloadPreferencesStore).storage;
		if (tracks.length === 0) {
			toasts.warning('Add tracks to the queue before downloading.');
			return;
		}
		if (storage === 'server' && downloadMode !== 'individual') {
			setDownloadMode('individual');
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
</script>

<div class="settings-grid settings-grid--page">
	<section class="settings-section settings-section--wide">
		<p class="section-heading">Streaming & Downloads</p>
		<div class="option-grid">
			{#each QUALITY_OPTIONS as option (option.value)}
				<button
					type="button"
					onclick={() => selectDownloadQuality(option.value)}
					class={`glass-option ${option.value === $downloadPreferencesStore.downloadQuality ? 'is-active' : ''} ${option.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
					aria-pressed={option.value === $downloadPreferencesStore.downloadQuality}
					disabled={option.disabled}
				>
					<div class="glass-option__content">
						<span class="glass-option__label">{option.label}</span>
						<span class="glass-option__description">{option.description}</span>
					</div>
					{#if option.value === $downloadPreferencesStore.downloadQuality}
						<Check size={16} class="glass-option__check" />
					{/if}
				</button>
			{/each}
		</div>
	</section>
	<section class="settings-section">
		<p class="section-heading">Conversions</p>
		<button
			type="button"
			onclick={toggleAacConversion}
			class={`glass-option ${convertAacToMp3 ? 'is-active' : ''} ${isServerStorage ? 'cursor-not-allowed opacity-50' : ''}`}
			aria-pressed={convertAacToMp3}
			disabled={isServerStorage}
		>
			<span class="glass-option__content">
				<span class="glass-option__label">Convert AAC downloads to MP3</span>
				<span class="glass-option__description">
					{isServerStorage
						? 'Client-only. Server downloads keep the original AAC codec.'
						: 'Applies to 320kbps and 96kbps downloads.'}
				</span>
			</span>
			<span class={`glass-option__chip ${convertAacToMp3 ? 'is-active' : ''}`}>
				{convertAacToMp3 ? 'On' : 'Off'}
			</span>
		</button>
		<button
			type="button"
			onclick={toggleDownloadCoversSeperately}
			class={`glass-option ${downloadCoversSeperately ? 'is-active' : ''} ${isServerStorage ? 'cursor-not-allowed opacity-50' : ''}`}
			aria-pressed={downloadCoversSeperately}
			disabled={isServerStorage}
		>
			<span class="glass-option__content">
				<span class="glass-option__label">Download covers separately</span>
				<span class="glass-option__description">
					{isServerStorage
						? 'Server downloads store cover art next to audio files.'
						: 'Save cover.jpg alongside audio files.'}
				</span>
			</span>
			<span class={`glass-option__chip ${downloadCoversSeperately ? 'is-active' : ''}`}>
				{downloadCoversSeperately ? 'On' : 'Off'}
			</span>
		</button>
		<button
			type="button"
			onclick={toggleExperimentalMusicBrainzTagging}
			class={`glass-option ${experimentalMusicBrainzTagging ? 'is-active' : ''}`}
			aria-pressed={experimentalMusicBrainzTagging}
		>
			<span class="glass-option__content">
				<span class="glass-option__label">Experimental: MusicBrainz tagging & lookup</span>
				<span class="glass-option__description">
					Attempt MusicBrainz lookups for album/track IDs and embed extra release metadata. May
					add latency or occasional mismatches.
				</span>
			</span>
			<span class={`glass-option__chip ${experimentalMusicBrainzTagging ? 'is-active' : ''}`}>
				{experimentalMusicBrainzTagging ? 'On' : 'Off'}
			</span>
		</button>
	</section>
	<section class="settings-section">
		<p class="section-heading">Queue exports</p>
		<div class="option-grid option-grid--compact">
			<button
				type="button"
				onclick={() => setDownloadMode('individual')}
				class={`glass-option glass-option--compact ${downloadMode === 'individual' ? 'is-active' : ''}`}
				aria-pressed={downloadMode === 'individual'}
			>
				<span class="glass-option__content">
					<span class="glass-option__label">
						<Download size={16} />
						<span>Individual files</span>
					</span>
				</span>
				{#if downloadMode === 'individual'}
					<Check size={14} class="glass-option__check" />
				{/if}
			</button>
			<button
				type="button"
				onclick={() => setDownloadMode('zip')}
				class={`glass-option glass-option--compact ${downloadMode === 'zip' ? 'is-active' : ''} ${isServerStorage ? 'cursor-not-allowed opacity-50' : ''}`}
				aria-pressed={downloadMode === 'zip'}
				disabled={isServerStorage}
			>
				<span class="glass-option__content">
					<span class="glass-option__label">
						<Archive size={16} />
						<span>ZIP archive</span>
					</span>
				</span>
				{#if downloadMode === 'zip'}
					<Check size={14} class="glass-option__check" />
				{/if}
			</button>
			<button
				type="button"
				onclick={() => setDownloadMode('csv')}
				class={`glass-option glass-option--compact ${downloadMode === 'csv' ? 'is-active' : ''} ${isServerStorage ? 'cursor-not-allowed opacity-50' : ''}`}
				aria-pressed={downloadMode === 'csv'}
				disabled={isServerStorage}
			>
				<span class="glass-option__content">
					<span class="glass-option__label">
						<FileSpreadsheet size={16} />
						<span>Export links</span>
					</span>
				</span>
				{#if downloadMode === 'csv'}
					<Check size={14} class="glass-option__check" />
				{/if}
			</button>
		</div>
		{#if isServerStorage}
			<p class="section-footnote">
				Server downloads are saved as individual files. ZIP and CSV exports are client-only.
			</p>
		{/if}
	</section>
	<section class="settings-section">
		<p class="section-heading">Download Storage</p>
		<div class="option-grid option-grid--compact">
			<button
				type="button"
				onclick={() => setDownloadStorage('client')}
				class={`glass-option glass-option--compact ${$downloadPreferencesStore.storage === 'client' ? 'is-active' : ''}`}
				aria-pressed={$downloadPreferencesStore.storage === 'client'}
			>
				<span class="glass-option__content">
					<span class="glass-option__label">
						<Download size={16} />
						<span>Client-side</span>
					</span>
				</span>
				{#if $downloadPreferencesStore.storage === 'client'}
					<Check size={14} class="glass-option__check" />
				{/if}
			</button>
			<button
				type="button"
				onclick={() => setDownloadStorage('server')}
				class={`glass-option glass-option--compact ${$downloadPreferencesStore.storage === 'server' ? 'is-active' : ''}`}
				aria-pressed={$downloadPreferencesStore.storage === 'server'}
			>
				<span class="glass-option__content">
					<span class="glass-option__label">
						<Download size={16} />
						<span>Server-side</span>
					</span>
				</span>
				{#if $downloadPreferencesStore.storage === 'server'}
					<Check size={14} class="glass-option__check" />
				{/if}
			</button>
		</div>
		<p class="section-footnote">
			{isServerStorage
				? 'Files are saved on the server disk. Use Download Log for path and status.'
				: 'Downloads are saved to your browser.'}
		</p>
	</section>
	<section class="settings-section">
		<p class="section-heading">Operations</p>
		<div class="option-grid">
			<a href="/download-center" class="glass-option glass-option--wide glass-option--primary">
				<span class="glass-option__content">
					<span class="glass-option__label">Open Download Center</span>
					<span class="glass-option__description">Live queue controls and retry workflows.</span>
				</span>
			</a>
			<a href="/download-log" class="glass-option glass-option--wide glass-option--primary">
				<span class="glass-option__content">
					<span class="glass-option__label">Open Download Log</span>
					<span class="glass-option__description">
						{isServerStorage
							? 'View server download status and file locations.'
							: 'View real-time download progress and logs.'}
					</span>
				</span>
			</a>
			<a href="/status" class="glass-option glass-option--wide glass-option--primary">
				<span class="glass-option__content">
					<span class="glass-option__label">Open Status Page</span>
					<span class="glass-option__description">Diagnostics, health checks, and queue metrics.</span>
				</span>
			</a>
		</div>
	</section>
	<section class="settings-section">
		<ApiTargetsStatusCard
			title="API Status"
			status={statusTargets}
			loading={apiTargetsStatusLoading}
			lastUpdatedAt={statusLastUpdatedAt}
			onRefresh={() => void refreshTargetsStatus(true)}
		/>
	</section>
	<section class="settings-section">
		<p class="section-heading">Performance Mode</p>
		<div class="option-grid option-grid--compact">
			{#each PERFORMANCE_OPTIONS as option (option.value)}
				<button
					type="button"
					onclick={() => setPerformanceMode(option.value)}
					class={`glass-option glass-option--compact ${option.value === $userPreferencesStore.performanceMode ? 'is-active' : ''}`}
					aria-pressed={option.value === $userPreferencesStore.performanceMode}
				>
					<div class="glass-option__content">
						<span class="glass-option__label">{option.label}</span>
					</div>
					{#if option.value === $userPreferencesStore.performanceMode}
						<Check size={14} class="glass-option__check" />
					{/if}
				</button>
			{/each}
		</div>
	</section>
	<section class="settings-section">
		<p class="section-heading">Cache</p>
		<button type="button" onclick={handleClearCaches} class="glass-option glass-option--wide" disabled={isCacheClearing}>
			<span class="glass-option__content">
				<span class="glass-option__label">
					<Trash2 size={16} />
					<span>{isCacheClearing ? 'Clearing cache...' : 'Clear app cache'}</span>
				</span>
				<span class="glass-option__description">
					Clears artist discography cache, official TIDAL enrichment cache, and proxied cover cache.
				</span>
			</span>
			{#if isCacheClearing}
				<LoaderCircle size={16} class="glass-option__check animate-spin" />
			{/if}
		</button>
	</section>
	<section class="settings-section">
		<p class="section-heading">Library Maintenance</p>
		<button
			type="button"
			onclick={handleFullLibraryRepair}
			class="glass-option glass-option--wide glass-option--primary"
			disabled={isFullLibraryRepairing || isLibraryTransientSweeping || isLibraryDeduplicating || isCorrectionDedupRunning}
			aria-busy={isFullLibraryRepairing}
		>
			<span class="glass-option__content">
				<span class="glass-option__label">
					<Download size={16} />
					<span>{isFullLibraryRepairing ? 'Auto-repair running…' : 'Auto-repair full library'}</span>
				</span>
				<span class="glass-option__description">
					Scans all local albums, validates integrity, and queues corrupt tracks for repair.
				</span>
			</span>
			{#if isFullLibraryRepairing}
				<LoaderCircle size={16} class="glass-option__check animate-spin" />
			{/if}
		</button>
		{#if fullLibraryRepairSummary}
			<p class="section-footnote">{fullLibraryRepairSummary}</p>
		{/if}
		{#if fullLibraryRepairProgress}
			<p class="section-footnote">{fullLibraryRepairProgress}</p>
		{/if}

		<button
			type="button"
			onclick={handleSweepTransientArtifacts}
			class="glass-option glass-option--wide"
			disabled={isLibraryTransientSweeping || isFullLibraryRepairing || isLibraryDeduplicating || isCorrectionDedupRunning}
			aria-busy={isLibraryTransientSweeping}
		>
			<span class="glass-option__content">
				<span class="glass-option__label">
					<Trash2 size={16} />
					<span>{isLibraryTransientSweeping ? 'Sweeping temporary folders…' : 'Sweep stale publish/backup folders'}</span>
				</span>
				<span class="glass-option__description">
					Deletes leftover `*.publishing-*` and `*.backup-*` album folders from interrupted server downloads.
				</span>
			</span>
			{#if isLibraryTransientSweeping}
				<LoaderCircle size={16} class="glass-option__check animate-spin" />
			{/if}
		</button>
		{#if libraryTransientSweepSummary}
			<p class="section-footnote">{libraryTransientSweepSummary}</p>
		{/if}

		<button
			type="button"
			onclick={handleCorrectionSweepThenDedupe}
			class="glass-option glass-option--wide"
			disabled={isCorrectionDedupRunning || isFullLibraryRepairing || isLibraryTransientSweeping || isLibraryDeduplicating}
			aria-busy={isCorrectionDedupRunning}
		>
			<span class="glass-option__content">
				<span class="glass-option__label">
					<Trash2 size={16} />
					<span>{isCorrectionDedupRunning ? 'Running correction + dedupe…' : 'Correction sweep + dedupe'}</span>
				</span>
				<span class="glass-option__description">
					First sweeps stale publish/backup folders, then runs full library deduplication with a final report.
				</span>
			</span>
			{#if isCorrectionDedupRunning}
				<LoaderCircle size={16} class="glass-option__check animate-spin" />
			{/if}
		</button>
		{#if correctionDedupSummary}
			<p class="section-footnote">{correctionDedupSummary}</p>
		{/if}
		{#if correctionDedupProgress}
			<p class="section-footnote">{correctionDedupProgress}</p>
		{/if}

		<button
			type="button"
			onclick={handleLibraryDeduplicate}
			class="glass-option glass-option--wide"
			disabled={isLibraryDeduplicating || isFullLibraryRepairing || isLibraryTransientSweeping || isCorrectionDedupRunning}
			aria-busy={isLibraryDeduplicating}
		>
			<span class="glass-option__content">
				<span class="glass-option__label">
					<Trash2 size={16} />
					<span>{isLibraryDeduplicating ? 'Consolidating duplicates…' : 'Consolidate duplicate album files'}</span>
				</span>
				<span class="glass-option__description">
					Merges duplicate album folders and keeps the healthiest/full-length duplicate track variant.
				</span>
			</span>
			{#if isLibraryDeduplicating}
				<LoaderCircle size={16} class="glass-option__check animate-spin" />
			{/if}
		</button>
		{#if libraryDeduplicateSummary}
			<p class="section-footnote">{libraryDeduplicateSummary}</p>
		{/if}
		{#if libraryDeduplicateProgress}
			<p class="section-footnote">{libraryDeduplicateProgress}</p>
		{/if}
	</section>
	<section class="settings-section settings-section--bordered settings-section--wide">
		<p class="section-heading">Queue actions</p>
		<div class="actions-column">
			<button onclick={handleQueueDownload} type="button" class="glass-action" disabled={queueActionBusy}>
				<span class="glass-action__label">
					{#if isServerStorage}
						<Download size={16} />
						<span>Save queue to server</span>
					{:else if downloadMode === 'zip'}
						<Archive size={16} />
						<span>Download queue</span>
					{:else if downloadMode === 'csv'}
						<FileSpreadsheet size={16} />
						<span>Export queue links</span>
					{:else}
						<Download size={16} />
						<span>Download queue</span>
					{/if}
				</span>
				{#if queueActionBusy}
					<LoaderCircle size={16} class="glass-action__spinner" />
				{/if}
			</button>
			{#if !isServerStorage}
				<button onclick={handleExportQueueCsv} type="button" class="glass-action" disabled={isCsvExporting}>
					<span class="glass-action__label">
						<FileSpreadsheet size={16} />
						<span>Export links as CSV</span>
					</span>
					{#if isCsvExporting}
						<LoaderCircle size={16} class="glass-action__spinner" />
					{/if}
				</button>
			{/if}
		</div>
		<p class="section-footnote">
			{isServerStorage
				? 'Server saves use individual files and keep your browser clean. Use the Download Log to track progress and see the server path.'
				: 'Queue actions follow your selection above. ZIP bundles require at least two tracks, while CSV exports capture the track links without downloading audio.'}
		</p>
	</section>
</div>

<style>
	.settings-grid {
		display: grid;
		gap: 0.85rem;
	}

	.settings-grid--page {
		padding-top: 0.25rem;
	}

	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.72rem 0.78rem;
		border-radius: var(--ui-radius-md, 14px);
		border: 1px solid rgba(212, 212, 212, 0.2);
		background: linear-gradient(160deg, rgba(12, 12, 12, 0.54), rgba(7, 7, 7, 0.38));
	}

	.settings-section--wide {
		grid-column: span 1;
	}

	.section-heading {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		font-weight: 700;
		margin: 0;
		color: rgba(212, 212, 212, 0.7);
	}

	.option-grid {
		display: grid;
		gap: 0.45rem;
	}

	.option-grid--compact {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 0.4rem;
	}

	.glass-option {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		border-radius: var(--ui-radius-md, 14px);
		border: 1px solid rgba(212, 212, 212, 0.22);
		background: linear-gradient(155deg, rgba(15, 15, 15, 0.6), rgba(8, 8, 8, 0.42));
		backdrop-filter: blur(var(--perf-blur-medium, 28px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-medium, 28px)) saturate(var(--perf-saturate, 160%));
		padding: 0.56rem 0.7rem;
		color: inherit;
		text-decoration: none;
		font-size: 0.8rem;
		cursor: pointer;
		text-align: left;
		transition: border-color 140ms ease, transform 140ms ease, box-shadow 160ms ease;
	}

	.glass-option--compact {
		padding: 0.45rem 0.6rem;
		gap: 0.5rem;
		border-radius: 10px;
	}

	.glass-option--compact .glass-option__label {
		font-size: 0.75rem;
		font-weight: 600;
	}

	.glass-option--compact .glass-option__description {
		display: none;
	}

	.glass-option:hover {
		transform: translateY(-1px) scale(1.002);
		box-shadow: 0 10px 30px rgba(7, 7, 7, 0.3);
		border-color: rgba(255, 255, 255, 0.44);
	}

	.glass-option.is-active {
		border-color: var(--bloom-accent, rgba(255, 255, 255, 0.72));
		background: linear-gradient(155deg, rgba(52, 52, 52, 0.42), rgba(22, 22, 22, 0.36));
		box-shadow: 0 14px 32px rgba(6, 6, 6, 0.35), inset 0 0 28px rgba(255, 255, 255, 0.12);
	}

	.glass-option__content {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.glass-option__label {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-weight: 600;
		font-size: 0.8rem;
	}

	.glass-option__description {
		font-size: 0.68rem;
		opacity: 0.66;
		line-height: 1.3;
	}

	.glass-option__check {
		color: rgba(245, 245, 245, 0.95);
		flex-shrink: 0;
	}

	.glass-option__chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.66rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: rgba(11, 11, 11, 0.52);
		border: 1px solid rgba(212, 212, 212, 0.45);
		color: rgba(236, 236, 236, 0.9);
		flex-shrink: 0;
	}

	.glass-option__chip.is-active {
		border-color: var(--bloom-accent, rgba(255, 255, 255, 0.75));
		color: rgba(245, 245, 245, 0.98);
		box-shadow: inset 0 0 20px rgba(255, 255, 255, 0.2);
	}

	.settings-section--bordered {
		padding-top: 0.65rem;
		border-top: 1px solid rgba(212, 212, 212, 0.12);
	}

	.actions-column {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.glass-action {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.85rem;
		border-radius: var(--ui-radius-md, 14px);
		border: 1px solid rgba(212, 212, 212, 0.24);
		background: linear-gradient(155deg, rgba(15, 15, 15, 0.62), rgba(8, 8, 8, 0.44));
		backdrop-filter: blur(var(--perf-blur-medium, 28px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-medium, 28px)) saturate(var(--perf-saturate, 160%));
		padding: 0.74rem 0.95rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
		transition: border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease;
	}

	.glass-action:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.glass-action:hover:not(:disabled) {
		transform: translateY(-1px) scale(1.002);
		border-color: rgba(255, 255, 255, 0.44);
		box-shadow: 0 12px 30px rgba(7, 7, 7, 0.3);
	}

	.glass-action__label {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
	}

	.glass-action__spinner {
		animation: spin 1s linear infinite;
		color: rgba(212, 212, 212, 0.85);
	}

	.section-footnote {
		margin: 0;
		font-size: 0.68rem;
		color: rgba(212, 212, 212, 0.7);
		line-height: 1.4;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	@media (min-width: 960px) {
		.settings-grid {
			grid-template-columns: repeat(2, minmax(260px, 1fr));
		}

		.settings-section--bordered {
			grid-column: span 2;
		}
	}

	@media (max-width: 768px) {
		.option-grid--compact {
			grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		}
	}
</style>
