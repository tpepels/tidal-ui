<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import LyricsPopup from '$lib/components/LyricsPopup.svelte';


	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import { artistCacheStore } from '$lib/stores/artistCache';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import {
		correctAndDeduplicateLibrary,
		deduplicateLibraryInLibrary,
		fetchCorrectAndDeduplicateStatus,
		fetchLibraryDeduplicateStatus,
		fetchFullLibraryRepairStatus,
		repairFullLibraryInLibrary,
		sweepTemporaryLibraryArtifacts
	} from '$lib/utils/mediaLibraryClient';

	import { toasts } from '$lib/stores/toasts';
	import {
		machineCurrentTrack,
		machineIsPlaying,
		machineQueue
	} from '$lib/stores/playerDerived';
	import { queueStats, serverQueue, workerStatus } from '$lib/stores/serverQueue.svelte';
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { downloadLogStore } from '$lib/stores/downloadLog';
	import {
		downloadPreferencesStore,
		type DownloadMode,
		type DownloadStorage
	} from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { effectivePerformanceLevel } from '$lib/stores/performance';
	import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
	import {
		sanitizeForFilename,
		getExtensionForQuality,
		buildTrackLinksCsv,
		downloadTrackToServer,
		type ServerDownloadProgress
	} from '$lib/downloads';
	import { formatArtists } from '$lib/utils/formatters';
	import { navigating, page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { dev } from '$app/environment';
	import {
		errorTracker,
		getErrorSummary,
		getPersistedErrorSummary,
		type ErrorReport
	} from '$lib/core/errorTracker';
	import { logger } from '$lib/core/logger';
	import { getSessionId } from '$lib/core/session';
	import { getRetrySummary, type RetrySummary } from '$lib/core/retryTracker';
	import {
		Archive,
		FileSpreadsheet,
		LoaderCircle,
		Download,
		Check,
		Settings,
		Trash2,
		Search,
		Logs,
		Activity,
		PanelLeft,
		PanelRight,
		Music2,
		History,
		Library
	} from 'lucide-svelte';
	import { type Track, type AudioQuality, type PlayableTrack, isSonglinkTrack } from '$lib/types';
	import { getRouteMeta } from '$lib/config/routeMeta';

	let { children, data } = $props();
	const pageTitle = $derived(data?.title ?? 'BiniLossless');
	let headerHeight = $state(0);
	let playerHeight = $state(0);
	let isPlayerVisible = $state(false);
	let AudioPlayerComponent = $state<typeof import('$lib/components/AudioPlayer.svelte').default | null>(
		null
	);
	let viewportHeight = $state(0);
	let isSidebarCollapsed = $state(false);
	let sidebarNavContainer = $state<HTMLElement | null>(null);

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
	let statusQueueMetrics = $state<{
		source?: string;
		queue?: Record<string, unknown>;
		metrics?: Record<string, unknown>;
		error?: string;
	} | null>(null);
	let statusLastUpdatedAt = $state<number | null>(null);
	const downloadMode = $derived($downloadPreferencesStore.mode);
	const isServerStorage = $derived($downloadPreferencesStore.storage === 'server');
	const queueActionBusy = $derived(
		downloadMode === 'zip'
			? Boolean(isZipDownloading || isLegacyQueueDownloading || isCsvExporting)
			: downloadMode === 'csv'
				? Boolean(isCsvExporting)
				: Boolean(isLegacyQueueDownloading)
	);

	$effect(() => {
		if (isServerStorage && downloadMode !== 'individual') {
			downloadPreferencesStore.setMode('individual');
		}
	});

	const isEmbed = $derived($page.url.pathname.startsWith('/embed'));
	const MAX_QUEUE_ZIP_TRACKS = 75;
	const FULL_LIBRARY_REPAIR_CONFIRMATION =
		'Scan your full local library and queue automatic repairs for corrupt tracks only? This can queue many downloads.';
	const LIBRARY_TRANSIENT_SWEEP_CONFIRMATION =
		'Remove stale temporary publish/backup album folders left from interrupted jobs?';
	const LIBRARY_CORRECTION_DEDUP_CONFIRMATION =
		'Run correction sweep first and then deduplicate the library in one run?';
	const LIBRARY_DEDUP_CONFIRMATION =
		'Merge duplicate album folders and remove duplicate tracks by track number? Duplicates are moved to a backup folder first.';
	let diagnosticsLoading = $state(false);
	let diagnosticsSummary = $state<ReturnType<typeof getErrorSummary> | null>(null);
	let diagnosticsDomains = $state<Record<string, number> | null>(null);
	let diagnosticsHealth = $state<{ status?: string; responseTime?: number; issues?: string[] } | null>(
		null
	);
	let diagnosticsPersisted = $state<ReturnType<typeof getPersistedErrorSummary> | null>(null);
	let diagnosticsRetries = $state<RetrySummary | null>(null);
	let diagnosticsErrors = $state<ErrorReport[] | null>(null);
	const maintenanceLogLastByScope: Record<string, string> = {};

	type DownloadLogLevel = 'info' | 'success' | 'warning' | 'error';

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
		if (dedupe && maintenanceLogLastByScope[scope] === normalized) {
			return;
		}
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

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (isEmbed) return;
		if ($navigating) return;
		breadcrumbStore.visit($page.url.pathname);
	});

	$effect(() => {
		const current = $machineCurrentTrack;
		if (current && !isSonglinkTrack(current)) {
			const newPath = `/track/${current.id}`;
			const isTrackPage = $page.url.pathname.startsWith('/track/');

			if ($page.url.pathname !== newPath && !$navigating) {
				if (isTrackPage) {
					goto(newPath, { keepFocus: true, noScroll: true });
				}
			}
		}
	});
	const mainMinHeight = $derived(() => Math.max(0, viewportHeight - headerHeight - playerHeight));
	const queueTrackCount = $derived(Array.isArray($machineQueue) ? $machineQueue.length : 0);
	const DOWNLOAD_CENTER_BADGE_POLL_MS = 1_000;
	const downloadCenterCurrentDownloads = $derived.by(() => {
		const activeDownloads = Number($workerStatus.activeDownloads ?? 0);
		const processing = Number($queueStats.processing ?? 0);
		const normalizedActive = Number.isFinite(activeDownloads) ? Math.max(0, Math.trunc(activeDownloads)) : 0;
		const normalizedProcessing = Number.isFinite(processing) ? Math.max(0, Math.trunc(processing)) : 0;
		return Math.max(normalizedActive, normalizedProcessing);
	});
	const downloadCenterQueueSize = $derived.by(() => {
		const queued = Number($queueStats.queued ?? 0);
		const normalizedQueued = Number.isFinite(queued) ? Math.max(0, Math.trunc(queued)) : 0;
		return downloadCenterCurrentDownloads + normalizedQueued;
	});
	const showDownloadCenterBadge = $derived(
		downloadCenterCurrentDownloads > 0 || downloadCenterQueueSize > 0
	);
	const downloadCenterBadgeLabel = $derived(
		`${downloadCenterCurrentDownloads}/${downloadCenterQueueSize}`
	);
	const currentTrackRoute = $derived.by(() => {
		const current = $machineCurrentTrack;
		if (!current || isSonglinkTrack(current)) return null;
		const parsedId = Number(current.id);
		if (!Number.isFinite(parsedId) || parsedId <= 0) return null;
		return `/track/${parsedId}`;
	});

	const mainMarginBottom = $derived(() => Math.max(playerHeight, 128));

	const ensureAudioPlayerLoaded = async () => {
		if (AudioPlayerComponent) return;
		const module = await import('$lib/components/AudioPlayer.svelte');
		AudioPlayerComponent = module.default;
	};

	$effect(() => {
		if ($machineCurrentTrack && !AudioPlayerComponent) {
			void ensureAudioPlayerLoaded();
		}
	});
	$effect(() => {
		if (isEmbed && !AudioPlayerComponent) {
			void ensureAudioPlayerLoaded();
		}
	});

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

	const convertAacToMp3 = $derived($userPreferencesStore.convertAacToMp3);
	const downloadCoversSeperately = $derived($userPreferencesStore.downloadCoversSeperately);
	const experimentalMusicBrainzTagging = $derived(
		$userPreferencesStore.experimentalMusicBrainzTagging
	);
	const strictMusicBrainzMatching = $derived(
		$userPreferencesStore.strictMusicBrainzMatching
	);

	function selectDownloadQuality(quality: AudioQuality): void {
		downloadPreferencesStore.setDownloadQuality(quality);
	}

	function toggleAacConversion(): void {
		userPreferencesStore.toggleConvertAacToMp3();
	}

	function toggleDownloadCoversSeperately(): void {
		userPreferencesStore.toggleDownloadCoversSeperately();
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

	function toggleSidebarCollapsed(): void {
		isSidebarCollapsed = !isSidebarCollapsed;
	}

	function isRouteActive(href: string): boolean {
		const path = $page.url.pathname;
		if (href === '/') return path === '/';
		return path === href || path.startsWith(`${href}/`);
	}

	function routeNavLabel(path: string, fallback: string): string {
		return getRouteMeta(path)?.navLabel ?? fallback;
	}

	function handleSidebarNavKeydown(event: KeyboardEvent): void {
		if (!sidebarNavContainer) return;
		const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
		if (!keys.includes(event.key)) return;

		const items = Array.from(
			sidebarNavContainer.querySelectorAll<HTMLElement>('[data-sidebar-item]')
		).filter((item) => !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true');
		if (items.length === 0) return;

		const activeIndex = items.findIndex((item) => item === document.activeElement);
		let nextIndex = activeIndex >= 0 ? activeIndex : 0;

		switch (event.key) {
			case 'ArrowDown':
				nextIndex = (activeIndex + 1 + items.length) % items.length;
				break;
			case 'ArrowUp':
				nextIndex = (activeIndex - 1 + items.length) % items.length;
				break;
			case 'Home':
				nextIndex = 0;
				break;
			case 'End':
				nextIndex = items.length - 1;
				break;
			default:
				return;
		}

		event.preventDefault();
		items[nextIndex]?.focus();
	}

	$effect(() => {
		if (!sidebarNavContainer) return;
		const listener = (event: KeyboardEvent) => handleSidebarNavKeydown(event);
		sidebarNavContainer.addEventListener('keydown', listener);
		return () => {
			sidebarNavContainer?.removeEventListener('keydown', listener);
		};
	});

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
		if (token !== fullLibraryRepairPollToken) {
			return;
		}
		const status = await fetchFullLibraryRepairStatus();
		if (token !== fullLibraryRepairPollToken || !status.success) {
			return;
		}
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
			const result = await repairFullLibraryInLibrary({
				quality,
				queue: true
			});

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
				error instanceof Error && error.message
					? error.message
					: 'Failed to auto-repair full library';
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
			if (!result.success) {
				throw new Error(result.error || 'Failed to sweep temporary album artifacts');
			}
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
			const preview = await correctAndDeduplicateLibrary({
				dryRun: true,
				forceRescan: true
			});
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
					logMaintenanceMessage(
						'Correction + Dedupe',
						`Dry-run report saved to ${preview.reportPath}`,
						'info',
						false
					);
				}

				if (plannedChanges <= 0) {
					correctionDedupProgress = null;
					correctionDedupSummary = `${previewSummary} No execute pass needed.`;
					toasts.success('Correction dry-run found no actionable changes.');
					logMaintenanceMessage(
						'Correction + Dedupe',
						'Dry-run found no actionable changes. Execute pass skipped.',
						'success'
					);
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

			const result = await correctAndDeduplicateLibrary({
				dryRun: false,
				forceRescan: true
			});
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
					logMaintenanceMessage(
						'Correction + Dedupe',
						`Report saved to ${result.reportPath}`,
						'info',
						false
					);
				}
				if (dedupeResult.backupRoot) {
					toasts.info(`Duplicate backups saved to ${dedupeResult.backupRoot}`);
					logMaintenanceMessage(
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
				correctionDedupProgress = null;
				correctionDedupSummary = null;
				toasts.error(message);
				logMaintenanceMessage('Correction + Dedupe', message, 'error', false);
			} finally {
				if (executionStarted) {
					stopCorrectionDedupPolling();
			}
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

	async function pollCorrectionDedupStatus(token: number): Promise<void> {
		if (token !== correctionDedupPollToken) {
			return;
		}
		const status = await fetchCorrectAndDeduplicateStatus();
		if (token !== correctionDedupPollToken || !status.success) {
			return;
		}
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
			const preview = await deduplicateLibraryInLibrary({
				dryRun: true,
				forceRescan: true
			});
			if (!preview.success) {
				throw new Error(preview.error || 'Failed to run dedupe dry-run');
			}
				const previewSummary =
					`Dry-run plan: merge ${preview.albumsMerged ?? 0} album folder(s), move ${preview.filesMovedBetweenAlbums ?? 0} file(s), ` +
					`backup ${preview.duplicateFilesBackedUp ?? 0} duplicate track file(s), manual review ${preview.manualReviewRequired ?? 0}.`;
				logMaintenanceMessage('Library Dedupe', previewSummary, 'info', false);
				const plannedChanges =
					(preview.filesMovedBetweenAlbums ?? 0) + (preview.duplicateFilesBackedUp ?? 0);
				if (preview.report?.reportPath) {
					toasts.info(`Dedupe dry-run report saved to ${preview.report.reportPath}`);
					logMaintenanceMessage(
						'Library Dedupe',
						`Dry-run report saved to ${preview.report.reportPath}`,
						'info',
						false
					);
				}
				if (plannedChanges <= 0) {
					libraryDeduplicateProgress = null;
					libraryDeduplicateSummary = `${previewSummary} No execute pass needed.`;
					toasts.success('Dedupe dry-run found no actionable changes.');
					logMaintenanceMessage(
						'Library Dedupe',
						'Dry-run found no actionable changes. Execute pass skipped.',
						'success'
					);
					return;
				}
			let executeNow = true;
			if (typeof window !== 'undefined') {
				executeNow = window.confirm(`${previewSummary}\n\nRun execute pass now?`);
			}
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

			const result = await deduplicateLibraryInLibrary({
				dryRun: false,
				forceRescan: true
			});
			if (!result.success) {
				throw new Error(result.error || 'Failed to deduplicate media library');
			}

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
					logMaintenanceMessage(
						'Library Dedupe',
						`Report saved to ${report.reportPath}`,
						'info',
						false
					);
				}
				if (result.backupRoot) {
					toasts.info(`Duplicate backups saved to ${result.backupRoot}`);
					logMaintenanceMessage(
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
				libraryDeduplicateProgress = null;
				libraryDeduplicateSummary = null;
				toasts.error(message);
				logMaintenanceMessage('Library Dedupe', message, 'error', false);
			} finally {
				if (executionStarted) {
					stopLibraryDeduplicatePolling();
			}
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
		if (token !== libraryDeduplicatePollToken) {
			return;
		}
		const status = await fetchLibraryDeduplicateStatus();
		if (token !== libraryDeduplicatePollToken || !status.success) {
			return;
		}
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

	async function refreshDiagnostics(): Promise<void> {
		diagnosticsLoading = true;
		diagnosticsSummary = getErrorSummary();
		diagnosticsDomains = errorTracker.getDomainSummary();
		diagnosticsPersisted = getPersistedErrorSummary();
		diagnosticsRetries = getRetrySummary();
		diagnosticsErrors = errorTracker.getErrors({ limit: 50 });
		try {
			const [healthResponse, targetsResponse, queueMetricsResponse] = await Promise.all([
				fetch('/api/health'),
				fetch('/api/targets/status'),
				fetch('/api/download-queue/metrics')
			]);
			diagnosticsHealth = (await healthResponse.json()) as typeof diagnosticsHealth;
			statusTargets = (await targetsResponse.json()) as typeof statusTargets;
			statusQueueMetrics = (await queueMetricsResponse.json()) as typeof statusQueueMetrics;
			statusLastUpdatedAt = Date.now();
		} catch {
			diagnosticsHealth = null;
			statusTargets = null;
			statusQueueMetrics = null;
		} finally {
			diagnosticsLoading = false;
		}
	}

	async function refreshTargetsStatus(forceRefresh = false): Promise<void> {
		apiTargetsStatusLoading = true;
		const existing = statusTargets;
		try {
			const suffix = forceRefresh ? '?refresh=1' : '';
			const response = await fetch(`/api/targets/status${suffix}`);
			if (!response.ok) {
				throw new Error(`Failed to fetch API target status (${response.status})`);
			}
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

	$effect(() => {
		if (!isPlayerVisible && typeof document !== 'undefined') {
			document.documentElement.style.setProperty('--player-height', '0px');
		}
	});

	$effect(() => {
		if (typeof window === 'undefined' || isEmbed) {
			serverQueue.stopPolling();
			return;
		}
		serverQueue.startPolling(DOWNLOAD_CENTER_BADGE_POLL_MS);
		return () => {
			serverQueue.stopPolling();
		};
	});

	onDestroy(() => {
		stopCorrectionDedupPolling();
		stopFullLibraryRepairPolling();
		stopLibraryDeduplicatePolling();
	});


	// Update page title with currently playing song
	$effect(() => {
		if (typeof document === 'undefined') return;

		const track = $machineCurrentTrack;
		const isPlaying = $machineIsPlaying;

		if (track) {
			const artist = isSonglinkTrack(track) ? track.artistName : formatArtists(track.artists);
			const title = track.title ?? 'Unknown Track';
			const prefix = isPlaying ? '▶' : '⏸';
			document.title = `${prefix} ${title} • ${artist} | BiniLossless`;
		} else {
			document.title = pageTitle;
		}
	});

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
				const fraction = progress.totalBytes
					? progress.uploadedBytes / progress.totalBytes
					: uploadFraction;
				uploadFraction = Math.max(uploadFraction, Math.min(1, fraction));
			}

			const overall = Math.min(
				1,
				downloadFraction * downloadWeight + uploadFraction * (1 - downloadWeight)
			);
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
				toasts.warning(
					`ZIP export is limited to ${MAX_QUEUE_ZIP_TRACKS} tracks to avoid memory issues.`
				);
				return;
			}
			const { default: JSZip } = await import('jszip');
			const zip = new JSZip();
			for (const [index, track] of exportableTracks.entries()) {
				const filename = buildQueueFilename(track, index, quality);
					const { blob } = await losslessAPI.fetchTrackBlob(track.id, quality, filename, {
						ffmpegAutoTriggered: false,
						convertAacToMp3,
						enableExperimentalMusicBrainz: experimentalMusicBrainzTagging,
						strictMusicBrainzMatching
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

	async function downloadQueueIndividually(
		tracks: PlayableTrack[],
		quality: AudioQuality
	): Promise<void> {
		if (isLegacyQueueDownloading) {
			return;
		}

		isLegacyQueueDownloading = true;
		const errors: string[] = [];
		const storage = get(downloadPreferencesStore).storage;

		try {
			for (const [index, track] of tracks.entries()) {
				const trackId = isSonglinkTrack(track) ? track.tidalId : track.id;
				if (!trackId) continue;

				const filename = buildQueueFilename(track, index, quality);
				const { taskId, controller } = downloadUiStore.beginTrackDownload(
					track as Track,
					filename,
					{
						subtitle: isSonglinkTrack(track)
							? track.artistName
							: (track.album?.title ?? formatArtists(track.artists)),
						storage
					}
				);
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
								downloadUiStore.updateTrackProgress(
									taskId,
									progress.receivedBytes,
									progress.totalBytes
								);
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
			isLegacyQueueDownloading = false;
		}
	}

	async function handleQueueDownload(): Promise<void> {
		if (queueActionBusy) {
			return;
		}

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

	const handlePlayerHeight = (height: number) => {
		playerHeight = height;
	};

	let controllerChangeHandler: (() => void) | null = null;

	onMount(() => {
		try {
			logger.setCorrelationId(getSessionId());
			if (import.meta.env.VITE_E2E === 'true') {
				(window as Window & { __tidalE2E?: boolean }).__tidalE2E = true;
			}
			// Subscribe to performance level and update data attribute
			const unsubPerf = effectivePerformanceLevel.subscribe((level) => {
				try {

					if (typeof document !== 'undefined' && document.documentElement) {
						document.documentElement.setAttribute('data-performance', level);
					}
				} catch (error) {
					console.warn('Failed to update performance level:', error);
				}
			});

		const updateViewportHeight = () => {
			viewportHeight = window.innerHeight;
		};
		updateViewportHeight();
		window.addEventListener('resize', updateViewportHeight);

		// Check if we're in a local/dev environment where SW should be disabled
		const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
		const isLocalPreview =
			hostname === '127.0.0.1' ||
			hostname === 'localhost' ||
			// LAN IP ranges where self-signed certs may cause SW registration to fail
			/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
			/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
			/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);

		// Additional check: if we're on HTTPS but not on a trusted domain, SSL issues likely
		const isUntrustedHttps =
			typeof window !== 'undefined' &&
			window.location.protocol === 'https:' &&
			isLocalPreview;

		const isSecureContext =
			typeof window !== 'undefined' ? window.isSecureContext : false;
		const shouldUseServiceWorker =
			!dev &&
			!isLocalPreview &&
			!isUntrustedHttps &&
			isSecureContext &&
			import.meta.env.VITE_E2E !== 'true';

		// Proactively unregister any existing service workers if we shouldn't use them
		if ('serviceWorker' in navigator && !shouldUseServiceWorker) {
			navigator.serviceWorker
				.getRegistrations()
				.then((registrations) => {
					registrations.forEach((registration) => {
						void registration.unregister();
					});
					if (registrations.length > 0) {
						console.info('[ServiceWorker] Unregistered existing service workers (local/LAN environment)');
					}
				})
				.catch((error) => {
					console.warn('Failed to unregister service workers', error);
				});
		}

		// Only attempt registration on trusted environments
		if ('serviceWorker' in navigator && shouldUseServiceWorker) {
			const registerServiceWorker = async () => {
				try {
					const registration = await navigator.serviceWorker.register('/service-worker.js');
					const sendSkipWaiting = () => {
						if (registration.waiting) {
							registration.waiting.postMessage({ type: 'SKIP_WAITING' });
						}
					};

					if (registration.waiting) {
						sendSkipWaiting();
					}

					registration.addEventListener('updatefound', () => {
						const newWorker = registration.installing;
						if (!newWorker) return;
						newWorker.addEventListener('statechange', () => {
							if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
								sendSkipWaiting();
							}
						});
					});
				} catch (error) {
					// Handle SSL/Security errors gracefully - these occur on LAN IPs with self-signed certs
					const isSecurityError =
						error instanceof Error &&
						(error.name === 'SecurityError' ||
							error.message.includes('SSL') ||
							error.message.includes('certificate') ||
							error.message.includes('secure context'));

					if (isSecurityError) {
						console.warn(
							'[ServiceWorker] Registration failed due to SSL/security issue (likely self-signed cert on LAN IP). ' +
								'Offline caching disabled. App will continue to work without offline support.',
							error
						);
						// Don't show a toast for this - it's expected on dev LAN setups
					} else {
						console.error('Service worker registration failed', error);
					}
				}
			};

			registerServiceWorker();

			let refreshing = false;
			controllerChangeHandler = () => {
				if (refreshing) return;
				refreshing = true;
				window.location.reload();
			};
			navigator.serviceWorker.addEventListener('controllerchange', controllerChangeHandler);
		}
		return () => {
			window.removeEventListener('resize', updateViewportHeight);
			unsubPerf();
			if (controllerChangeHandler) {
				navigator.serviceWorker.removeEventListener('controllerchange', controllerChangeHandler);
			}
		};
		} catch (error) {
			console.error('Failed to initialize layout:', error);
			// Continue with degraded functionality
		}
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/site.webmanifest" />

	<meta name="theme-color" content="#0f172a" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</svelte:head>

	{#if isEmbed}
		{@render children?.()}
		{#if AudioPlayerComponent}
			<AudioPlayerComponent headless={true} />
		{/if}
	{:else}
		<div class="app-root" data-sveltekit-preload-data="hover">
		<div class="app-shell">
					<div class={`app-workspace ${isSidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
					<aside
						class="app-sidebar glass-panel"
						aria-label="Primary navigation"
						bind:this={sidebarNavContainer}
					>
						<div class="app-sidebar__header">
							<div class="app-sidebar__brand">
								<p class="app-sidebar__title">BiniLossless</p>
								<p class="app-sidebar__subtitle">Library Control</p>
							</div>
							<button
								type="button"
								class="sidebar-icon-btn"
								onclick={toggleSidebarCollapsed}
								aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
								title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
							>
								{#if isSidebarCollapsed}
									<PanelRight size={16} />
								{:else}
									<PanelLeft size={16} />
								{/if}
							</button>
						</div>

						<div class="app-sidebar__section">
							<p class="app-sidebar__section-title">Navigation</p>
							<a
								class={`sidebar-action ${isRouteActive('/') ? 'is-active' : ''}`}
								href="/"
								aria-current={isRouteActive('/') ? 'page' : undefined}
								title="Browse and search"
								data-sidebar-item
							>
								<Search size={16} />
								<span class="sidebar-action__label">{routeNavLabel('/', 'Browse & Search')}</span>
							</a>
								<button
									type="button"
									class={`sidebar-action ${currentTrackRoute && isRouteActive(currentTrackRoute) ? 'is-active' : ''}`}
									onclick={() => {
										if (!currentTrackRoute) return;
										void goto(currentTrackRoute);
									}}
									disabled={!currentTrackRoute}
									title={currentTrackRoute ? 'Open currently playing track' : 'No active track'}
									data-sidebar-item
								>
									<Music2 size={16} />
									<span class="sidebar-action__label">
										{currentTrackRoute ? 'Now Playing' : 'No Track Active'}
									</span>
								</button>
									<a
										class={`sidebar-action ${isRouteActive('/history') ? 'is-active' : ''}`}
										href="/history"
										aria-current={isRouteActive('/history') ? 'page' : undefined}
										title="Navigation history"
										data-sidebar-item
									>
										<History size={16} />
										<span class="sidebar-action__label">{routeNavLabel('/history', 'History')}</span>
									</a>
									<a
										class={`sidebar-action ${isRouteActive('/library-suggestions') ? 'is-active' : ''}`}
										href="/library-suggestions"
										aria-current={isRouteActive('/library-suggestions') ? 'page' : undefined}
										title="Library suggestions"
										data-sidebar-item
									>
										<Library size={16} />
										<span class="sidebar-action__label">
											{routeNavLabel('/library-suggestions', 'Library Suggestions')}
										</span>
									</a>
								</div>

							<div class="app-sidebar__section">
								<p class="app-sidebar__section-title">Tools</p>
							<a
								class={`sidebar-action ${isRouteActive('/settings') ? 'is-active' : ''}`}
								href="/settings"
								aria-current={isRouteActive('/settings') ? 'page' : undefined}
								title="Open settings"
								data-sidebar-item
							>
								<Settings size={16} />
								<span class="sidebar-action__label">{routeNavLabel('/settings', 'Settings')}</span>
							</a>
								<a
									class={`sidebar-action ${isRouteActive('/download-center') ? 'is-active' : ''}`}
									href="/download-center"
									aria-current={isRouteActive('/download-center') ? 'page' : undefined}
									title="Download center"
									data-sidebar-item
								>
									<Download size={16} />
									<span class="sidebar-action__label">{routeNavLabel('/download-center', 'Download Center')}</span>
									{#if showDownloadCenterBadge}
										<span class="sidebar-action__bubble" title="Current downloads / queue size">
											{downloadCenterBadgeLabel}
										</span>
									{/if}
								</a>
							<a
								class={`sidebar-action ${isRouteActive('/download-log') ? 'is-active' : ''}`}
								href="/download-log"
								aria-current={isRouteActive('/download-log') ? 'page' : undefined}
								title="Download log"
								data-sidebar-item
							>
								<Logs size={16} />
								<span class="sidebar-action__label">{routeNavLabel('/download-log', 'Download Log')}</span>
							</a>
							<a
								class={`sidebar-action ${isRouteActive('/status') ? 'is-active' : ''}`}
								href="/status"
								aria-current={isRouteActive('/status') ? 'page' : undefined}
								title="System status"
								data-sidebar-item
							>
								<Activity size={16} />
								<span class="sidebar-action__label">{routeNavLabel('/status', 'Status')}</span>
							</a>
						</div>

						<div class="app-sidebar__meta">
							<span class="app-sidebar__meta-chip">Queue {queueTrackCount}</span>
							<span class="app-sidebar__meta-chip">{isServerStorage ? 'Server Save' : 'Client Save'}</span>
						</div>
					</aside>

					<main
						class="app-main app-main--workspace glass-panel !sm:mb-40 !mb-56"
						style={`min-height: ${mainMinHeight}px; margin-bottom: ${mainMarginBottom}px;`}
					>
						<div class="app-main__inner">
							<Breadcrumb />
								{@render children?.()}
						</div>
					</main>
				</div>

			{#if $machineCurrentTrack && AudioPlayerComponent}
				<AudioPlayerComponent
					onHeightChange={handlePlayerHeight}
					onVisibilityChange={(visible) => {
						isPlayerVisible = visible;
					}}
				/>
			{/if}
		</div>
	</div>

	<LyricsPopup />
	<ToastContainer />
{/if}


<style>
	:global(:root) {
		--bloom-primary: #0a0a0a;
		--bloom-secondary: #121212;
		--bloom-accent: #1db954;
		--bloom-glow: rgba(30, 215, 96, 0.24);
		--bloom-tertiary: rgba(30, 215, 96, 0.14);
		--bloom-quaternary: rgba(255, 255, 255, 0.12);
		--surface-color: #121212;
		--surface-border: rgba(255, 255, 255, 0.15);
		--surface-highlight: rgba(255, 255, 255, 0.08);
		--accent-color: var(--bloom-accent);
	}

	:global(body) {
		margin: 0;
		min-height: 100vh;
		font-family:
			'Figtree',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			'Helvetica Neue',
			Arial,
			sans-serif;
		background:
			radial-gradient(960px 560px at -16% -10%, rgba(30, 215, 96, 0.14), transparent 58%),
			radial-gradient(900px 540px at 112% -12%, rgba(30, 215, 96, 0.08), transparent 60%),
			linear-gradient(180deg, #080808 0%, #111111 46%, #060606 100%);
		background-attachment: fixed;
		color: #f8fbff;
	}

	.app-root {
		position: relative;
		min-height: 100vh;
		color: inherit;
		overflow: clip;
	}

	.app-root::before,
	.app-root::after {
		content: '';
		position: fixed;
		pointer-events: none;
		filter: blur(56px);
		opacity: 0.35;
		z-index: 0;
		animation: ambient-float 22s ease-in-out infinite alternate;
	}

	.app-root::before {
		width: 480px;
		height: 480px;
		left: -160px;
		top: -140px;
		background: radial-gradient(circle, rgba(30, 215, 96, 0.2) 0%, transparent 72%);
	}

	.app-root::after {
		width: 440px;
		height: 440px;
		right: -180px;
		bottom: -180px;
		background: radial-gradient(circle, rgba(30, 215, 96, 0.16) 0%, transparent 70%);
		animation-delay: 4s;
	}

	.app-shell {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}

	.app-workspace {
		flex: 1;
		display: grid;
		grid-template-columns: clamp(230px, 20vw, 270px) minmax(0, 1fr);
		gap: clamp(0.95rem, 1.8vw, 1.45rem);
		padding: clamp(0.9rem, 1.8vw, 1.5rem);
		align-items: start;
		width: 100%;
		max-width: min(1440px, 100%);
		margin: 0 auto;
	}

	.app-workspace.is-sidebar-collapsed {
		grid-template-columns: 84px minmax(0, 1fr);
	}

	.app-sidebar {
		position: sticky;
		top: clamp(0.8rem, 1.6vw, 1.4rem);
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		border-radius: 0;
		max-height: calc(100vh - clamp(1.6rem, 3.2vw, 2.8rem) - var(--player-height, 0px));
		overflow-y: auto;
		background: #111111;
		border: 1px solid rgba(212, 212, 212, 0.24);
		box-shadow: none;
		animation: surface-rise 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.app-sidebar__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.app-sidebar__brand {
		min-width: 0;
	}

	.app-sidebar__title {
		margin: 0;
		font-size: 1.08rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: rgba(245, 245, 245, 0.95);
	}

	.app-sidebar__subtitle {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: rgba(212, 212, 212, 0.78);
	}

	.app-sidebar__section {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding-top: 0.2rem;
	}

	.app-sidebar__section-title {
		margin: 0;
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: rgba(161, 161, 161, 0.72);
	}

	.sidebar-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0;
		border: 1px solid rgba(212, 212, 212, 0.32);
		background: rgba(17, 17, 17, 0.5);
		color: rgba(236, 236, 236, 0.95);
		cursor: pointer;
		transition:
			border-color 150ms ease,
			background-color 150ms ease,
			transform 140ms ease;
	}

	.sidebar-icon-btn:hover {
		transform: translateY(-1px);
		border-color: rgba(255, 255, 255, 0.65);
		background: rgba(24, 24, 24, 0.62);
	}

	.sidebar-action {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.78rem 0.86rem;
		border-radius: 0;
		border: 1px solid rgba(212, 212, 212, 0.22);
		background: #141414;
		color: rgba(236, 236, 236, 0.9);
		text-decoration: none;
		font-size: 0.92rem;
		font-weight: 600;
		line-height: 1.1;
		cursor: pointer;
		position: relative;
		overflow: hidden;
		transition:
			border-color 140ms ease,
			transform 140ms ease,
			background-color 160ms ease,
			box-shadow 160ms ease;
	}

	.sidebar-action::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, rgba(255, 255, 255, 0.15), transparent 70%);
		opacity: 0;
		transition: opacity 160ms ease;
	}

	.sidebar-action:hover:not(:disabled) {
		transform: translateY(-1px);
		border-color: rgba(255, 255, 255, 0.32);
		background: #1a1a1a;
		box-shadow: none;
	}

	.sidebar-action:hover::after {
		opacity: 1;
	}

	.sidebar-action.is-active {
		border-color: rgba(30, 215, 96, 0.7);
		background: rgba(30, 215, 96, 0.16);
		box-shadow: none;
	}

	.sidebar-action.is-active::after {
		opacity: 1;
	}

	.sidebar-action:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.sidebar-action__label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sidebar-action__bubble {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.45rem;
		padding: 0.22rem 0.45rem;
		border-radius: 0;
		border: 1px solid rgba(30, 215, 96, 0.7);
		background: rgba(30, 215, 96, 0.22);
		color: rgba(232, 255, 242, 0.96);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		line-height: 1;
		position: relative;
		z-index: 1;
	}

	.app-sidebar__meta {
		margin-top: auto;
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		padding-top: 0.35rem;
	}

	.app-sidebar__meta-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem 0.55rem;
		border-radius: 0;
		border: 1px solid rgba(212, 212, 212, 0.4);
		background: rgba(12, 12, 12, 0.52);
		font-size: 0.74rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(235, 235, 235, 0.96);
	}

	.diagnostics-toggle {
		position: fixed;
		left: 1.5rem;
		bottom: calc(1.5rem + var(--player-height, 0px));
		z-index: 110;
		border-radius: 0;
		padding: 0.45rem 1rem;
		background: rgba(255, 255, 255, 0.14);
		border: 1px solid rgba(255, 255, 255, 0.35);
		color: #e2e8f0;
		font-size: 0.94rem;
		cursor: pointer;
		backdrop-filter: blur(10px);
	}

	.diagnostics-toggle:hover {
		background: rgba(255, 255, 255, 0.22);
	}

	.glass-panel {
		background: var(--surface-color);
		border: 1px solid var(--surface-border, rgba(212, 212, 212, 0.2));
		border-radius: var(--ui-radius-lg, 18px);
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		box-shadow: none;
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

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
	}

	.settings-section--wide {
		grid-column: span 1;
	}

	.section-heading {
		font-size: 0.78rem;
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
		background: #161616;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		padding: 0.56rem 0.7rem;
		color: inherit;
		text-decoration: none;
		font-size: 0.92rem;
		cursor: pointer;
		text-align: left;
		transition:
			border-color 140ms ease,
			transform 140ms ease,
			box-shadow 160ms ease;
	}

	.glass-option--compact {
		padding: 0.45rem 0.6rem;
		gap: 0.5rem;
		border-radius: 0;
	}

	.glass-option--compact .glass-option__label {
		font-size: 0.86rem;
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
		border-color: var(--bloom-accent, #1db954);
		background: rgba(30, 215, 96, 0.14);
		box-shadow: none;
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
		font-size: 0.94rem;
	}

	.glass-option__description {
		font-size: 0.82rem;
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
		font-size: 0.76rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		padding: 0.2rem 0.55rem;
		border-radius: 0;
		background: rgba(11, 11, 11, 0.52);
		backdrop-filter: blur(16px) saturate(140%);
		-webkit-backdrop-filter: blur(16px) saturate(140%);
		border: 1px solid rgba(212, 212, 212, 0.45);
		color: rgba(236, 236, 236, 0.9);
		flex-shrink: 0;
	}

	.glass-option__chip.is-active {
		border-color: var(--bloom-accent, rgba(255, 255, 255, 0.75));
		color: rgba(245, 245, 245, 0.98);
		box-shadow: none;
	}

	.settings-section--bordered {
		padding-top: 0.65rem;
		border-top: 1px solid rgba(212, 212, 212, 0.12);
	}

	@media (min-width: 960px) {
		.settings-grid {
			grid-template-columns: repeat(2, minmax(260px, 1fr));
		}

		.settings-section--bordered {
			grid-column: span 2;
		}
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
		background: #171717;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		padding: 0.74rem 0.95rem;
		font-size: 0.92rem;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
		transition:
			border-color 140ms ease,
			box-shadow 160ms ease,
			transform 160ms ease;
	}

	.glass-action:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.glass-action:hover:not(:disabled) {
		transform: translateY(-1px) scale(1.002);
		border-color: rgba(255, 255, 255, 0.44);
		box-shadow: none;
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
		font-size: 0.82rem;
		color: rgba(212, 212, 212, 0.7);
		line-height: 1.4;
	}

	.app-main {
		flex: 1;
		padding: clamp(1.5rem, 2.5vw, 2.8rem);
		margin: clamp(1rem, 1.5vw, 1.75rem) clamp(0.75rem, 2vw, 1.5rem);
		border-radius: 0;
		position: relative;
		z-index: 1;
		animation: surface-rise 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.app-main--workspace {
		margin: 0;
		min-width: 0;
	}

	.app-main__inner {
		max-width: min(1160px, 100%);
		margin: 0 auto;
	}

	.app-workspace.is-sidebar-collapsed .app-sidebar {
		padding-inline: 0.5rem;
	}

	.app-workspace.is-sidebar-collapsed .app-sidebar__header {
		justify-content: center;
	}

	.app-workspace.is-sidebar-collapsed .app-sidebar__brand,
	.app-workspace.is-sidebar-collapsed .app-sidebar__section-title,
	.app-workspace.is-sidebar-collapsed .sidebar-action__label,
	.app-workspace.is-sidebar-collapsed .sidebar-action__bubble,
	.app-workspace.is-sidebar-collapsed .app-sidebar__meta {
		display: none;
	}

	.app-workspace.is-sidebar-collapsed .app-sidebar__section {
		align-items: center;
	}

	.app-workspace.is-sidebar-collapsed .sidebar-action {
		width: 100%;
		justify-content: center;
	}

	.navigation-overlay {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2rem;
		background: transparent;
		backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		z-index: 50;
	}

	.navigation-overlay__progress {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		overflow: hidden;
		background: transparent;
		backdrop-filter: blur(8px) saturate(120%);
		-webkit-backdrop-filter: blur(8px) saturate(120%);
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.15);
	}

	.navigation-progress {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -40%;
		width: 60%;
			background: linear-gradient(
				90deg,
				transparent,
				var(--bloom-accent, rgba(255, 255, 255, 0.9)),
				transparent
			);
		box-shadow: 0 0 12px var(--bloom-accent, rgba(255, 255, 255, 0.5));
		animation: shimmer 1.2s ease-in-out infinite;
	}

	.navigation-overlay__content {
		font-size: 0.9rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: rgba(236, 236, 236, 0.9);
	}

	@keyframes ambient-float {
		0% {
			transform: translate3d(0, 0, 0) scale(1);
		}
		100% {
			transform: translate3d(24px, -20px, 0) scale(1.08);
		}
	}

	@keyframes surface-rise {
		0% {
			opacity: 0;
			transform: translateY(10px);
		}
		100% {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes shimmer {
		0% {
			transform: translateX(0);
			opacity: 0.2;
		}
		50% {
			transform: translateX(250%);
			opacity: 0.85;
		}
		100% {
			transform: translateX(400%);
			opacity: 0;
		}
	}

	:global(.animate-spin-slower) {
		animation: spin-slower 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes spin-slower {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	@media (min-width: 768px) {
		.settings-grid {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 1.2rem;
		}

		.settings-section--wide {
			grid-column: span 2;
		}

		.option-grid--compact {
			grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		}

		.settings-section--bordered {
			border-top: none;
			padding-top: 0;
		}
	}

	@media (max-width: 1023px) {
		.app-workspace {
			display: block;
			padding: 0;
		}

		.app-sidebar {
			display: none;
		}

		.app-main--workspace {
			margin: clamp(1rem, 1.5vw, 1.75rem) clamp(0.75rem, 2vw, 1.5rem);
		}
	}

	@media (max-width: 640px) {
		.app-main {
			padding: 1.4rem;
			margin: 1rem 0.75rem;
		}
	}
</style>
