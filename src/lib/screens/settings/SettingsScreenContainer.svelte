<script lang="ts">
	import { get } from 'svelte/store';
	import { toasts } from '$lib/stores/toasts';
	import { downloadLogStore } from '$lib/stores/downloadLog';
	import { artistCacheStore } from '$lib/stores/artistCache';
	import {
		downloadPreferencesStore,
		type DownloadMode,
		type DownloadStorage
	} from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import {
		fetchCorrectAndDeduplicateStatus,
		fetchLibraryDeduplicateStatus,
		fetchFullLibraryRepairStatus
	} from '$lib/utils/mediaLibraryClient';
	import { type AudioQuality } from '$lib/types';
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
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import StateNotice from '$lib/components/ui/StateNotice.svelte';
	import ToolPanel from '$lib/components/ui/ToolPanel.svelte';
	import { onDestroy } from 'svelte';
	import { createAdaptivePollingController } from '$lib/utils/adaptivePolling';
	import './settings-page-content.css';
	import {
		createSettingsStatusPoller,
		formatCorrectionDedupProgress,
		formatFullLibraryRepairProgress,
		formatLibraryDeduplicateProgress
	} from '$lib/features/settings/polling';
	import { createSettingsQueueExportController } from '$lib/features/settings/settingsQueueExportController';
	import { createSettingsMaintenanceController } from '$lib/features/settings/settingsMaintenanceController';
	import {
		SETTINGS_PERFORMANCE_OPTIONS,
		SETTINGS_QUALITY_OPTIONS
	} from '$lib/features/settings/options';
	import { confirm as requestConfirmation } from '$lib/stores/dialogs';

	const MAX_QUEUE_ZIP_TRACKS = 75;

	let isZipDownloading = $state(false);
	let isCsvExporting = $state(false);
	let isLegacyQueueDownloading = $state(false);
	let isCacheClearing = $state(false);
	let isLibraryTransientSweeping = $state(false);
	let libraryTransientSweepSummary = $state<string | null>(null);
	let isCorrectionDedupRunning = $state(false);
	let correctionDedupSummary = $state<string | null>(null);
	let correctionDedupProgress = $state<string | null>(null);
	let isFullLibraryRepairing = $state(false);
	let fullLibraryRepairSummary = $state<string | null>(null);
	let fullLibraryRepairProgress = $state<string | null>(null);
	let isLibraryDeduplicating = $state(false);
	let libraryDeduplicateSummary = $state<string | null>(null);
	let libraryDeduplicateProgress = $state<string | null>(null);
	let statusPollController = createAdaptivePollingController({
		run: async () => {
			await refreshTargetsStatus();
		},
		visibleIntervalMs: 15_000,
		hiddenIntervalMs: 60_000,
		pauseWhenHidden: true
	});
	let apiTargetsStatusLoading = $state(false);
	let statusTargets = $state<{
		success?: boolean;
		source?: string;
		targetCount?: number;
		browseTargetCount?: number;
		streamTargetCount?: number;
		qobuzTargetCount?: number;
		lastSuccessfulRefreshIso?: string | null;
		error?: string | null;
		targets?: Array<{ name: string; baseUrl: string; weight: number }>;
		browseTargets?: Array<{ name: string; baseUrl: string; weight: number }>;
		streamTargets?: Array<{ name: string; baseUrl: string; weight: number }>;
		qobuzTargets?: Array<{ name: string; baseUrl: string; weight: number }>;
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
	const strictMusicBrainzMatching = $derived($userPreferencesStore.strictMusicBrainzMatching);

	const activeQualityLabel = $derived(
		SETTINGS_QUALITY_OPTIONS.find((option) => option.value === $downloadPreferencesStore.downloadQuality)
			?.label ??
			$downloadPreferencesStore.downloadQuality
	);
	const activePerformanceLabel = $derived(
		SETTINGS_PERFORMANCE_OPTIONS.find((option) => option.value === $userPreferencesStore.performanceMode)
			?.label ??
			$userPreferencesStore.performanceMode
	);
	const sectionNavItems = [
		{ id: 'settings-audio', label: 'Audio', tone: 'secondary' as const },
		{ id: 'settings-downloads', label: 'Downloads', tone: 'tertiary' as const },
		{ id: 'settings-queue', label: 'Queue Actions', tone: 'secondary' as const },
		{ id: 'settings-system', label: 'System', tone: 'tertiary' as const }
	];
	let showGuidance = $state(false);

	$effect(() => {
		if (isServerStorage && downloadMode !== 'individual') {
			downloadPreferencesStore.setMode('individual');
		}
	});

	$effect(() => {
		statusPollController.stop();
		statusPollController = createAdaptivePollingController({
			run: async () => {
				await refreshTargetsStatus();
			},
			visibleIntervalMs: 15_000,
			hiddenIntervalMs: 60_000,
			pauseWhenHidden: true
		});
		statusPollController.start();
		return () => {
			statusPollController.stop();
		};
	});

	onDestroy(() => {
		stopCorrectionDedupPolling();
		stopFullLibraryRepairPolling();
		stopLibraryDeduplicatePolling();
		statusPollController.stop();
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

	const selectDownloadQuality = (quality: AudioQuality): void =>
		downloadPreferencesStore.setDownloadQuality(quality);
	const toggleAacConversion = (): void => userPreferencesStore.toggleConvertAacToMp3();
	const toggleDownloadCoversSeperately = (): void =>
		userPreferencesStore.toggleDownloadCoversSeperately();
	const toggleExperimentalMusicBrainzTagging = (): void =>
		userPreferencesStore.toggleExperimentalMusicBrainzTagging();
	const toggleStrictMusicBrainzMatching = (): void => userPreferencesStore.toggleStrictMusicBrainzMatching();
	const setDownloadMode = (mode: DownloadMode): void => downloadPreferencesStore.setMode(mode);
	const setDownloadStorage = (storage: DownloadStorage): void =>
		downloadPreferencesStore.setStorage(storage);
	const setPerformanceMode = (mode: 'medium' | 'low'): void => userPreferencesStore.setPerformanceMode(mode);

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

	const fullLibraryRepairPoller = createSettingsStatusPoller({
		fetchStatus: fetchFullLibraryRepairStatus,
		isRunningStatus: (status) => status.success === true && status.status === 'running',
		mapProgress: formatFullLibraryRepairProgress,
		onProgress: (message) => {
			fullLibraryRepairProgress = message;
			logMaintenanceMessage('Library Repair', message);
		}
	});

	function stopFullLibraryRepairPolling(): void {
		fullLibraryRepairPoller.stop();
	}

	function startFullLibraryRepairPolling(): void {
		fullLibraryRepairPoller.start();
	}

	async function handleFullLibraryRepair(): Promise<void> {
		await maintenanceController.handleFullLibraryRepair();
	}

	async function handleSweepTransientArtifacts(): Promise<void> {
		await maintenanceController.handleSweepTransientArtifacts();
	}

	async function handleCorrectionSweepThenDedupe(): Promise<void> {
		await maintenanceController.handleCorrectionSweepThenDedupe();
	}

	const correctionDedupPoller = createSettingsStatusPoller({
		fetchStatus: fetchCorrectAndDeduplicateStatus,
		isRunningStatus: (status) => status.success === true && status.status === 'running',
		mapProgress: formatCorrectionDedupProgress,
		onProgress: (message) => {
			correctionDedupProgress = message;
			logMaintenanceMessage('Correction + Dedupe', message);
		}
	});

	function stopCorrectionDedupPolling(): void {
		correctionDedupPoller.stop();
	}

	function startCorrectionDedupPolling(): void {
		correctionDedupPoller.start();
	}

	async function handleLibraryDeduplicate(): Promise<void> {
		await maintenanceController.handleLibraryDeduplicate();
	}

	const libraryDeduplicatePoller = createSettingsStatusPoller({
		fetchStatus: fetchLibraryDeduplicateStatus,
		isRunningStatus: (status) => status.success === true && status.status === 'running',
		mapProgress: formatLibraryDeduplicateProgress,
		onProgress: (message) => {
			libraryDeduplicateProgress = message;
			logMaintenanceMessage('Library Dedupe', message);
		}
	});

	function stopLibraryDeduplicatePolling(): void {
		libraryDeduplicatePoller.stop();
	}

	function startLibraryDeduplicatePolling(): void {
		libraryDeduplicatePoller.start();
	}

	const maintenanceController = createSettingsMaintenanceController({
		confirm: (request) => requestConfirmation(request),
		getDownloadQuality: () => get(downloadPreferencesStore).downloadQuality,
		isFullLibraryRepairing: () => isFullLibraryRepairing,
		setFullLibraryRepairing: (value) => {
			isFullLibraryRepairing = value;
		},
		setFullLibraryRepairSummary: (value) => {
			fullLibraryRepairSummary = value;
		},
		setFullLibraryRepairProgress: (value) => {
			fullLibraryRepairProgress = value;
		},
		startFullLibraryRepairPolling,
		stopFullLibraryRepairPolling,
		isLibraryTransientSweeping: () => isLibraryTransientSweeping,
		setLibraryTransientSweeping: (value) => {
			isLibraryTransientSweeping = value;
		},
		setLibraryTransientSweepSummary: (value) => {
			libraryTransientSweepSummary = value;
		},
		isCorrectionDedupRunning: () => isCorrectionDedupRunning,
		setCorrectionDedupRunning: (value) => {
			isCorrectionDedupRunning = value;
		},
		setCorrectionDedupSummary: (value) => {
			correctionDedupSummary = value;
		},
		setCorrectionDedupProgress: (value) => {
			correctionDedupProgress = value;
		},
		startCorrectionDedupPolling,
		stopCorrectionDedupPolling,
		isLibraryDeduplicating: () => isLibraryDeduplicating,
		setLibraryDeduplicating: (value) => {
			isLibraryDeduplicating = value;
		},
		setLibraryDeduplicateSummary: (value) => {
			libraryDeduplicateSummary = value;
		},
		setLibraryDeduplicateProgress: (value) => {
			libraryDeduplicateProgress = value;
		},
		startLibraryDeduplicatePolling,
		stopLibraryDeduplicatePolling,
		resetMaintenanceLogScope,
		logMaintenanceMessage
	});

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
				: {
						success: false,
						source: 'unknown',
						targetCount: 0,
						browseTargetCount: 0,
						streamTargetCount: 0,
						qobuzTargetCount: 0,
						error: message,
						targets: [],
						browseTargets: [],
						streamTargets: [],
						qobuzTargets: []
				  };
		} finally {
			apiTargetsStatusLoading = false;
		}
	}

	const queueExportController = createSettingsQueueExportController({
		maxQueueZipTracks: MAX_QUEUE_ZIP_TRACKS,
		getDownloadMode: () => downloadMode,
		getStorage: () => get(downloadPreferencesStore).storage,
		setDownloadMode,
		isServerStorage: () => isServerStorage,
		isQueueActionBusy: () => queueActionBusy,
		getConvertAacToMp3: () => convertAacToMp3,
		getDownloadCoversSeparately: () => downloadCoversSeperately,
		getExperimentalMusicBrainzTagging: () => experimentalMusicBrainzTagging,
		getStrictMusicBrainzMatching: () => strictMusicBrainzMatching,
		setZipDownloading: (downloading) => {
			isZipDownloading = downloading;
		},
		setCsvExporting: (exporting) => {
			isCsvExporting = exporting;
		},
		setLegacyQueueDownloading: (downloading) => {
			isLegacyQueueDownloading = downloading;
		}
	});

	async function handleExportQueueCsv(): Promise<void> {
		await queueExportController.handleExportQueueCsv();
	}

	async function handleQueueDownload(): Promise<void> {
		await queueExportController.handleQueueDownload();
	}
</script>

<div class="settings-layout" data-ui-block="main-sections" data-guidance={showGuidance ? 'on' : 'off'}>
	<div class="settings-summary" data-ui-block="key-summary">
		<div class="settings-summary__item">
			<p class="settings-summary__label">Quality</p>
			<p class="settings-summary__value">{activeQualityLabel}</p>
		</div>
		<div class="settings-summary__item">
			<p class="settings-summary__label">Storage</p>
			<p class="settings-summary__value">{isServerStorage ? 'Server-side' : 'Client-side'}</p>
		</div>
		<div class="settings-summary__item">
			<p class="settings-summary__label">Queue Format</p>
			<p class="settings-summary__value">
				{downloadMode === 'zip'
					? 'ZIP'
					: downloadMode === 'csv'
						? 'CSV links'
						: 'Individual files'}
			</p>
		</div>
		<div class="settings-summary__item">
			<p class="settings-summary__label">Performance</p>
			<p class="settings-summary__value">{activePerformanceLabel}</p>
		</div>
	</div>
	<div class="settings-summary-controls">
		<button
			type="button"
			class="ui-chip-button settings-summary-controls__toggle"
			data-tone="secondary"
			onclick={() => {
				showGuidance = !showGuidance;
			}}
			aria-pressed={showGuidance}
		>
			{showGuidance ? 'Hide guidance' : 'Show guidance'}
		</button>
	</div>

	<PageSectionNav items={sectionNavItems} sticky={true} showOnDesktop={false} />

	<div id="settings-audio" class="ui-section-anchor">
	<ToolPanel
		wide={true}
		tone="secondary"
		panelRole="audio-metadata"
		eyebrow="Audio"
		title="Playback & Metadata"
		subtitle="Set quality, conversion, and tagging behavior for new downloads."
	>

		<div class="settings-block">
			<p class="settings-block__label">Preferred download quality</p>
			<div class="settings-choice-grid settings-choice-grid--quality">
				{#each SETTINGS_QUALITY_OPTIONS as option (option.value)}
					<button
						type="button"
						onclick={() => selectDownloadQuality(option.value)}
						class={`settings-choice ${option.value === $downloadPreferencesStore.downloadQuality ? 'is-active' : ''} ${option.disabled ? 'is-disabled' : ''}`}
						aria-pressed={option.value === $downloadPreferencesStore.downloadQuality}
						disabled={option.disabled}
					>
						<span class="settings-choice__copy">
							<span class="settings-choice__title">{option.label}</span>
							<span class="settings-choice__description">{option.description}</span>
						</span>
						{#if option.value === $downloadPreferencesStore.downloadQuality}
							<Check size={16} class="settings-choice__check" />
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<div class="settings-block">
			<p class="settings-block__label">Conversion & tagging</p>
			<div class="settings-toggle-list">
				<button
					type="button"
					onclick={toggleAacConversion}
					class={`settings-toggle ${convertAacToMp3 ? 'is-active' : ''} ${isServerStorage ? 'is-disabled' : ''}`}
					aria-pressed={convertAacToMp3}
					disabled={isServerStorage}
				>
					<span class="settings-toggle__copy">
						<span class="settings-toggle__title">Convert AAC downloads to MP3</span>
						<span class="settings-toggle__description">
							{isServerStorage
								? 'Client-only. Server downloads keep the original AAC codec.'
								: 'Applies to 320kbps and 96kbps downloads.'}
						</span>
					</span>
					<span class="settings-toggle__control">
						<span class="settings-toggle__state">{convertAacToMp3 ? 'On' : 'Off'}</span>
						<span class={`settings-toggle__switch ${convertAacToMp3 ? 'is-active' : ''}`}>
							<span class="settings-toggle__thumb"></span>
						</span>
					</span>
				</button>

				<button
					type="button"
					onclick={toggleDownloadCoversSeperately}
					class={`settings-toggle ${downloadCoversSeperately ? 'is-active' : ''} ${isServerStorage ? 'is-disabled' : ''}`}
					aria-pressed={downloadCoversSeperately}
					disabled={isServerStorage}
				>
					<span class="settings-toggle__copy">
						<span class="settings-toggle__title">Download covers separately</span>
						<span class="settings-toggle__description">
							{isServerStorage
								? 'Server downloads store cover art next to audio files.'
								: 'Save cover.jpg alongside audio files.'}
						</span>
					</span>
					<span class="settings-toggle__control">
						<span class="settings-toggle__state">{downloadCoversSeperately ? 'On' : 'Off'}</span>
						<span class={`settings-toggle__switch ${downloadCoversSeperately ? 'is-active' : ''}`}>
							<span class="settings-toggle__thumb"></span>
						</span>
					</span>
				</button>

				<button
					type="button"
					onclick={toggleExperimentalMusicBrainzTagging}
					class={`settings-toggle ${experimentalMusicBrainzTagging ? 'is-active' : ''}`}
					aria-pressed={experimentalMusicBrainzTagging}
				>
					<span class="settings-toggle__copy">
						<span class="settings-toggle__title">MusicBrainz lookup & tagging</span>
						<span class="settings-toggle__description">
							Default on. Looks up release/track metadata in MusicBrainz and embeds extended
							tags into downloaded files.
						</span>
					</span>
					<span class="settings-toggle__control">
						<span class="settings-toggle__state">{experimentalMusicBrainzTagging ? 'On' : 'Off'}</span>
						<span class={`settings-toggle__switch ${experimentalMusicBrainzTagging ? 'is-active' : ''}`}>
							<span class="settings-toggle__thumb"></span>
						</span>
					</span>
				</button>

				<button
					type="button"
					onclick={toggleStrictMusicBrainzMatching}
					class={`settings-toggle ${strictMusicBrainzMatching ? 'is-active' : ''} ${!experimentalMusicBrainzTagging ? 'is-disabled' : ''}`}
					aria-pressed={strictMusicBrainzMatching}
					disabled={!experimentalMusicBrainzTagging}
				>
					<span class="settings-toggle__copy">
						<span class="settings-toggle__title">Strict MusicBrainz matching (ISRC-only)</span>
						<span class="settings-toggle__description">
							Only accept matches with exact ISRC values. Reduces false matches but may skip
							tagging when ISRC is unavailable.
						</span>
					</span>
					<span class="settings-toggle__control">
						<span class="settings-toggle__state">{strictMusicBrainzMatching ? 'On' : 'Off'}</span>
						<span class={`settings-toggle__switch ${strictMusicBrainzMatching ? 'is-active' : ''}`}>
							<span class="settings-toggle__thumb"></span>
						</span>
					</span>
				</button>
			</div>
		</div>
	</ToolPanel>
	</div>

	<div id="settings-downloads" class="ui-section-anchor">
	<ToolPanel
		tone="tertiary"
		panelRole="download-behavior"
		eyebrow="Downloads"
		title="Download Behavior"
		subtitle="Choose where files are stored and how queue exports are packaged."
	>

		<div class="settings-block">
			<p class="settings-block__label">Download target</p>
			<div class="settings-choice-grid settings-choice-grid--compact">
				<button
					type="button"
					onclick={() => setDownloadStorage('client')}
					class={`settings-choice settings-choice--compact ${$downloadPreferencesStore.storage === 'client' ? 'is-active' : ''}`}
					aria-pressed={$downloadPreferencesStore.storage === 'client'}
				>
					<span class="settings-choice__copy">
						<span class="settings-choice__title">
							<Download size={16} />
							<span>Client-side</span>
						</span>
						<span class="settings-choice__description">Download to this browser/device.</span>
					</span>
					{#if $downloadPreferencesStore.storage === 'client'}
						<Check size={14} class="settings-choice__check" />
					{/if}
				</button>
				<button
					type="button"
					onclick={() => setDownloadStorage('server')}
					class={`settings-choice settings-choice--compact ${$downloadPreferencesStore.storage === 'server' ? 'is-active' : ''}`}
					aria-pressed={$downloadPreferencesStore.storage === 'server'}
				>
					<span class="settings-choice__copy">
						<span class="settings-choice__title">
							<Download size={16} />
							<span>Server-side</span>
						</span>
						<span class="settings-choice__description">Save files directly on server disk.</span>
					</span>
					{#if $downloadPreferencesStore.storage === 'server'}
						<Check size={14} class="settings-choice__check" />
					{/if}
				</button>
			</div>
			<p class="settings-block__note">
				{isServerStorage
					? 'Files are saved on the server. Use Download Log for status and resolved paths.'
					: 'Files are downloaded to your browser.'}
			</p>
		</div>

		<div class="settings-block">
			<p class="settings-block__label">Queue export format</p>
			<div class="settings-choice-grid settings-choice-grid--compact">
				<button
					type="button"
					onclick={() => setDownloadMode('individual')}
					class={`settings-choice settings-choice--compact ${downloadMode === 'individual' ? 'is-active' : ''}`}
					aria-pressed={downloadMode === 'individual'}
				>
					<span class="settings-choice__copy">
						<span class="settings-choice__title">
							<Download size={16} />
							<span>Individual</span>
						</span>
						<span class="settings-choice__description">One file per track.</span>
					</span>
					{#if downloadMode === 'individual'}
						<Check size={14} class="settings-choice__check" />
					{/if}
				</button>
				<button
					type="button"
					onclick={() => setDownloadMode('zip')}
					class={`settings-choice settings-choice--compact ${downloadMode === 'zip' ? 'is-active' : ''} ${isServerStorage ? 'is-disabled' : ''}`}
					aria-pressed={downloadMode === 'zip'}
					disabled={isServerStorage}
				>
					<span class="settings-choice__copy">
						<span class="settings-choice__title">
							<Archive size={16} />
							<span>ZIP archive</span>
						</span>
						<span class="settings-choice__description">Bundle queue into one zip.</span>
					</span>
					{#if downloadMode === 'zip'}
						<Check size={14} class="settings-choice__check" />
					{/if}
				</button>
				<button
					type="button"
					onclick={() => setDownloadMode('csv')}
					class={`settings-choice settings-choice--compact ${downloadMode === 'csv' ? 'is-active' : ''} ${isServerStorage ? 'is-disabled' : ''}`}
					aria-pressed={downloadMode === 'csv'}
					disabled={isServerStorage}
				>
					<span class="settings-choice__copy">
						<span class="settings-choice__title">
							<FileSpreadsheet size={16} />
							<span>CSV links</span>
						</span>
						<span class="settings-choice__description">Export track links only.</span>
					</span>
					{#if downloadMode === 'csv'}
						<Check size={14} class="settings-choice__check" />
					{/if}
				</button>
			</div>
			{#if isServerStorage}
				<p class="settings-block__note">
					Server downloads always run as individual files. ZIP and CSV exports are client-only.
				</p>
			{/if}
		</div>
	</ToolPanel>
	</div>

	<div id="settings-queue" class="ui-section-anchor" data-ui-block="primary-actions">
		<ToolPanel
			tone="secondary"
			panelRole="queue-actions"
			eyebrow="Queue"
			title="Queue Actions"
			subtitle="Run queue downloads or export queue links."
		>

		<div class="settings-action-stack">
			<button
				onclick={handleQueueDownload}
				type="button"
				class="settings-action settings-action--primary"
				disabled={queueActionBusy}
			>
				<span class="settings-action__label">
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
					<LoaderCircle size={16} class="settings-action__spinner animate-spin" />
				{/if}
			</button>
			{#if !isServerStorage}
				<button
					onclick={handleExportQueueCsv}
					type="button"
					class="settings-action"
					disabled={isCsvExporting}
				>
					<span class="settings-action__label">
						<FileSpreadsheet size={16} />
						<span>Export links as CSV</span>
					</span>
					{#if isCsvExporting}
						<LoaderCircle size={16} class="settings-action__spinner animate-spin" />
					{/if}
				</button>
			{/if}
		</div>
		<p class="settings-block__note">
			{isServerStorage
				? 'Server saves run in the background and avoid browser download prompts.'
				: 'Queue actions follow your selected format. ZIP bundles need at least two tracks.'}
		</p>
		</ToolPanel>
	</div>

	<div id="settings-system" class="ui-section-anchor">
	<ToolPanel
		wide={true}
		tone="tertiary"
		panelRole="system-maintenance"
		eyebrow="System"
		title="System & Maintenance"
		subtitle="Performance, cache hygiene, API health, and library repair tools."
	>

		<div class="settings-system-grid">
			<div class="settings-block">
				<p class="settings-block__label">API target health</p>
				<ApiTargetsStatusCard
					title="API Status"
					status={statusTargets}
					loading={apiTargetsStatusLoading}
					lastUpdatedAt={statusLastUpdatedAt}
					onRefresh={() => void refreshTargetsStatus(true)}
				/>
			</div>

			<div class="settings-block">
				<p class="settings-block__label">Performance mode</p>
				<div class="settings-choice-grid settings-choice-grid--compact">
					{#each SETTINGS_PERFORMANCE_OPTIONS as option (option.value)}
						<button
							type="button"
							onclick={() => setPerformanceMode(option.value)}
							class={`settings-choice settings-choice--compact ${option.value === $userPreferencesStore.performanceMode ? 'is-active' : ''}`}
							aria-pressed={option.value === $userPreferencesStore.performanceMode}
						>
							<span class="settings-choice__copy">
								<span class="settings-choice__title">{option.label}</span>
								<span class="settings-choice__description">{option.description}</span>
							</span>
							{#if option.value === $userPreferencesStore.performanceMode}
								<Check size={14} class="settings-choice__check" />
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<div class="settings-block">
				<p class="settings-block__label">Cache</p>
				<button
					type="button"
					onclick={handleClearCaches}
					class="settings-action"
					disabled={isCacheClearing}
				>
					<span class="settings-action__label">
						<Trash2 size={16} />
						<span>{isCacheClearing ? 'Clearing cache…' : 'Clear app cache'}</span>
					</span>
					{#if isCacheClearing}
						<LoaderCircle size={16} class="settings-action__spinner animate-spin" />
					{/if}
				</button>
				<p class="settings-block__note">
					Clears artist/discography cache, enrichment cache, and proxied cover cache.
				</p>
			</div>

			<div class="settings-block settings-block--full">
				<p class="settings-block__label">Library maintenance actions</p>
				<div class="settings-action-stack settings-action-stack--maintenance">
					<button
						type="button"
						onclick={handleFullLibraryRepair}
						class="settings-action settings-action--primary"
						disabled={isFullLibraryRepairing || isLibraryTransientSweeping || isLibraryDeduplicating || isCorrectionDedupRunning}
						aria-busy={isFullLibraryRepairing}
					>
						<span class="settings-action__label">
							<Download size={16} />
							<span>{isFullLibraryRepairing ? 'Auto-repair running…' : 'Auto-repair full library'}</span>
						</span>
						{#if isFullLibraryRepairing}
							<LoaderCircle size={16} class="settings-action__spinner animate-spin" />
						{/if}
					</button>

					<button
						type="button"
						onclick={handleSweepTransientArtifacts}
						class="settings-action"
						disabled={isLibraryTransientSweeping || isFullLibraryRepairing || isLibraryDeduplicating || isCorrectionDedupRunning}
						aria-busy={isLibraryTransientSweeping}
					>
						<span class="settings-action__label">
							<Trash2 size={16} />
							<span>{isLibraryTransientSweeping ? 'Sweeping temporary folders…' : 'Sweep stale publish/backup folders'}</span>
						</span>
						{#if isLibraryTransientSweeping}
							<LoaderCircle size={16} class="settings-action__spinner animate-spin" />
						{/if}
					</button>

					<button
						type="button"
						onclick={handleCorrectionSweepThenDedupe}
						class="settings-action"
						disabled={isCorrectionDedupRunning || isFullLibraryRepairing || isLibraryTransientSweeping || isLibraryDeduplicating}
						aria-busy={isCorrectionDedupRunning}
					>
						<span class="settings-action__label">
							<Activity size={16} />
							<span>{isCorrectionDedupRunning ? 'Running correction + dedupe…' : 'Correction sweep + dedupe'}</span>
						</span>
						{#if isCorrectionDedupRunning}
							<LoaderCircle size={16} class="settings-action__spinner animate-spin" />
						{/if}
					</button>

					<button
						type="button"
						onclick={handleLibraryDeduplicate}
						class="settings-action"
						disabled={isLibraryDeduplicating || isFullLibraryRepairing || isLibraryTransientSweeping || isCorrectionDedupRunning}
						aria-busy={isLibraryDeduplicating}
					>
						<span class="settings-action__label">
							<Trash2 size={16} />
							<span>{isLibraryDeduplicating ? 'Consolidating duplicates…' : 'Consolidate duplicate album files'}</span>
						</span>
						{#if isLibraryDeduplicating}
							<LoaderCircle size={16} class="settings-action__spinner animate-spin" />
						{/if}
					</button>
				</div>

				<div class="settings-feedback">
					{#if fullLibraryRepairSummary}
						<StateNotice tone="success" message={fullLibraryRepairSummary} compact={true} />
					{/if}
					{#if fullLibraryRepairProgress}
						<StateNotice tone="info" message={fullLibraryRepairProgress} compact={true} busy={true} />
					{/if}
					{#if libraryTransientSweepSummary}
						<StateNotice tone="success" message={libraryTransientSweepSummary} compact={true} />
					{/if}
					{#if correctionDedupSummary}
						<StateNotice tone="success" message={correctionDedupSummary} compact={true} />
					{/if}
					{#if correctionDedupProgress}
						<StateNotice tone="info" message={correctionDedupProgress} compact={true} busy={true} />
					{/if}
					{#if libraryDeduplicateSummary}
						<StateNotice tone="success" message={libraryDeduplicateSummary} compact={true} />
					{/if}
					{#if libraryDeduplicateProgress}
						<StateNotice tone="info" message={libraryDeduplicateProgress} compact={true} busy={true} />
					{/if}
				</div>
			</div>
		</div>
	</ToolPanel>
	</div>
</div>
