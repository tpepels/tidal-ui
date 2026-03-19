<script lang="ts">
	import { serverQueue, queueStats, workerStatus } from '$lib/stores/serverQueue.svelte';
	import { downloadLogStore } from '$lib/stores/downloadLog';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { regionStore } from '$lib/stores/region';
	import { logger, LogLevel, type LogEntry } from '$lib/core/logger';
	import './download-manager.css';
	import {
		cancelActionKey,
		deleteActionKey,
		downloadManagerActionKeys as actionKeys,
		pauseActionKey,
		reportActionKey,
		resumeActionKey,
		retryActionKey,
		summarizeJob,
		type CollapsibleSection,
		type QueueJob
	} from '$lib/features/download-manager/model';
	import { createQueueLifecycleTracker } from '$lib/features/download-manager/lifecycleTracker';
	import {
		removeQueueJob as deleteQueueJob,
		runQueueJobAction as runJobAction
	} from '$lib/features/download-manager/queueActions';
	import DownloadManagerPanelIntro from '$lib/components/download-manager/DownloadManagerPanelIntro.svelte';
	import DownloadManagerPriorityOverview from '$lib/components/download-manager/DownloadManagerPriorityOverview.svelte';
	import DownloadManagerDetailedSections from '$lib/components/download-manager/DownloadManagerDetailedSections.svelte';
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import { createAdaptivePollingController } from '$lib/utils/adaptivePolling';
	import { confirm as requestConfirmation } from '$lib/stores/dialogs';
	import { RefreshCw } from 'lucide-svelte';

	let { pageMode = false } = $props();

	let isOpen = $state(false);
	let isCompactViewport = $state(false);
	let showDetailedSections = $state(false);
	let actionNotice = $state<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);
	let pendingActions = $state<Record<string, boolean>>({});
	let sectionExpanded = $state<Record<CollapsibleSection, boolean>>({
		active: true,
		queue: true,
		failed: true
	});
	let localModeSectionInitDone = $state(false);
	let recentLogEntries = $state<LogEntry[]>([]);
	let lastPollingErrorLogged = $state<string | null>(null);
	let lastBackendErrorLogged = $state<string | null>(null);
	let lastBackendWarningLogged = $state<string | null>(null);
	let countdownController = createAdaptivePollingController({
		run: async () => {
			nowTs = Date.now();
		},
		visibleIntervalMs: 1_000,
		pauseWhenHidden: true
	});

	const DEBUG_LOG_LIMIT = 250;
	const statusPriority: Record<QueueJob['status'], number> = {
		processing: 0,
		queued: 1,
		paused: 2,
		failed: 3,
		cancelled: 4,
		completed: 5
	};

	// Use server queue data
	let stats = $derived.by(() => {
		const serverStats = $queueStats;
		return {
			running: $workerStatus.activeDownloads,
			queued: serverStats.queued,
			paused: serverStats.paused,
			completed: serverStats.completed,
			failed: serverStats.failed,
			total: serverStats.total
		};
	});

	let workerWarning = $derived(!$workerStatus.running && (stats.running > 0 || stats.queued > 0));
	let queueJobs = $derived.by(() =>
		[...$serverQueue.jobs].sort((a, b) => {
			const priorityDiff = statusPriority[a.status] - statusPriority[b.status];
			if (priorityDiff !== 0) {
				return priorityDiff;
			}
			return (
				(b.lastUpdatedAt ?? b.completedAt ?? b.createdAt) -
				(a.lastUpdatedAt ?? a.completedAt ?? a.createdAt)
			);
		})
	);
	let processingJobs = $derived(queueJobs.filter(j => j.status === 'processing'));
	let queuedJobs = $derived(queueJobs.filter(j => j.status === 'queued'));
	let pausedJobs = $derived(queueJobs.filter(j => j.status === 'paused'));
	let completedJobs = $derived(queueJobs.filter(j => j.status === 'completed'));
	let failedJobs = $derived(queueJobs.filter(j => j.status === 'failed'));
	let cancelledJobs = $derived(queueJobs.filter(j => j.status === 'cancelled'));
	let stoppableJobs = $derived(queueJobs.filter(j => j.status === 'processing' || j.status === 'queued'));
	let pausableJobs = $derived(queueJobs.filter(j => j.status === 'queued' || j.status === 'processing'));
	let resumableJobs = $derived(
		queueJobs.filter(j => j.status === 'failed' || j.status === 'cancelled' || j.status === 'paused')
	);
	let pendingItems = $derived(stats.running + stats.queued);
	let badgeCount = $derived(pendingItems > 0 ? pendingItems : resumableJobs.length);
	let hasActivity = $derived(badgeCount > 0);
	let activeAverageProgress = $derived.by(() => {
		if (processingJobs.length === 0) return 0;
		const sum = processingJobs.reduce(
			(total, job) => total + Math.max(0, Math.min(1, job.progress)),
			0
		);
		return Math.round((sum / processingJobs.length) * 100);
	});
	let statusHeadline = $derived.by(() => {
		if (stats.running > 0) {
			return `${stats.running} active download${stats.running === 1 ? '' : 's'}`;
		}
		if (stats.queued > 0) {
			return `${stats.queued} queued download${stats.queued === 1 ? '' : 's'}`;
		}
		return 'Download queue is idle';
	});
	let statusSubline = $derived.by(
		() => `${stats.queued} queued · ${pausedJobs.length} paused · ${resumableJobs.length} needs attention`
	);
	let queuedPreviewJobs = $derived(queuedJobs.slice(0, 4));
	let attentionPreviewJobs = $derived(resumableJobs.slice(0, 4));
	let activeSectionOpen = $derived(pageMode || sectionExpanded.active);
	let queueSectionOpen = $derived(pageMode || sectionExpanded.queue);
	let failedSectionOpen = $derived(pageMode || sectionExpanded.failed);
	let redisStatus = $derived.by(() => {
		const source = $serverQueue.queueSource;
		if (source === 'redis') {
			return { label: 'Redis: connected', state: 'ok' as const };
		}
		if (source === 'memory') {
			return { label: 'Redis: unavailable', state: 'warn' as const };
		}
		return { label: 'Redis: unknown', state: 'unknown' as const };
	});
	let lastUpdatedLabel = $derived.by(() => {
		const ts = $serverQueue.lastUpdated;
		if (!ts) return 'never';
		return new Date(ts).toLocaleTimeString();
	});
	let sectionNavItems = $derived.by(() => {
		if (!pageMode) {
			return [];
		}
		const items: Array<{
			id: string;
			label: string;
			tone?: 'secondary' | 'tertiary';
		}> = [
			{ id: 'download-center-summary', label: 'Summary', tone: 'secondary' as const },
			{ id: 'download-center-priority', label: 'Priority', tone: 'secondary' as const }
		];
		if (showDetailedSections) {
			items.push({ id: 'download-center-details', label: 'Timeline', tone: 'tertiary' as const });
		}
		return items;
	});
	let nowTs = $state(Date.now());
	let pollCountdownSeconds = $derived.by(() => {
		const next = $serverQueue.nextPollAt;
		if (!next) return 0;
		return Math.max(0, Math.ceil((next - nowTs) / 1000));
	});
	let staleThresholdMs = $derived.by(() => {
		const interval = $serverQueue.pollIntervalMs || 500;
		return Math.max(15000, interval * 3);
	});
	let isPollingStale = $derived.by(() => {
		const last = $serverQueue.lastUpdated;
		if (!last) return false;
		return nowTs - last > staleThresholdMs;
	});
	let pollStatusLabel = $derived.by(() => {
		if ($serverQueue.pollingError) {
			return `Retry in ${pollCountdownSeconds}s`;
		}
		if ($serverQueue.nextPollAt > 0) {
			return `Next poll in ${pollCountdownSeconds}s`;
		}
		return 'Polling paused';
	});
	let canStopAny = $derived(stoppableJobs.length > 0);
	let canPauseAny = $derived(pausableJobs.length > 0);
	let canResumeAny = $derived(resumableJobs.length > 0);
	let hasFailuresToReport = $derived(failedJobs.length > 0 || cancelledJobs.length > 0);
	const toggleSection = (section: CollapsibleSection) => {
		sectionExpanded = {
			...sectionExpanded,
			[section]: !sectionExpanded[section]
		};
	};

	function setActionNotice(tone: 'success' | 'error' | 'info', message: string): void {
		actionNotice = { tone, message };
	}

	function logDownloadEvent(tone: 'success' | 'error' | 'warning' | 'info', message: string): void {
		switch (tone) {
			case 'success':
				downloadLogStore.success(message);
				return;
			case 'error':
				downloadLogStore.error(message);
				return;
			case 'warning':
				downloadLogStore.warning(message);
				return;
			default:
				downloadLogStore.log(message);
		}
	}
	const lifecycleTracker = createQueueLifecycleTracker(logDownloadEvent);

	function isActionPending(key: string): boolean {
		return Boolean(pendingActions[key]);
	}

	function setActionPending(key: string, pending: boolean): void {
		if (pending) {
			if (pendingActions[key]) return;
			pendingActions = { ...pendingActions, [key]: true };
			return;
		}
		if (!pendingActions[key]) return;
		const next = { ...pendingActions };
		delete next[key];
		pendingActions = next;
	}

	function isJobActionPending(jobId: string): boolean {
		return (
			isActionPending(cancelActionKey(jobId)) ||
			isActionPending(pauseActionKey(jobId)) ||
			isActionPending(resumeActionKey(jobId)) ||
			isActionPending(retryActionKey(jobId)) ||
			isActionPending(deleteActionKey(jobId)) ||
			isActionPending(reportActionKey(jobId))
		);
	}

	async function runWithPendingAction<T>(key: string, work: () => Promise<T>): Promise<T | undefined> {
		if (isActionPending(key)) {
			return undefined;
		}
		setActionPending(key, true);
		try {
			return await work();
		} finally {
			setActionPending(key, false);
		}
	}

	function buildFailureReportText(jobs: QueueJob[]): string {
		const timestamp = new Date().toISOString();
		const lines = [
			`Download failure report (${timestamp})`,
			`Queue source: ${$serverQueue.queueSource ?? 'unknown'}`,
			`Worker running: ${$workerStatus.running ? 'yes' : 'no'}`,
			`Failed jobs: ${jobs.length}`,
			''
		];
		for (const job of jobs) {
			lines.push(`- Job ID: ${job.id}`);
			lines.push(`  Status: ${job.status}`);
			lines.push(`  Type: ${job.job.type}`);
			lines.push(`  Title: ${job.job.trackTitle || job.job.albumTitle || 'Unknown'}`);
			lines.push(`  Artist: ${job.job.artistName || 'Unknown'}`);
			lines.push(`  Quality: ${job.job.quality || 'Unknown'}`);
			if (typeof job.trackCount === 'number') {
				lines.push(
					`  Track progress: ${job.completedTracks || 0}/${job.trackCount}`
				);
			}
			lines.push(`  Error: ${job.error || 'N/A'}`);
			lines.push('');
		}
		return lines.join('\n');
	}

	function logLevelLabel(level: LogLevel): string {
		switch (level) {
			case LogLevel.ERROR:
				return 'error';
			case LogLevel.WARN:
				return 'warn';
			case LogLevel.INFO:
				return 'info';
			case LogLevel.DEBUG:
				return 'debug';
			case LogLevel.TRACE:
				return 'trace';
			default:
				return 'unknown';
		}
	}

	function buildDebugBundle(): string {
		const locationPath =
			typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/';
		const bundle = {
			generatedAt: new Date().toISOString(),
			route: locationPath,
			queue: {
				source: $serverQueue.queueSource ?? 'unknown',
				localMode: Boolean($serverQueue.localMode),
				stats: stats,
				jobs: queueJobs
			},
			worker: $workerStatus,
			settings: {
				downloadPreferences: $downloadPreferencesStore,
				userPreferences: $userPreferencesStore,
				region: $regionStore
			},
			diagnostics: {
				polling: {
					lastUpdated: $serverQueue.lastUpdated,
					lastAttemptAt: $serverQueue.lastAttemptAt,
					nextPollAt: $serverQueue.nextPollAt,
					pollIntervalMs: $serverQueue.pollIntervalMs,
					pollingError: $serverQueue.pollingError,
					backendError: $serverQueue.backendError,
					backendWarning: $serverQueue.backendWarning
				}
			},
			recentLogs: recentLogEntries.slice(-120).map((entry) => ({
				timestamp: entry.timestamp,
				level: logLevelLabel(entry.level),
				message: entry.message,
				context: entry.context
			}))
		};
		return JSON.stringify(bundle, null, 2);
	}

	async function copyTextToClipboard(text: string): Promise<void> {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return;
		}

		if (typeof document === 'undefined') {
			throw new Error('Clipboard is not available in this environment.');
		}

		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		textarea.style.pointerEvents = 'none';
		document.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		const copied = document.execCommand('copy');
		document.body.removeChild(textarea);
		if (!copied) {
			throw new Error('Unable to copy report to clipboard.');
		}
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		const updateViewportMode = () => {
			isCompactViewport = window.innerWidth <= 1024;
		};
		updateViewportMode();
		window.addEventListener('resize', updateViewportMode);
		return () => window.removeEventListener('resize', updateViewportMode);
	});

	$effect(() => {
		if (!pageMode && !isOpen) return;
		countdownController.stop();
		countdownController = createAdaptivePollingController({
			run: async () => {
				nowTs = Date.now();
			},
			visibleIntervalMs: 1_000,
			pauseWhenHidden: true
		});
		countdownController.start();
		return () => countdownController.stop();
	});

	$effect(() => {
		if (!actionNotice) return;
		const timeout = setTimeout(() => {
			actionNotice = null;
		}, 3500);
		return () => clearTimeout(timeout);
	});

	$effect(() => {
		if (localModeSectionInitDone) return;
		if (!$serverQueue.localMode) return;
		sectionExpanded = {
			active: false,
			queue: false,
			failed: true
		};
		localModeSectionInitDone = true;
	});

	$effect(() => {
		const message = $serverQueue.pollingError?.trim() || null;
		if (message && message !== lastPollingErrorLogged) {
			logDownloadEvent('warning', `[Queue Poll] ${message}`);
			lastPollingErrorLogged = message;
		}
		if (!message) {
			lastPollingErrorLogged = null;
		}
	});

	$effect(() => {
		const message = $serverQueue.backendError?.trim() || null;
		if (message && message !== lastBackendErrorLogged) {
			logDownloadEvent('error', `[Queue Backend] ${message}`);
			lastBackendErrorLogged = message;
		}
		if (!message) {
			lastBackendErrorLogged = null;
		}
	});

	$effect(() => {
		const message = $serverQueue.backendWarning?.trim() || null;
		if (message && message !== lastBackendWarningLogged) {
			logDownloadEvent('warning', `[Queue Backend] ${message}`);
			lastBackendWarningLogged = message;
		}
		if (!message) {
			lastBackendWarningLogged = null;
		}
	});

	$effect(() => {
		if (!pageMode && !isOpen) {
			return;
		}
		lifecycleTracker.trackQueueLifecycleEvents(queueJobs);
	});

	$effect(() => {
		const unsubscribe = logger.addListener((entry) => {
			recentLogEntries = [...recentLogEntries.slice(-(DEBUG_LOG_LIMIT - 1)), entry];
		});
		const appendWindowError = (message: string, context: Record<string, unknown>) => {
			recentLogEntries = [
				...recentLogEntries.slice(-(DEBUG_LOG_LIMIT - 1)),
				{
					timestamp: new Date().toISOString(),
					level: LogLevel.ERROR,
					message,
					context
				}
			];
		};
		const onWindowError = (event: ErrorEvent) => {
			appendWindowError(event.message || 'Window error', {
				filename: event.filename,
				lineno: event.lineno,
				colno: event.colno
			});
		};
		const onUnhandledRejection = (event: PromiseRejectionEvent) => {
			appendWindowError('Unhandled promise rejection', {
				reason: String(event.reason ?? 'unknown')
			});
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('error', onWindowError);
			window.addEventListener('unhandledrejection', onUnhandledRejection);
		}
		return () => {
			unsubscribe();
			if (typeof window !== 'undefined') {
				window.removeEventListener('error', onWindowError);
				window.removeEventListener('unhandledrejection', onUnhandledRejection);
			}
		};
	});

	const handleCancelJob = async (job: QueueJob) => {
		const key = cancelActionKey(job.id);
		await runWithPendingAction(key, async () => {
			const result = await runJobAction(job.id, 'cancel');
			if (result.success) {
				setActionNotice('success', `Stopped ${summarizeJob(job)}`);
				logDownloadEvent('success', `[Queue Action] Stopped ${summarizeJob(job)}.`);
				await serverQueue.poll();
				return;
			}
			setActionNotice('error', result.error ?? `Failed to stop ${summarizeJob(job)}`);
			logDownloadEvent('error', `[Queue Action] Failed to stop ${summarizeJob(job)}: ${result.error ?? 'Unknown error'}`);
		});
	};

	const handlePauseJob = async (job: QueueJob) => {
		const key = pauseActionKey(job.id);
		await runWithPendingAction(key, async () => {
			const result = await runJobAction(job.id, 'pause');
			if (result.success) {
				setActionNotice('success', `Paused ${summarizeJob(job)}`);
				logDownloadEvent('success', `[Queue Action] Paused ${summarizeJob(job)}.`);
				await serverQueue.poll();
				return;
			}
			setActionNotice('error', result.error ?? `Failed to pause ${summarizeJob(job)}`);
			logDownloadEvent('error', `[Queue Action] Failed to pause ${summarizeJob(job)}: ${result.error ?? 'Unknown error'}`);
		});
	};

	const handleResumePausedJob = async (job: QueueJob) => {
		const key = resumeActionKey(job.id);
		await runWithPendingAction(key, async () => {
			const result = await runJobAction(job.id, 'resume');
			if (result.success) {
				setActionNotice('success', `Resumed ${summarizeJob(job)}`);
				logDownloadEvent('success', `[Queue Action] Resumed ${summarizeJob(job)}.`);
				await serverQueue.poll();
				return;
			}
			setActionNotice('error', result.error ?? `Failed to resume ${summarizeJob(job)}`);
			logDownloadEvent('error', `[Queue Action] Failed to resume ${summarizeJob(job)}: ${result.error ?? 'Unknown error'}`);
		});
	};

	const handleRetryJob = async (job: QueueJob) => {
		const key = retryActionKey(job.id);
		await runWithPendingAction(key, async () => {
			const result = await runJobAction(job.id, 'retry');
			if (result.success) {
				setActionNotice('success', `Resumed ${summarizeJob(job)}`);
				logDownloadEvent('success', `[Queue Action] Retried ${summarizeJob(job)}.`);
				await serverQueue.poll();
				return;
			}
			setActionNotice('error', result.error ?? `Failed to resume ${summarizeJob(job)}`);
			logDownloadEvent('error', `[Queue Action] Failed to retry ${summarizeJob(job)}: ${result.error ?? 'Unknown error'}`);
		});
	};

	const handleRemoveJob = async (job: QueueJob) => {
		const key = deleteActionKey(job.id);
		await runWithPendingAction(key, async () => {
			const result = await deleteQueueJob(job.id);
			if (result.success) {
				setActionNotice('success', `Removed ${summarizeJob(job)}`);
				logDownloadEvent('success', `[Queue Action] Removed ${summarizeJob(job)} from history.`);
				await serverQueue.poll();
				return;
			}
			setActionNotice('error', result.error ?? `Failed to remove ${summarizeJob(job)}`);
			logDownloadEvent('error', `[Queue Action] Failed to remove ${summarizeJob(job)}: ${result.error ?? 'Unknown error'}`);
		});
	};

	const handleStopAllActive = async () => {
		if (stoppableJobs.length === 0) {
			setActionNotice('info', 'No active or queued downloads to stop.');
			logDownloadEvent('info', '[Queue Action] Stop active requested with no active jobs.');
			return;
		}
		const shouldStop = await requestConfirmation({
			title: 'Stop active downloads?',
			body: `Stop ${stoppableJobs.length} active or queued download job${stoppableJobs.length === 1 ? '' : 's'}?`,
			confirmLabel: 'Stop downloads',
			cancelLabel: 'Keep running',
			tone: 'danger'
		});
		if (!shouldStop) {
			return;
		}
		await runWithPendingAction(actionKeys.bulkStop, async () => {
			const results = await Promise.all(stoppableJobs.map((job) => runJobAction(job.id, 'cancel')));
			const succeeded = results.filter((result) => result.success).length;
			const failed = results.length - succeeded;
			setActionNotice(
				failed > 0 ? 'error' : 'success',
				failed > 0
					? `Stopped ${succeeded} job(s), ${failed} failed.`
					: `Stopped ${succeeded} active/queued job(s).`
			);
			logDownloadEvent(
				failed > 0 ? 'warning' : 'success',
				failed > 0
					? `[Queue Action] Stop active completed with partial success (${succeeded} succeeded, ${failed} failed).`
					: `[Queue Action] Stopped ${succeeded} active/queued job(s).`
			);
			await serverQueue.poll();
		});
	};

	const handlePauseAllActive = async () => {
		if (pausableJobs.length === 0) {
			setActionNotice('info', 'No active or queued downloads to pause.');
			logDownloadEvent('info', '[Queue Action] Pause active requested with no active jobs.');
			return;
		}
		await runWithPendingAction(actionKeys.bulkPause, async () => {
			const results = await Promise.all(pausableJobs.map((job) => runJobAction(job.id, 'pause')));
			const succeeded = results.filter((result) => result.success).length;
			const failed = results.length - succeeded;
			setActionNotice(
				failed > 0 ? 'error' : 'success',
				failed > 0
					? `Paused ${succeeded} job(s), ${failed} failed.`
					: `Paused ${succeeded} active/queued job(s).`
			);
			logDownloadEvent(
				failed > 0 ? 'warning' : 'success',
				failed > 0
					? `[Queue Action] Pause active completed with partial success (${succeeded} succeeded, ${failed} failed).`
					: `[Queue Action] Paused ${succeeded} active/queued job(s).`
			);
			await serverQueue.poll();
		});
	};

	const handleResumeAll = async () => {
		if (resumableJobs.length === 0) {
			setActionNotice('info', 'No paused, failed, or cancelled downloads to resume.');
			logDownloadEvent('info', '[Queue Action] Resume requested with no paused/failed jobs.');
			return;
		}
		await runWithPendingAction(actionKeys.bulkResume, async () => {
			const results = await Promise.all(
				resumableJobs.map((job) => {
					if (job.status === 'paused') {
						return runJobAction(job.id, 'resume');
					}
					return runJobAction(job.id, 'retry');
				})
			);
			const succeeded = results.filter((result) => result.success).length;
			const failed = results.length - succeeded;
			setActionNotice(
				failed > 0 ? 'error' : 'success',
				failed > 0
					? `Resumed ${succeeded} job(s), ${failed} failed.`
					: `Resumed ${succeeded} paused/failed/cancelled job(s).`
			);
			logDownloadEvent(
				failed > 0 ? 'warning' : 'success',
				failed > 0
					? `[Queue Action] Resume all completed with partial success (${succeeded} succeeded, ${failed} failed).`
					: `[Queue Action] Resumed ${succeeded} paused/failed/cancelled job(s).`
			);
			await serverQueue.poll();
		});
	};

	const handleCopyFailureReport = async (job?: QueueJob) => {
		const reportJobs = job ? [job] : resumableJobs;
		if (reportJobs.length === 0) {
			setActionNotice('info', 'No failure details available to report.');
			logDownloadEvent('info', '[Queue Action] Failure report requested with no failed jobs.');
			return;
		}
		const report = buildFailureReportText(reportJobs);
		const key = job ? reportActionKey(job.id) : actionKeys.bulkReport;
		await runWithPendingAction(key, async () => {
			try {
				await copyTextToClipboard(report);
					setActionNotice(
						'success',
						job
							? `Failure report copied for ${summarizeJob(job)}`
							: `Failure report copied for ${reportJobs.length} job(s)`
					);
					logDownloadEvent(
						'success',
						job
							? `[Queue Action] Copied failure report for ${summarizeJob(job)}.`
							: `[Queue Action] Copied failure report for ${reportJobs.length} job(s).`
					);
				} catch (error) {
					setActionNotice(
						'error',
						error instanceof Error ? error.message : 'Failed to copy failure report'
					);
					logDownloadEvent(
						'error',
						`[Queue Action] Failed to copy failure report: ${error instanceof Error ? error.message : 'Unknown error'}`
					);
				}
			});
		};

	const handleCreateDebugBundle = async () => {
		const bundle = buildDebugBundle();
		await runWithPendingAction(actionKeys.createBundle, async () => {
				try {
					await copyTextToClipboard(bundle);
					setActionNotice('success', 'Debug bundle copied to clipboard.');
					logDownloadEvent('success', '[Queue Action] Debug bundle copied to clipboard.');
				} catch (error) {
					setActionNotice(
						'error',
						error instanceof Error ? error.message : 'Failed to create debug bundle'
					);
					logDownloadEvent(
						'error',
						`[Queue Action] Failed to create debug bundle: ${error instanceof Error ? error.message : 'Unknown error'}`
					);
				}
			});
		};

	const handleClearFailed = async () => {
		const removable = queueJobs.filter((job) => job.status === 'failed' || job.status === 'cancelled');
		const shouldClear = await requestConfirmation({
			title: 'Clear failed download history?',
			body:
				removable.length === 0
					? 'Clear failed and cancelled download history?'
					: `Remove ${removable.length} failed or cancelled download entr${removable.length === 1 ? 'y' : 'ies'} from history?`,
			confirmLabel: 'Clear history',
			cancelLabel: 'Keep history',
			tone: 'danger'
		});
		if (!shouldClear) {
			return;
		}
		if (removable.length === 0) {
			setActionNotice('info', 'No failed jobs to clear.');
			logDownloadEvent('info', '[Queue Action] Clear history requested with no failed jobs.');
			return;
		}
		await runWithPendingAction(actionKeys.clearHistory, async () => {
			const results = await Promise.all(removable.map((job) => deleteQueueJob(job.id)));
			const succeeded = results.filter((result) => result.success).length;
			const failed = results.length - succeeded;
			setActionNotice(
				failed > 0 ? 'error' : 'success',
				failed > 0
					? `Cleared ${succeeded} failed entries, ${failed} failed.`
					: `Cleared ${succeeded} failed/cancelled entries.`
			);
			logDownloadEvent(
				failed > 0 ? 'warning' : 'success',
				failed > 0
					? `[Queue Action] Clear history completed with partial success (${succeeded} cleared, ${failed} failed).`
					: `[Queue Action] Cleared ${succeeded} failed/cancelled entries.`
			);
			await serverQueue.poll();
		});
	};

	const handleManualRefresh = async () => {
		await runWithPendingAction(actionKeys.refresh, async () => {
			await serverQueue.poll();
			logDownloadEvent('info', '[Queue Action] Manual queue refresh completed.');
		});
	};
