<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import LyricsPopup from '$lib/components/LyricsPopup.svelte';
	import DownloadLog from '$lib/components/DownloadLog.svelte';
	import DiagnosticsOverlay from '$lib/components/DiagnosticsOverlay.svelte';


	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';

	import { toasts } from '$lib/stores/toasts';
	import { playerStore } from '$lib/stores/player';
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
		ChevronDown,
		LoaderCircle,
		Download,
		Check,
		Settings
	} from 'lucide-svelte';
	import { type Track, type AudioQuality, type PlayableTrack, isSonglinkTrack } from '$lib/types';

	let { children, data } = $props();
	const pageTitle = $derived(data?.title ?? 'BiniLossless');
	let headerHeight = $state(0);
	let playerHeight = $state(0);
	let isPlayerVisible = $state(false);
	let AudioPlayerComponent = $state<typeof import('$lib/components/AudioPlayer.svelte').default | null>(
		null
	);
	let viewportHeight = $state(0);
	let showSettingsMenu = $state(false);

	let isZipDownloading = $state(false);
	let isCsvExporting = $state(false);
	let isLegacyQueueDownloading = $state(false);
	let settingsMenuContainer = $state<HTMLDivElement | null>(null);
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
	const diagnosticsEnabled = dev || import.meta.env.VITE_E2E === 'true';
	const MAX_QUEUE_ZIP_TRACKS = 75;
	let diagnosticsOpen = $state(false);
	let diagnosticsLoading = $state(false);
	let diagnosticsSummary = $state<ReturnType<typeof getErrorSummary> | null>(null);
	let diagnosticsDomains = $state<Record<string, number> | null>(null);
	let diagnosticsHealth = $state<{ status?: string; responseTime?: number; issues?: string[] } | null>(
		null
	);
	let diagnosticsPersisted = $state<ReturnType<typeof getPersistedErrorSummary> | null>(null);
	let diagnosticsRetries = $state<RetrySummary | null>(null);
	let diagnosticsErrors = $state<ErrorReport[] | null>(null);

	$effect(() => {
		const current = $playerStore.currentTrack;
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

	const mainMarginBottom = $derived(() => Math.max(playerHeight, 128));
	const settingsMenuOffset = $derived(() => Math.max(0, headerHeight + 12));

	const ensureAudioPlayerLoaded = async () => {
		if (AudioPlayerComponent) return;
		const module = await import('$lib/components/AudioPlayer.svelte');
		AudioPlayerComponent = module.default;
	};

	$effect(() => {
		if ($playerStore.currentTrack && !AudioPlayerComponent) {
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

	const downloadQualityLabel = $derived(() => {
		const quality = $downloadPreferencesStore.downloadQuality;
		if (quality === 'HI_RES_LOSSLESS') {
			return 'Hi-Res';
		}
		if (quality === 'LOSSLESS') {
			return 'CD';
		}
		return QUALITY_OPTIONS.find((option) => option.value === quality)?.label ?? 'Quality';
	});

	const convertAacToMp3 = $derived($userPreferencesStore.convertAacToMp3);
	const downloadCoversSeperately = $derived($userPreferencesStore.downloadCoversSeperately);

	function selectDownloadQuality(quality: AudioQuality): void {
		downloadPreferencesStore.setDownloadQuality(quality);
		showSettingsMenu = false;
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

	function toggleDownloadLog(): void {
		if (!isPlayerVisible) return;
		downloadLogStore.toggle();
	}

	async function refreshDiagnostics(): Promise<void> {
		diagnosticsLoading = true;
		diagnosticsSummary = getErrorSummary();
		diagnosticsDomains = errorTracker.getDomainSummary();
		diagnosticsPersisted = getPersistedErrorSummary();
		diagnosticsRetries = getRetrySummary();
		diagnosticsErrors = errorTracker.getErrors({ limit: 50 });
		try {
			const res = await fetch('/api/health');
			diagnosticsHealth = (await res.json()) as typeof diagnosticsHealth;
		} catch {
			diagnosticsHealth = null;
		} finally {
			diagnosticsLoading = false;
		}
	}

	function toggleDiagnostics(): void {
		diagnosticsOpen = !diagnosticsOpen;
		if (diagnosticsOpen) {
			void refreshDiagnostics();
		}
	}

	$effect(() => {
		if (!isPlayerVisible && $downloadLogStore.isVisible) {
			downloadLogStore.hide();
		}
	});

	$effect(() => {
		if (!isPlayerVisible && typeof document !== 'undefined') {
			document.documentElement.style.setProperty('--player-height', '0px');
		}
	});


	// Update page title with currently playing song
	$effect(() => {
		if (typeof document === 'undefined') return;

		const track = $playerStore.currentTrack;
		const isPlaying = $playerStore.isPlaying;

		if (track) {
			const artist = isSonglinkTrack(track) ? track.artistName : formatArtists(track.artists);
			const title = track.title ?? 'Unknown Track';
			const prefix = isPlaying ? '▶' : '⏸';
			document.title = `${prefix} ${title} • ${artist} | BiniLossless`;
		} else {
			document.title = pageTitle;
		}
	});

	onMount(() => {
		if (!diagnosticsEnabled) {
			return;
		}
		const handler = (event: KeyboardEvent) => {
			if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
				event.preventDefault();
				toggleDiagnostics();
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	});

	function collectQueueState(): { tracks: PlayableTrack[]; quality: AudioQuality } {
		const state = get(playerStore);
		const tracks = state.queue.length
			? state.queue
			: state.currentTrack
				? [state.currentTrack]
				: [];
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
					convertAacToMp3
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
			showSettingsMenu = false;
			toasts.warning('Add tracks to the queue before exporting.');
			return;
		}

		showSettingsMenu = false;
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
						downloadCoverSeperately: downloadCoversSeperately
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
			showSettingsMenu = false;
			toasts.warning('Add tracks to the queue before downloading.');
			return;
		}

		showSettingsMenu = false;

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
		const handleDocumentClick = (event: MouseEvent) => {
			const target = event.target as Node | null;
			if (showSettingsMenu) {
				const root = settingsMenuContainer;
				if (!root || !target || !root.contains(target)) {
					showSettingsMenu = false;
				}
			}
		};
		document.addEventListener('click', handleDocumentClick);

		// Check if we're in a local/dev environment where SW should be disabled
		const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
		const isLocalPreview =
			hostname === '127.0.0.1' ||
			hostname === 'localhost' ||
			// LAN IP ranges where self-signed certs may cause SW registration to fail
			/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
			/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
			/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);

		const shouldUseServiceWorker =
			!dev && !isLocalPreview && import.meta.env.VITE_E2E !== 'true';
		if ('serviceWorker' in navigator && !shouldUseServiceWorker) {
			navigator.serviceWorker
				.getRegistrations()
				.then((registrations) => {
					registrations.forEach((registration) => {
						void registration.unregister();
					});
				})
				.catch((error) => {
					console.warn('Failed to unregister service workers', error);
				});
		}
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
			document.removeEventListener('click', handleDocumentClick);
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
	<link rel="manifest" href="/manifest.webmanifest" />

	<meta name="theme-color" content="#0f172a" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</svelte:head>

{#if isEmbed}
	{@render children?.()}
	{#if AudioPlayerComponent}
		<AudioPlayerComponent headless={true} />
	{/if}
{:else}
	<div class="app-root">
	<div class="app-shell">
		<div class="settings-fab" bind:this={settingsMenuContainer}>
			<button
				onclick={() => {
					showSettingsMenu = !showSettingsMenu;
				}}
				type="button"
				class={`toolbar-button glass-button ${showSettingsMenu ? 'is-active' : ''}`}
				aria-haspopup="true"
				aria-expanded={showSettingsMenu}
				aria-label={`Settings menu (${downloadQualityLabel()})`}
			>
				<span class="toolbar-button__label">
					<Settings size={16} />
					<span class="toolbar-button__text">Settings</span>
				</span>
				<span class="text-gray-400">{downloadQualityLabel()}</span>
				<span class={`toolbar-button__chevron ${showSettingsMenu ? 'is-open' : ''}`}>
					<ChevronDown size={16} />
				</span>
			</button>
				{#if showSettingsMenu}
					<div class="settings-menu glass-popover" style={`--settings-menu-offset: ${settingsMenuOffset()}px;`} onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') showSettingsMenu = false; }} role="menu" tabindex="-1">
						<div class="settings-grid">
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
												<span
													class={`glass-option__chip ${downloadCoversSeperately ? 'is-active' : ''}`}
												>
													{downloadCoversSeperately ? 'On' : 'Off'}
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
											<p class="section-heading">Download Log</p>
											<button
												type="button"
												onclick={toggleDownloadLog}
												class="glass-option glass-option--wide glass-option--primary"
												disabled={false}
											>
												<span class="glass-option__content">
													<span class="glass-option__label">
														View Download Log
													</span>
													<span class="glass-option__description">
														{$downloadLogStore.isVisible
															? 'Hide real-time download progress'
															: isServerStorage
																? 'Show server download status and file location.'
																: 'Show real-time download progress'}
													</span>
												</span>
											</button>
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
										<section class="settings-section settings-section--bordered settings-section--wide">
											<p class="section-heading">Queue actions</p>
											<div class="actions-column">
												<button
													onclick={handleQueueDownload}
													type="button"
													class="glass-action"
													disabled={queueActionBusy}
												>
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
													<button
														onclick={handleExportQueueCsv}
														type="button"
														class="glass-action"
														disabled={isCsvExporting}
													>
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
	</div>
{/if}
			</div>

			<main
				class="app-main glass-panel !sm:mb-40 !mb-56"
				style={`min-height: ${mainMinHeight}px; margin-bottom: ${mainMarginBottom}px;`}
			>
				<div class="app-main__inner">
						<Breadcrumb />
						{@render children?.()}
				</div>
			</main>

			{#if $playerStore.currentTrack && AudioPlayerComponent}
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
	<DownloadLog />
	{#if diagnosticsEnabled && !isEmbed}
		<button class="diagnostics-toggle" type="button" onclick={toggleDiagnostics}>
			Diagnostics
		</button>
		<DiagnosticsOverlay
			open={diagnosticsOpen}
			loading={diagnosticsLoading}
			summary={diagnosticsSummary}
			domainCounts={diagnosticsDomains}
			health={diagnosticsHealth}
			persisted={diagnosticsPersisted}
			retries={diagnosticsRetries}
			errors={diagnosticsErrors}
			onClose={() => {
				diagnosticsOpen = false;
			}}
		/>
	{/if}
{/if}


<style>
	:global(:root) {
		--bloom-primary: #0f172a;
		--bloom-secondary: #1f2937;
		--bloom-accent: #3b82f6;
		--bloom-glow: rgba(59, 130, 246, 0.35);
		--bloom-tertiary: rgba(99, 102, 241, 0.32);
		--bloom-quaternary: rgba(30, 64, 175, 0.28);
		--surface-color: rgba(15, 23, 42, 0.68);
		--surface-border: rgba(148, 163, 184, 0.18);
		--surface-highlight: rgba(148, 163, 184, 0.35);
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
		background: radial-gradient(circle at top, rgba(15, 23, 42, 0.85), rgba(10, 12, 24, 0.95));
		color: #f8fafc;
	}

	.app-root {
		position: relative;
		min-height: 100vh;
		color: inherit;
	}

	.app-shell {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	.diagnostics-toggle {
		position: fixed;
		left: 1.5rem;
		bottom: calc(1.5rem + var(--player-height, 0px));
		z-index: 110;
		border-radius: 999px;
		padding: 0.45rem 1rem;
		background: rgba(59, 130, 246, 0.18);
		border: 1px solid rgba(59, 130, 246, 0.4);
		color: #e2e8f0;
		font-size: 0.85rem;
		cursor: pointer;
		backdrop-filter: blur(10px);
	}

	.diagnostics-toggle:hover {
		background: rgba(59, 130, 246, 0.28);
	}

	.glass-panel {
		background: transparent;
		border: 1px solid var(--surface-border, rgba(148, 163, 184, 0.2));
		border-radius: 18px;
		backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		box-shadow:
			0 20px 50px rgba(2, 6, 23, 0.35),
			0 3px 12px rgba(15, 23, 42, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			inset 0 0 40px rgba(255, 255, 255, 0.015);
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

	.settings-fab {
		position: fixed;
		top: clamp(0.75rem, 2vw, 2rem);
		right: clamp(0.75rem, 2vw, 2rem);
		display: flex;
		align-items: center;
		gap: 0.6rem;
		z-index: 20;
	}

	.toolbar-button {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		border-radius: 999px;
		border: 1px solid var(--surface-border, rgba(148, 163, 184, 0.2));
		padding: 0.55rem 0.95rem 0.55rem 0.85rem;
		font-size: 0.8rem;
		line-height: 1;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
		background: transparent;
		backdrop-filter: blur(var(--perf-blur-low, 24px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-low, 24px)) saturate(var(--perf-saturate, 160%));
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 160ms ease,
			transform 160ms ease;
	}

	.toolbar-button:hover {
		border-color: var(--bloom-accent, rgba(148, 163, 184, 0.32));
		box-shadow: 0 10px 28px rgba(8, 11, 19, 0.28);
	}

	.toolbar-button.is-active {
		border-color: var(--bloom-accent, rgba(59, 130, 246, 0.6));
		box-shadow: 0 10px 28px rgba(59, 130, 246, 0.24);
	}

	.toolbar-button__label {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	.toolbar-button__text {
		display: none;
	}

	.toolbar-button__chip {
		font-size: 0.65rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		background: transparent;
		backdrop-filter: blur(12px) saturate(130%);
		-webkit-backdrop-filter: blur(12px) saturate(130%);
		border: 1px solid rgba(59, 130, 246, 0.35);
		color: rgba(191, 219, 254, 0.95);
	}

	.toolbar-button__chevron {
		transition: transform 180ms ease;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.toolbar-button__chevron.is-open {
		transform: rotate(180deg);
	}

	.settings-menu {
		position: fixed;
		top: var(--settings-menu-offset, 88px);
		left: calc(env(safe-area-inset-left, 0px) + 0.75rem);
		right: calc(env(safe-area-inset-right, 0px) + 0.75rem);
		margin: 0;
		max-height: calc(100vh - var(--settings-menu-offset, 88px) - 8rem);
		overflow-y: auto;
		padding: clamp(0.85rem, 1.5vw, 1.2rem);
		border-radius: 18px;
		background: rgba(8, 12, 22, 0.95);
		border: 1px solid rgba(148, 163, 184, 0.35);
		box-shadow:
			0 25px 60px rgba(2, 6, 23, 0.65),
			0 3px 15px rgba(15, 23, 42, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
		z-index: 100;
		isolation: isolate;
		will-change: transform;
		transform: translateZ(0);
	}
	/* Hide scrollbar for Chrome, Safari and Opera */
	.settings-menu::-webkit-scrollbar {
		display: none;
	}

	/* Hide scrollbar for IE, Edge and Firefox */
	.settings-menu {
		-ms-overflow-style: none; /* IE and Edge */
		scrollbar-width: none; /* Firefox */
	}

	.settings-grid {
		display: grid;
		gap: 0.85rem;
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
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		font-weight: 700;
		margin: 0;
		color: rgba(203, 213, 225, 0.68);
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
		border-radius: 12px;
		border: 1px solid rgba(148, 163, 184, 0.18);
		background: transparent;
		backdrop-filter: blur(var(--perf-blur-medium, 28px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-medium, 28px))
			saturate(var(--perf-saturate, 160%));
		padding: 0.5rem 0.65rem;
		color: inherit;
		font-size: 0.8rem;
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
		transform: translateY(-1px);
		box-shadow: 0 8px 24px rgba(15, 23, 42, 0.22);
		border-color: rgba(148, 163, 184, 0.26);
	}

	.glass-option.is-active {
		border-color: var(--bloom-accent, rgba(59, 130, 246, 0.6));
		background: transparent;
		box-shadow:
			0 12px 28px rgba(59, 130, 246, 0.2),
			inset 0 0 32px rgba(59, 130, 246, 0.06);
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
		opacity: 0.58;
		line-height: 1.3;
	}

	.glass-option__check {
		color: rgba(191, 219, 254, 0.95);
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
		background: transparent;
		backdrop-filter: blur(16px) saturate(140%);
		-webkit-backdrop-filter: blur(16px) saturate(140%);
		border: 1px solid rgba(148, 163, 184, 0.45);
		color: rgba(226, 232, 240, 0.82);
		flex-shrink: 0;
	}

	.glass-option__chip.is-active {
		border-color: var(--bloom-accent, rgba(59, 130, 246, 0.7));
		color: rgba(219, 234, 254, 0.95);
		box-shadow: inset 0 0 20px rgba(59, 130, 246, 0.15);
	}

	.settings-section--bordered {
		padding-top: 0.65rem;
		border-top: 1px solid rgba(148, 163, 184, 0.12);
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
		border-radius: 14px;
		border: 1px solid rgba(148, 163, 184, 0.2);
		background: transparent;
		backdrop-filter: blur(var(--perf-blur-medium, 28px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-medium, 28px))
			saturate(var(--perf-saturate, 160%));
		padding: 0.7rem 0.9rem;
		font-size: 0.8rem;
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
		transform: translateY(-1px);
		border-color: rgba(148, 163, 184, 0.32);
		box-shadow: 0 10px 28px rgba(8, 11, 19, 0.28);
	}

	.glass-action__label {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
	}

	.glass-action__spinner {
		animation: spin 1s linear infinite;
		color: rgba(203, 213, 225, 0.85);
	}

	.section-footnote {
		margin: 0;
		font-size: 0.68rem;
		color: rgba(203, 213, 225, 0.58);
		line-height: 1.4;
	}

	.app-main {
		flex: 1;
		padding: clamp(1.5rem, 2.4vw, 2.75rem);
		margin: clamp(1rem, 1.5vw, 1.75rem) clamp(0.75rem, 2vw, 1.5rem);
		border-radius: 20px;
		position: relative;
		z-index: 1;
	}

	.app-main__inner {
		max-width: min(1100px, 100%);
		margin: 0 auto;
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
			var(--bloom-accent, rgba(96, 165, 250, 0.9)),
			transparent
		);
		box-shadow: 0 0 12px var(--bloom-accent, rgba(96, 165, 250, 0.5));
		animation: shimmer 1.2s ease-in-out infinite;
	}

	.navigation-overlay__content {
		font-size: 0.78rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: rgba(226, 232, 240, 0.9);
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

	@media (min-width: 520px) {
		.toolbar-button__text {
			display: inline;
		}
	}

	@media (min-width: 768px) {
		.settings-menu {
			position: absolute;
			right: 0;
			left: auto;
			width: 30rem;
			max-height: calc(100vh - var(--settings-menu-offset, 88px) - 8rem);
			padding: 1.3rem;
			border-radius: 18px;
			top: calc(var(--settings-menu-offset, 88px) - 8px);
		}

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

	@media (max-width: 640px) {
		.app-header {
			border-radius: 0;
			padding: 0.65rem 1rem;
		}

		.toolbar {
			gap: 0.5rem;
		}

		.toolbar-button {
			padding: 0.5rem 0.8rem;
		}

		.app-main {
			padding: 1.4rem;
			margin: 1rem 0.75rem;
		}
	}
</style>