</script>

<div class="download-manager-container" class:download-manager-container--page={pageMode}>
	{#if !pageMode}
		<button
			onclick={() => (isOpen = !isOpen)}
			type="button"
			class="download-manager-toggle"
			class:has-activity={hasActivity}
			title={isOpen ? 'Hide download center' : 'Show download center'}
		>
			{#if hasActivity}
				<div class="download-manager-badge">
					{badgeCount}
				</div>
			{/if}
			<span class="download-manager-icon">⬇</span>
		</button>
	{/if}

	{#if pageMode || isOpen}
		<div
			class="download-manager-panel ui-tool-panel ui-tool-panel--flush"
			data-tone="secondary"
			class:download-manager-panel--page={pageMode}
			class:compact-mode={isCompactViewport}
		>
			<div class="download-manager-header">
				<div>
					<h3 class="download-manager-title">Download Status</h3>
					<p class="download-manager-subtitle-text">
						{pageMode
							? 'Most important queue data first.'
							: 'Live queue activity for tracks and albums'}
					</p>
					<div class="download-manager-meta-row">
						{#if !pageMode}
							<div class="download-manager-redis" data-state={redisStatus.state}>
								<span class="download-manager-redis-dot"></span>
								<span>{redisStatus.label}</span>
							</div>
							<span class="download-manager-meta-separator">•</span>
						{/if}
						<span class="download-manager-last-updated">Updated {lastUpdatedLabel}</span>
						<span class="download-manager-meta-separator">•</span>
						<span class="download-manager-poll-status" data-stale={isPollingStale}>
							{pollStatusLabel}
							{#if isPollingStale}
								<span class="poll-stale-chip">STALE</span>
							{/if}
						</span>
						{#if !pageMode && isCompactViewport}
							<span class="download-manager-meta-separator">•</span>
							<span class="download-manager-compact-indicator">Compact rows</span>
						{/if}
					</div>
				</div>
				{#if !pageMode}
					<button
						onclick={() => (isOpen = false)}
						class="download-manager-close"
						type="button"
						aria-label="Close"
					>
						✕
					</button>
				{/if}
			</div>

			{#if pageMode}
				<PageSectionNav items={sectionNavItems} sticky={true} />
			{/if}

			<div id="download-center-summary" class="ui-section-anchor">
				<DownloadManagerPanelIntro
					{pageMode}
					pollingError={$serverQueue.pollingError}
					{pollStatusLabel}
					backendError={$serverQueue.backendError}
					backendWarning={$serverQueue.backendWarning}
					{workerWarning}
					{isPollingStale}
					{lastUpdatedLabel}
					queueSource={$serverQueue.queueSource}
					localMode={$serverQueue.localMode}
					{actionNotice}
					{stats}
					pausedCount={pausedJobs.length}
					resumableCount={resumableJobs.length}
					{statusHeadline}
					{statusSubline}
					{activeAverageProgress}
					workerRunning={$workerStatus.running}
					{showDetailedSections}
					{canPauseAny}
					{canStopAny}
					{canResumeAny}
					{hasFailuresToReport}
					{actionKeys}
					{isActionPending}
					{handlePauseAllActive}
					{handleStopAllActive}
					{handleResumeAll}
					{handleCopyFailureReport}
					{handleCreateDebugBundle}
				/>
			</div>

			<div class="download-manager-content" data-ui-block="main-sections">
				{#if pageMode}
					<section id="download-center-priority" class="ui-section-anchor">
						<DownloadManagerPriorityOverview
							{stats}
							{processingJobs}
							{attentionPreviewJobs}
							{queuedJobs}
							{queuedPreviewJobs}
							{isJobActionPending}
							{handlePauseJob}
							{handleCancelJob}
							{handleResumePausedJob}
							{handleRetryJob}
							{handleCopyFailureReport}
							{canPauseAny}
							{canStopAny}
							{canResumeAny}
							{isActionPending}
							{actionKeys}
							{handlePauseAllActive}
							{handleStopAllActive}
							{handleResumeAll}
							{handleManualRefresh}
							{showDetailedSections}
							toggleDetailedSections={() => {
								showDetailedSections = !showDetailedSections;
							}}
						/>
					</section>
				{/if}

				<section id="download-center-details" class="ui-section-anchor">
					<DownloadManagerDetailedSections
						{pageMode}
						{showDetailedSections}
						{stats}
						{processingJobs}
						{queuedJobs}
						{completedJobs}
						{resumableJobs}
						{activeSectionOpen}
						{queueSectionOpen}
						{failedSectionOpen}
						{toggleSection}
						{isJobActionPending}
						{handlePauseJob}
						{handleCancelJob}
						{handleResumePausedJob}
						{handleRetryJob}
						{handleCopyFailureReport}
						{handleRemoveJob}
						{handleClearFailed}
						{actionKeys}
						{isActionPending}
					/>
				</section>
			</div>

			<!-- Footer with controls -->
			{#if !pageMode}
				<div class="download-manager-footer">
					<button
						onclick={handleManualRefresh}
						class="control-btn control-btn--secondary"
						type="button"
						title="Refresh queue status"
						disabled={isActionPending(actionKeys.refresh)}
					>
						<span class:rotating={isActionPending(actionKeys.refresh)}>
							<RefreshCw size={14} />
						</span>
						<span>{isActionPending(actionKeys.refresh) ? 'Refreshing…' : 'Refresh'}</span>
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
