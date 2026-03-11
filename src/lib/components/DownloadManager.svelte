<script lang="ts">
	import { serverQueue, queueStats, workerStatus } from '$lib/stores/serverQueue.svelte';
	import { downloadLogStore } from '$lib/stores/downloadLog';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { regionStore } from '$lib/stores/region';
	import { logger, LogLevel, type LogEntry } from '$lib/core/logger';
	import {
		Trash2,
		RefreshCw,
		ChevronDown,
		ChevronUp,
		RotateCcw,
		Square,
		ClipboardCopy,
		Bug
	} from 'lucide-svelte';

	interface QueueJob {
		id: string;
		status: 'queued' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
		job: {
			type: 'track' | 'album';
			trackId?: number;
			trackTitle?: string;
			artistName?: string;
			albumTitle?: string;
			albumId?: number;
			quality?: string;
			experimentalMusicBrainzTagging?: boolean;
			strictMusicBrainzMatching?: boolean;
			musicBrainzReleaseId?: string;
		};
		progress: number; // 0-1
		createdAt: number;
		startedAt?: number;
		completedAt?: number;
		lastUpdatedAt?: number;
		error?: string;
		trackCount?: number; // For albums
		completedTracks?: number; // For albums
	}

	interface QueueJobObservation {
		status: QueueJob['status'];
		progressBucket: number;
		completedTracks: number;
	}

	let { pageMode = false } = $props();

	let isOpen = $state(false);
	let queueJobs = $state<QueueJob[]>([]);
	let expandedJobId = $state<string | null>(null);
	let isCompactViewport = $state(false);
	let actionNotice = $state<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);
	let pendingActions = $state<Record<string, boolean>>({});
	type JobTypeFilter = 'all' | 'albums' | 'tracks';
	type CollapsibleSection = 'active' | 'queue' | 'failed';
	let queueTypeFilter = $state<JobTypeFilter>('all');
	let completedTypeFilter = $state<JobTypeFilter>('all');
	let sectionExpanded = $state<Record<CollapsibleSection, boolean>>({
		active: true,
		queue: true,
		failed: true
	});
	let localModeSectionInitDone = $state(false);
	let recentLogEntries = $state<LogEntry[]>([]);
	let queueObservations = $state<Record<string, QueueJobObservation>>({});
	let queueObservationsReady = $state(false);
	let lastPollingErrorLogged = $state<string | null>(null);
	let lastBackendErrorLogged = $state<string | null>(null);
	let lastBackendWarningLogged = $state<string | null>(null);
	let lastQueueFetchErrorLogged = $state<string | null>(null);

	const DEBUG_LOG_LIMIT = 250;

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
	const matchesTypeFilter = (job: QueueJob, filter: JobTypeFilter): boolean => {
		if (filter === 'all') return true;
		return filter === 'albums' ? job.job.type === 'album' : job.job.type === 'track';
	};
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
	let filteredQueuedJobs = $derived(queuedJobs.filter(job => matchesTypeFilter(job, queueTypeFilter)));
	let filteredCompletedJobs = $derived(
		completedJobs.filter(job => matchesTypeFilter(job, completedTypeFilter))
	);
	let completedAlbums = $derived(
		completedJobs.filter(j => j.job.type === 'album').length
	);
	let completedFiles = $derived(
		completedJobs
			.reduce((sum, job) => {
				if (job.job.type === 'album') {
					const count = job.completedTracks ?? job.trackCount ?? 0;
					return sum + count;
				}
				return sum + 1;
			}, 0)
	);
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
	const actionKeys = {
		refresh: 'refresh',
		bulkPause: 'bulk-pause',
		bulkStop: 'bulk-stop',
		bulkResume: 'bulk-resume',
		bulkReport: 'bulk-report',
		createBundle: 'create-bundle',
		clearHistory: 'clear-history'
	} as const;

	const cancelActionKey = (jobId: string): string => `job:${jobId}:cancel`;
	const pauseActionKey = (jobId: string): string => `job:${jobId}:pause`;
	const resumeActionKey = (jobId: string): string => `job:${jobId}:resume`;
	const retryActionKey = (jobId: string): string => `job:${jobId}:retry`;
	const deleteActionKey = (jobId: string): string => `job:${jobId}:delete`;
	const reportActionKey = (jobId: string): string => `job:${jobId}:report`;
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

	function summarizeJob(job: QueueJob): string {
		const title = job.job.trackTitle || job.job.albumTitle || 'Unknown';
		const artist = job.job.artistName ? ` by ${job.job.artistName}` : '';
		return `${title}${artist}`;
	}

	function describeMusicBrainzMode(job: QueueJob): string | null {
		if (job.job.experimentalMusicBrainzTagging === false) {
			return null;
		}
		const baseMode = job.job.strictMusicBrainzMatching === true ? 'strict ISRC mode' : 'flex mode';
		return job.job.musicBrainzReleaseId ? `${baseMode} (release selected)` : baseMode;
	}

	function jobShortId(jobId: string): string {
		return jobId.slice(0, 8);
	}

	function progressBucket(progress: number): number {
		const clamped = Math.max(0, Math.min(1, progress));
		return Math.min(100, Math.floor((clamped * 100) / 20) * 20);
	}

	function buildObservation(job: QueueJob): QueueJobObservation {
		return {
			status: job.status,
			progressBucket: progressBucket(job.progress),
			completedTracks: job.completedTracks ?? 0
		};
	}

	function trackQueueLifecycleEvents(nextJobs: QueueJob[]): void {
		const nextObservations: Record<string, QueueJobObservation> = {};

		if (!queueObservationsReady) {
			for (const job of nextJobs) {
				nextObservations[job.id] = buildObservation(job);
			}
			queueObservations = nextObservations;
			queueObservationsReady = true;
			if (nextJobs.length > 0) {
				logDownloadEvent('info', `[Queue] Monitoring ${nextJobs.length} existing job(s).`);
			}
			return;
		}

		for (const job of nextJobs) {
			const prev = queueObservations[job.id];
			const label = summarizeJob(job);
			const shortId = jobShortId(job.id);
			const next = buildObservation(job);
			const musicBrainzMode = describeMusicBrainzMode(job);

			if (!prev) {
				if (musicBrainzMode) {
					logDownloadEvent(
						'info',
						`[MusicBrainz] ${label} (job ${shortId}): tagging enabled (${musicBrainzMode}).`
					);
				}
				if (job.status === 'completed') {
					logDownloadEvent('success', `[Queue] ${label} completed (job ${shortId}).`);
				} else if (job.status === 'failed') {
					logDownloadEvent(
						'error',
						`[Queue] ${label} failed (job ${shortId}): ${job.error ?? 'Unknown error'}`
					);
				} else if (job.status === 'cancelled' || job.status === 'paused') {
					logDownloadEvent('warning', `[Queue] ${label} is ${job.status} (job ${shortId}).`);
				} else {
					logDownloadEvent(
						'info',
						`[Queue] New ${job.job.type} job ${shortId}: ${label} (${job.status}).`
					);
				}
			} else {
				if (prev.status !== job.status) {
					if (job.status === 'processing') {
						logDownloadEvent('info', `[Queue] Started ${label} (job ${shortId}).`);
					} else if (job.status === 'completed') {
						logDownloadEvent('success', `[Queue] Completed ${label} (job ${shortId}).`);
					} else if (job.status === 'failed') {
						logDownloadEvent(
							'error',
							`[Queue] Failed ${label} (job ${shortId}): ${job.error ?? 'Unknown error'}`
						);
					} else if (job.status === 'paused') {
						logDownloadEvent('warning', `[Queue] Paused ${label} (job ${shortId}).`);
					} else if (job.status === 'cancelled') {
						logDownloadEvent('warning', `[Queue] Cancelled ${label} (job ${shortId}).`);
					} else if (job.status === 'queued') {
						logDownloadEvent('info', `[Queue] Re-queued ${label} (job ${shortId}).`);
					}
					if (musicBrainzMode && job.status === 'completed') {
						logDownloadEvent(
							'success',
							`[MusicBrainz] ${label} (job ${shortId}): server tagging finished.`
						);
					} else if (musicBrainzMode && job.status === 'failed') {
						logDownloadEvent(
							'warning',
							`[MusicBrainz] ${label} (job ${shortId}): job failed before tagging could complete.`
						);
					}
				}

				if (job.status === 'processing' && next.progressBucket !== prev.progressBucket && next.progressBucket > 0) {
					logDownloadEvent(
						'info',
						`[Queue] ${label} (job ${shortId}) progress ${next.progressBucket}%`
					);
				}

				if (
					job.job.type === 'album' &&
					job.status === 'processing' &&
					typeof job.trackCount === 'number' &&
					job.trackCount > 0 &&
					next.completedTracks !== prev.completedTracks
				) {
					logDownloadEvent(
						'info',
						`[Queue] ${label} (job ${shortId}) track ${next.completedTracks}/${job.trackCount}`
					);
				}
			}

			nextObservations[job.id] = next;
		}

		for (const previousJobId of Object.keys(queueObservations)) {
			if (nextObservations[previousJobId]) continue;
			logDownloadEvent('info', `[Queue] Job ${jobShortId(previousJobId)} removed from queue history.`);
		}

		queueObservations = nextObservations;
	}

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

	async function runJobAction(
		jobId: string,
		action: 'cancel' | 'pause' | 'resume' | 'retry'
	): Promise<{ success: boolean; error?: string }> {
		try {
			const response = await fetch(`/api/download-queue/${jobId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action })
			});
			const payload = (await response.json()) as { success?: boolean; error?: string };
			if (!response.ok || !payload.success) {
				return { success: false, error: payload.error ?? `Failed to ${action} job` };
			}
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : `Failed to ${action} job`
			};
		}
	}

	async function deleteQueueJob(jobId: string): Promise<{ success: boolean; error?: string }> {
		try {
			const response = await fetch(`/api/download-queue/${jobId}`, { method: 'DELETE' });
			const payload = (await response.json()) as { success?: boolean; error?: string };
			if (!response.ok || !payload.success) {
				return { success: false, error: payload.error ?? 'Failed to remove job' };
			}
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Failed to remove job'
			};
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
		const interval = setInterval(() => {
			nowTs = Date.now();
		}, 500);
		return () => clearInterval(interval);
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

	// Fetch queue jobs details
	const fetchQueueJobs = async () => {
		try {
			const response = await fetch('/api/download-queue');
			if (!response.ok) throw new Error('Failed to fetch jobs');
			
			const data = await response.json() as { success: boolean; jobs: QueueJob[] };
			if (data.success) {
				const statusPriority: Record<QueueJob['status'], number> = {
					processing: 0,
					queued: 1,
					paused: 2,
					failed: 3,
					cancelled: 4,
					completed: 5
				};
				queueJobs = data.jobs
					.slice()
					.sort((a, b) => {
						const priorityDiff = statusPriority[a.status] - statusPriority[b.status];
						if (priorityDiff !== 0) {
							return priorityDiff;
						}
						return (b.lastUpdatedAt ?? b.completedAt ?? b.createdAt) - (a.lastUpdatedAt ?? a.completedAt ?? a.createdAt);
					});
				trackQueueLifecycleEvents(queueJobs);
				lastQueueFetchErrorLogged = null;
			}
		} catch (err) {
			console.error('Failed to fetch queue jobs:', err);
			const message = err instanceof Error ? err.message : 'Unknown queue fetch error';
			if (message !== lastQueueFetchErrorLogged) {
				logDownloadEvent('warning', `[Queue] Failed to refresh jobs: ${message}`);
				lastQueueFetchErrorLogged = message;
			}
		}
	};

	// Auto-refresh jobs while the panel is open
	$effect(() => {
		if (pageMode || isOpen) {
			fetchQueueJobs();
			const interval = setInterval(fetchQueueJobs, 5000);
			return () => clearInterval(interval);
		}
	});

	const handleCancelJob = async (job: QueueJob) => {
		const key = cancelActionKey(job.id);
		await runWithPendingAction(key, async () => {
			const result = await runJobAction(job.id, 'cancel');
			if (result.success) {
				setActionNotice('success', `Stopped ${summarizeJob(job)}`);
				logDownloadEvent('success', `[Queue Action] Stopped ${summarizeJob(job)}.`);
				await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
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
				await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
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
				await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
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
				await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
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
				await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
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
			await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
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
			await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
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
			await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
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
		if (!confirm('Clear all failed and cancelled downloads from history?')) {
			return;
		}
		const removable = queueJobs.filter((job) => job.status === 'failed' || job.status === 'cancelled');
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
			await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
		});
	};

	const handleManualRefresh = async () => {
		await runWithPendingAction(actionKeys.refresh, async () => {
			await serverQueue.poll();
			await fetchQueueJobs();
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
			class:download-manager-panel--page={pageMode}
			class:compact-mode={isCompactViewport}
		>
			<div class="download-manager-header">
				<div>
					<h3 class="download-manager-title">Download Status</h3>
					<p class="download-manager-subtitle-text">Live queue activity for tracks and albums</p>
					<div class="download-manager-meta-row">
						<div class="download-manager-redis" data-state={redisStatus.state}>
							<span class="download-manager-redis-dot"></span>
							<span>{redisStatus.label}</span>
						</div>
						<span class="download-manager-meta-separator">•</span>
						<span class="download-manager-last-updated">Updated {lastUpdatedLabel}</span>
						<span class="download-manager-meta-separator">•</span>
						<span class="download-manager-poll-status" data-stale={isPollingStale}>
							{pollStatusLabel}
							{#if isPollingStale}
								<span class="poll-stale-chip">STALE</span>
							{/if}
						</span>
						{#if isCompactViewport}
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

			{#if $serverQueue.pollingError}
				<div class="download-manager-error">
					Transport error while polling queue: {$serverQueue.pollingError}. {pollStatusLabel}.
				</div>
			{/if}

			{#if $serverQueue.backendError}
				<div class="download-manager-error">
					Queue backend error: {$serverQueue.backendError}
				</div>
			{/if}

			{#if $serverQueue.backendWarning}
				<div class="download-manager-warning">
					Queue backend warning: {$serverQueue.backendWarning}
				</div>
			{/if}

			{#if workerWarning}
				<div class="download-manager-warning">
					Worker is not running; queued jobs will not start until the worker is active.
				</div>
			{/if}

			{#if isPollingStale && !$serverQueue.pollingError}
				<div class="download-manager-warning">
					Queue UI may be stale. Last successful update was at {lastUpdatedLabel}.
				</div>
			{/if}

			{#if $serverQueue.queueSource === 'memory' && !$serverQueue.localMode}
				<div class="download-manager-warning">
					Redis unavailable; using in-memory queue. UI may be stale if the worker runs in another process.
				</div>
			{/if}

			{#if actionNotice}
				<div class="download-manager-notice" data-tone={actionNotice.tone}>
					{actionNotice.message}
				</div>
			{/if}

			<div class="download-status-hero" data-active={stats.running > 0}>
				<div class="download-status-hero__main">
					<p class="download-status-hero__eyebrow">Live Session</p>
					<h4>{statusHeadline}</h4>
					<p>{statusSubline}</p>
				</div>
				<div class="download-status-hero__meter">
					<div class="download-status-hero__meter-track">
						<div
							class="download-status-hero__meter-fill"
							style={`width: ${activeAverageProgress}%`}
						></div>
					</div>
					<div class="download-status-hero__meter-meta">
						<span>Average active progress</span>
						<strong>{activeAverageProgress}%</strong>
					</div>
				</div>
				<div class="download-status-hero__chips">
					<span class="download-status-chip" data-tone={$workerStatus.running ? 'ok' : 'warn'}>
						Worker {$workerStatus.running ? 'online' : 'offline'}
					</span>
					<span
						class="download-status-chip"
						data-tone={$serverQueue.queueSource === 'redis' ? 'ok' : 'neutral'}
					>
						Queue {$serverQueue.queueSource ?? 'unknown'}
					</span>
					{#if isPollingStale}
						<span class="download-status-chip" data-tone="warn">Data stale</span>
					{/if}
				</div>
			</div>

			<div class="download-manager-top-strip">
				<div class="top-strip-item top-strip-item--running">
					<span class="top-strip-label">Running</span>
					<span class="top-strip-value">{stats.running}</span>
				</div>
				<div class="top-strip-item top-strip-item--queued">
					<span class="top-strip-label">Queued</span>
					<span class="top-strip-value">{stats.queued}</span>
				</div>
				<div class="top-strip-item top-strip-item--paused">
					<span class="top-strip-label">Paused</span>
					<span class="top-strip-value">{pausedJobs.length}</span>
				</div>
				<div class="top-strip-item top-strip-item--failed">
					<span class="top-strip-label">Needs Attention</span>
					<span class="top-strip-value">{resumableJobs.length}</span>
				</div>
				<div class="top-strip-item">
					<span class="top-strip-label">Queue source</span>
					<span class="top-strip-value top-strip-value--text">{$serverQueue.queueSource ?? 'unknown'}</span>
				</div>
				<div class="top-strip-item">
					<span class="top-strip-label">Last update</span>
					<span class="top-strip-value top-strip-value--text">{lastUpdatedLabel}</span>
				</div>
			</div>

			<div class="download-manager-quick-actions">
				<button
					onclick={handlePauseAllActive}
					class="control-btn control-btn--secondary"
					type="button"
					title="Pause all active and queued jobs"
					disabled={!canPauseAny || isActionPending(actionKeys.bulkPause)}
				>
					<Square size={14} />
					<span>{isActionPending(actionKeys.bulkPause) ? 'Pausing…' : 'Pause Active'}</span>
				</button>
				<button
					onclick={handleStopAllActive}
					class="control-btn control-btn--warning"
					type="button"
					title="Stop all active and queued jobs"
					disabled={!canStopAny || isActionPending(actionKeys.bulkStop)}
				>
					<Square size={14} />
					<span>{isActionPending(actionKeys.bulkStop) ? 'Stopping…' : 'Stop Active'}</span>
				</button>
				<button
					onclick={handleResumeAll}
					class="control-btn control-btn--primary"
					type="button"
					title="Resume all failed or cancelled jobs"
					disabled={!canResumeAny || isActionPending(actionKeys.bulkResume)}
				>
					<RotateCcw size={14} />
					<span>{isActionPending(actionKeys.bulkResume) ? 'Resuming…' : 'Resume Paused/Failed'}</span>
				</button>
				<button
					onclick={() => handleCopyFailureReport()}
					class="control-btn control-btn--secondary"
					type="button"
					title="Copy a failure report for troubleshooting"
					disabled={!hasFailuresToReport || isActionPending(actionKeys.bulkReport)}
				>
					<ClipboardCopy size={14} />
					<span>{isActionPending(actionKeys.bulkReport) ? 'Copying…' : 'Report Failures'}</span>
				</button>
				<button
					onclick={handleCreateDebugBundle}
					class="control-btn control-btn--secondary"
					type="button"
					title="Copy debug bundle with queue snapshot, route, settings, and recent logs"
					disabled={isActionPending(actionKeys.createBundle)}
				>
					<Bug size={14} />
					<span>{isActionPending(actionKeys.createBundle) ? 'Bundling…' : 'Create Debug Bundle'}</span>
				</button>
			</div>

			<div class="download-manager-content">
				<!-- Current/Active Downloads -->
				{#if stats.running > 0}
					<div class="section current-section">
						<button
							type="button"
							class="section-toggle"
							onclick={() => toggleSection('active')}
							aria-expanded={sectionExpanded.active}
						>
							<span class="section-title-main section-title">
								<span class="section-title-icon rotating"><RefreshCw size={14} strokeWidth={2} /></span>
								<span>Active Downloads</span>
							</span>
							<span class="section-title-actions">
								<span class="section-count">{stats.running}</span>
								<span class="section-chevron">
									{#if sectionExpanded.active}
										<ChevronUp size={16} />
									{:else}
										<ChevronDown size={16} />
									{/if}
								</span>
							</span>
						</button>
						{#if sectionExpanded.active}
							<div class="current-items">
								{#each processingJobs as job (job.id)}
								{@const jobPending = isJobActionPending(job.id)}
								<div class="current-item">
									<div class="current-item-header">
										<div class="current-item-title">
											{job.job.type === 'track' ? job.job.trackTitle : job.job.albumTitle || 'Unknown Album'}
										</div>
										<div class="item-action-row">
											<span class="badge badge-processing">PROCESSING</span>
											<button
												type="button"
												class="item-action-btn"
												title="Pause this download"
												onclick={() => handlePauseJob(job)}
												disabled={jobPending}
											>
												<Square size={12} />
												<span>{jobPending ? 'Pausing…' : 'Pause'}</span>
											</button>
											<button
												type="button"
												class="item-action-btn item-action-btn--warning"
												title="Stop this download"
												onclick={() => handleCancelJob(job)}
												disabled={jobPending}
											>
												<Square size={12} />
												<span>{jobPending ? 'Stopping…' : 'Stop'}</span>
											</button>
										</div>
									</div>
									{#if job.job.type === 'album'}
										<div class="current-item-meta">
											<span>{job.job.artistName}</span>
											<span class="meta-separator">•</span>
											<span class="meta-album-progress">{(job.completedTracks || 0)}/{job.trackCount || '?'} tracks</span>
											<span class="meta-separator">•</span>
											<span>{job.job.quality}</span>
										</div>
									{:else}
										<div class="current-item-meta">
											<span>{job.job.artistName}</span>
											{#if job.job.albumTitle}
												<span class="meta-separator">•</span>
												<span>{job.job.albumTitle}</span>
											{/if}
											<span class="meta-separator">•</span>
											<span>{job.job.quality}</span>
										</div>
									{/if}
									<div class="progress-bar">
										<div class="progress-fill" style="width: {job.progress * 100}%"></div>
									</div>
									<div class="progress-text">{Math.round(job.progress * 100)}%</div>
								</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Queued items -->
				{#if stats.queued > 0}
					<div class="section">
						<button
							type="button"
							class="section-toggle"
							onclick={() => toggleSection('queue')}
							aria-expanded={sectionExpanded.queue}
						>
							<span class="section-title-main section-title">
								<span>Queue</span>
							</span>
							<span class="section-title-actions">
								<span class="section-count">{stats.queued}</span>
								<span class="section-chevron">
									{#if sectionExpanded.queue}
										<ChevronUp size={16} />
									{:else}
										<ChevronDown size={16} />
									{/if}
								</span>
							</span>
						</button>
						{#if sectionExpanded.queue}
							<div class="section-filter-row">
								<div class="section-filter-label">Show</div>
								<div class="filter-pills" role="tablist" aria-label="Queue filters">
									<button
										type="button"
										class="filter-pill"
										class:is-active={queueTypeFilter === 'all'}
										onclick={() => (queueTypeFilter = 'all')}
									>
										All
									</button>
									<button
										type="button"
										class="filter-pill"
										class:is-active={queueTypeFilter === 'albums'}
										onclick={() => (queueTypeFilter = 'albums')}
									>
										Albums
									</button>
									<button
										type="button"
										class="filter-pill"
										class:is-active={queueTypeFilter === 'tracks'}
										onclick={() => (queueTypeFilter = 'tracks')}
									>
										Tracks
									</button>
								</div>
							</div>
							<div class="queue-list">
								{#if filteredQueuedJobs.length === 0}
									<div class="filter-empty-state">
										No {queueTypeFilter === 'all' ? 'queued' : queueTypeFilter} jobs in queue right now.
									</div>
								{:else}
									{#each filteredQueuedJobs.slice(0, 5) as job (job.id)}
										{@const jobPending = isJobActionPending(job.id)}
										<div class="queue-item-card">
											<button
												type="button"
												class="queue-item-click"
												onclick={() => expandedJobId = expandedJobId === job.id ? null : job.id}
												aria-expanded={expandedJobId === job.id}
											>
												<div class="queue-item-main">
													<div class="queue-item-info">
														<div class="queue-item-title">{job.job.trackTitle || job.job.albumTitle || 'Unknown'}</div>
														<div class="queue-item-artist">{job.job.artistName || 'Unknown Artist'}</div>
														{#if job.job.albumTitle && job.job.trackTitle}
															<div class="queue-item-album">{job.job.albumTitle}</div>
														{/if}
													</div>
													<span class="expand-icon">
														{#if expandedJobId === job.id}
															<ChevronUp size={16} />
														{:else}
															<ChevronDown size={16} />
														{/if}
													</span>
												</div>

												{#if expandedJobId === job.id}
													<div class="queue-item-details">
														<div class="detail-row">
															<span class="detail-label">Type:</span>
															<span class="detail-value">{job.job.type === 'track' ? 'Single Track' : 'Album'}</span>
														</div>
														<div class="detail-row">
															<span class="detail-label">Quality:</span>
															<span class="detail-value">{job.job.quality || 'Lossless'}</span>
														</div>
														{#if job.job.type === 'album' && job.trackCount}
															<div class="detail-row">
																<span class="detail-label">Progress:</span>
																<span class="detail-value">{job.completedTracks || 0}/{job.trackCount} tracks</span>
															</div>
														{/if}
														<div class="detail-row">
															<span class="detail-label">Status:</span>
															<span class="detail-value">{job.status}</span>
														</div>
														{#if job.createdAt}
															<div class="detail-row">
																<span class="detail-label">Added:</span>
																<span class="detail-value">{new Date(job.createdAt).toLocaleTimeString()}</span>
															</div>
														{/if}
														{#if job.startedAt}
															<div class="detail-row">
																<span class="detail-label">Duration:</span>
																<span class="detail-value">{Math.round((job.completedAt || Date.now()) - job.startedAt) / 1000}s</span>
															</div>
														{/if}
														<div class="detail-actions">
															<span
																role="button"
																tabindex={jobPending ? -1 : 0}
																class="item-action-btn"
																onclick={(event) => {
																	event.stopPropagation();
																	void handlePauseJob(job);
																}}
																onkeydown={(event) => {
																	if (jobPending) return;
																	if (event.key === 'Enter' || event.key === ' ') {
																		event.preventDefault();
																		event.stopPropagation();
																		void handlePauseJob(job);
																	}
																}}
																aria-disabled={jobPending}
															>
																<Square size={12} />
																<span>{jobPending ? 'Pausing…' : 'Pause'}</span>
															</span>
															<span
																role="button"
																tabindex={jobPending ? -1 : 0}
																class="item-action-btn item-action-btn--warning"
																onclick={(event) => {
																	event.stopPropagation();
																	void handleCancelJob(job);
																}}
																onkeydown={(event) => {
																	if (jobPending) return;
																	if (event.key === 'Enter' || event.key === ' ') {
																		event.preventDefault();
																		event.stopPropagation();
																		void handleCancelJob(job);
																	}
																}}
																aria-disabled={jobPending}
															>
																<Square size={12} />
																<span>{jobPending ? 'Stopping…' : 'Stop'}</span>
															</span>
														</div>
													</div>
												{/if}
											</button>
										</div>
									{/each}
								{/if}

								{#if filteredQueuedJobs.length > 5}
									<div class="queue-more-hint">
										+{filteredQueuedJobs.length - 5} more in queue
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Completed -->
				{#if stats.completed > 0}
					<div class="section">
						<h4 class="section-title">
							<span>Completed</span>
							<span class="section-count">{stats.completed}</span>
						</h4>
						<div class="completion-summary">
							{#if completedAlbums > 0}
								<p>
									{completedAlbums} album{completedAlbums !== 1 ? 's' : ''} • {completedFiles} file{completedFiles !== 1 ? 's' : ''} successfully downloaded
								</p>
							{:else}
								<p>{completedFiles} file{completedFiles !== 1 ? 's' : ''} successfully downloaded</p>
							{/if}
						</div>
						<div class="section-filter-row">
							<div class="section-filter-label">Show</div>
							<div class="filter-pills" role="tablist" aria-label="Completed filters">
								<button
									type="button"
									class="filter-pill"
									class:is-active={completedTypeFilter === 'all'}
									onclick={() => (completedTypeFilter = 'all')}
								>
									All
								</button>
								<button
									type="button"
									class="filter-pill"
									class:is-active={completedTypeFilter === 'albums'}
									onclick={() => (completedTypeFilter = 'albums')}
								>
									Albums
								</button>
								<button
									type="button"
									class="filter-pill"
									class:is-active={completedTypeFilter === 'tracks'}
									onclick={() => (completedTypeFilter = 'tracks')}
								>
									Tracks
								</button>
							</div>
						</div>
						<div class="completed-list">
							{#if filteredCompletedJobs.length === 0}
								<div class="filter-empty-state">
									No completed {completedTypeFilter === 'all' ? '' : `${completedTypeFilter} `}jobs yet.
								</div>
							{:else}
								{#each filteredCompletedJobs.slice(0, 5) as job (job.id)}
									{@const jobPending = isJobActionPending(job.id)}
									<div class="completed-item">
										<div class="completed-item-header">
											<div class="completed-item-title">
												{job.job.trackTitle || job.job.albumTitle || 'Unknown'}
											</div>
											<button
												type="button"
												class="item-action-btn"
												title="Remove from history"
												onclick={() => handleRemoveJob(job)}
												disabled={jobPending}
											>
												<Trash2 size={12} />
												<span>{jobPending ? 'Removing…' : 'Dismiss'}</span>
											</button>
										</div>
										<div class="completed-item-meta">
											<span>{job.job.artistName || 'Unknown Artist'}</span>
											<span class="meta-separator">•</span>
											<span>{job.job.type === 'album' ? 'Album' : 'Track'}</span>
											{#if job.completedAt}
												<span class="meta-separator">•</span>
												<span>{new Date(job.completedAt).toLocaleTimeString()}</span>
											{/if}
										</div>
									</div>
								{/each}
							{/if}

							{#if filteredCompletedJobs.length > 5}
								<div class="queue-more-hint">
									+{filteredCompletedJobs.length - 5} more completed
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Failed / Cancelled -->
				{#if resumableJobs.length > 0}
					<div class="section">
						<button
							type="button"
							class="section-toggle"
							onclick={() => toggleSection('failed')}
							aria-expanded={sectionExpanded.failed}
						>
							<span class="section-title-main section-title error-title">
								<span>Needs Attention</span>
							</span>
							<span class="section-title-actions">
								<span class="section-count">{resumableJobs.length}</span>
								<span class="section-chevron">
									{#if sectionExpanded.failed}
										<ChevronUp size={16} />
									{:else}
										<ChevronDown size={16} />
									{/if}
								</span>
							</span>
						</button>
						{#if sectionExpanded.failed}
							<div class="failed-list">
								{#each resumableJobs.slice(0, 4) as job (job.id)}
									{@const jobPending = isJobActionPending(job.id)}
									<div class="failed-item-card">
										<button
											type="button"
											class="failed-item-click"
											onclick={() => expandedJobId = expandedJobId === job.id ? null : job.id}
											aria-expanded={expandedJobId === job.id}
										>
											<div class="failed-item-main">
												<div class="failed-item-info">
													<div class="failed-item-title">
														{job.job.type === 'track' ? job.job.trackTitle : job.job.albumTitle || 'Unknown'}
													</div>
													<div class="failed-item-artist">{job.job.artistName || 'Unknown'}</div>
													<div class="failed-item-error-text">
														{job.status === 'paused'
															? 'Paused by user'
															: job.status === 'cancelled'
																? 'Cancelled by user'
																: job.error || 'Unknown error'}
													</div>
												</div>
												<span class="expand-icon">
													{#if expandedJobId === job.id}
														<ChevronUp size={16} />
													{:else}
														<ChevronDown size={16} />
													{/if}
												</span>
											</div>

											{#if expandedJobId === job.id}
												<div class="failed-item-details">
													<div class="detail-row">
														<span class="detail-label">Job ID:</span>
														<span class="detail-value" style="font-family: monospace; font-size: 11px;">{job.id}</span>
													</div>
													<div class="detail-row">
														<span class="detail-label">Status:</span>
														<span class="detail-value">{job.status}</span>
													</div>
													<div class="detail-row">
														<span class="detail-label">Type:</span>
														<span class="detail-value">{job.job.type === 'track' ? 'Single Track' : 'Album'}</span>
													</div>
													<div class="detail-row">
														<span class="detail-label">Artist:</span>
														<span class="detail-value">{job.job.artistName || 'Unknown'}</span>
													</div>
													<div class="detail-actions">
														<span
															role="button"
															tabindex={jobPending ? -1 : 0}
															class="item-action-btn item-action-btn--primary"
															onclick={(event) => {
																event.stopPropagation();
																if (job.status === 'paused') {
																	void handleResumePausedJob(job);
																	return;
																}
																void handleRetryJob(job);
															}}
															onkeydown={(event) => {
																if (jobPending) return;
																if (event.key === 'Enter' || event.key === ' ') {
																	event.preventDefault();
																	event.stopPropagation();
																	if (job.status === 'paused') {
																		void handleResumePausedJob(job);
																		return;
																	}
																	void handleRetryJob(job);
																}
															}}
															aria-disabled={jobPending}
														>
															<RotateCcw size={12} />
															<span>{jobPending ? 'Resuming…' : job.status === 'paused' ? 'Resume' : 'Retry'}</span>
														</span>
														<span
															role="button"
															tabindex={jobPending ? -1 : 0}
															class="item-action-btn"
															onclick={(event) => {
																event.stopPropagation();
																void handleCopyFailureReport(job);
															}}
															onkeydown={(event) => {
																if (jobPending) return;
																if (event.key === 'Enter' || event.key === ' ') {
																	event.preventDefault();
																	event.stopPropagation();
																	void handleCopyFailureReport(job);
																}
															}}
															aria-disabled={jobPending}
														>
															<ClipboardCopy size={12} />
															<span>{jobPending ? 'Copying…' : 'Report'}</span>
														</span>
														<span
															role="button"
															tabindex={jobPending ? -1 : 0}
															class="item-action-btn item-action-btn--danger"
															onclick={(event) => {
																event.stopPropagation();
																void handleRemoveJob(job);
															}}
															onkeydown={(event) => {
																if (jobPending) return;
																if (event.key === 'Enter' || event.key === ' ') {
																	event.preventDefault();
																	event.stopPropagation();
																	void handleRemoveJob(job);
																}
															}}
															aria-disabled={jobPending}
														>
															<Trash2 size={12} />
															<span>{jobPending ? 'Removing…' : 'Dismiss'}</span>
														</span>
													</div>
												</div>
											{/if}
										</button>
									</div>
								{/each}

								{#if resumableJobs.length > 4}
									<div class="queue-more-hint">
										+{resumableJobs.length - 4} more items
									</div>
								{/if}
							</div>
							<div class="failed-actions">
								<button
									onclick={handleClearFailed}
									class="control-btn control-btn--danger"
									type="button"
									title="Clear failed and cancelled download history"
									disabled={isActionPending(actionKeys.clearHistory)}
								>
									<Trash2 size={14} />
									<span>
										{isActionPending(actionKeys.clearHistory) ? 'Clearing…' : 'Clear History'}
									</span>
								</button>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Empty state -->
				{#if stats.total === 0}
					<div class="download-manager-empty">
						<p class="empty-message">No downloads yet</p>
						<p class="empty-hint">Queue a track or album and it will appear here in real time.</p>
						<div class="empty-cta-actions">
							<a href="/" class="empty-cta-btn">Open Search</a>
						</div>
						<div class="empty-steps">
							<div class="empty-step">1. Open an album page and click <strong>Download Album</strong>.</div>
							<div class="empty-step">2. Open a track page and click <strong>Download</strong>.</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Footer with controls -->
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
		</div>
	{/if}
</div>

<style>
	.download-manager-container {
		--color-primary: #f5f5f5;
		--color-success: #e5e7eb;
		--color-warning: #f59e0b;
		--color-error: #ef4444;
		--color-bg-primary: var(--mono-surface-card);
		--color-bg-secondary: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		--color-border: var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		--color-text-primary: rgba(245, 245, 245, 0.96);
		--color-text-secondary: rgba(163, 163, 163, 0.86);
	}

	.download-manager-container--page {
		width: 100%;
	}

	.download-manager-toggle {
		all: unset;
		position: fixed;
		bottom: calc(20px + var(--player-height, 0px) + env(safe-area-inset-bottom, 0px));
		right: 20px;
		z-index: 99999;
		cursor: pointer;

		display: flex;
		align-items: center;
		justify-content: center;
		width: 52px;
		height: 52px;
		border-radius: 50%;
		border: 1px solid var(--color-border);
		background: var(--color-bg-primary);
		color: var(--color-text-primary);
		font-size: 22px;
		box-shadow: var(--ui-shadow-soft, 0 10px 28px rgba(0, 0, 0, 0.22));
		transition: border-color 180ms ease, background 180ms ease, transform 180ms ease;
	}

	.download-manager-toggle:hover {
		transform: translateY(-1px);
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
	}

	.download-manager-badge {
		position: absolute;
		top: -8px;
		right: -8px;
		min-width: 26px;
		height: 26px;
		padding: 0 6px;
		border-radius: 13px;
		background: rgba(239, 68, 68, 0.88);
		color: white;
		font-size: 11px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid rgba(8, 8, 8, 0.9);
	}

	.download-manager-panel {
		position: fixed;
		bottom: calc(20px + var(--player-height, 0px) + 80px + env(safe-area-inset-bottom, 0px));
		right: 20px;
		z-index: 99998;
		width: 680px;
		max-height: 80vh;
		max-height: 80dvh;
		border-radius: var(--ui-radius-md, 14px);
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border);
		box-shadow: var(--ui-shadow-soft, 0 10px 28px rgba(0, 0, 0, 0.22));
		animation: slideUp 0.3s ease;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.download-manager-panel--page {
		position: relative;
		left: auto;
		right: auto;
		bottom: auto;
		z-index: 1;
		width: 100%;
		max-height: min(78vh, 980px);
		animation: none;
		box-shadow: var(--ui-shadow-soft, 0 10px 28px rgba(0, 0, 0, 0.22));
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.download-manager-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
		gap: 12px;
	}

	.download-manager-title {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
		color: var(--color-text-primary);
		letter-spacing: 0.5px;
	}

	.download-manager-subtitle-text {
		margin: 4px 0 0 0;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.download-manager-meta-row {
		margin-top: 6px;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.download-manager-meta-separator {
		font-size: 11px;
		color: var(--color-text-secondary);
		opacity: 0.7;
	}

	.download-manager-last-updated {
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.download-manager-poll-status {
		font-size: 11px;
		color: var(--color-text-secondary);
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.download-manager-poll-status[data-stale='true'] {
		color: #fbbf24;
	}

	.poll-stale-chip {
		font-size: 9px;
		line-height: 1;
		padding: 3px 5px;
		border-radius: 999px;
		letter-spacing: 0.3px;
		font-weight: 700;
		color: #fef3c7;
		background: rgba(245, 158, 11, 0.28);
		border: 1px solid rgba(245, 158, 11, 0.5);
	}

	.download-manager-compact-indicator {
		font-size: 11px;
		color: #d4d4d4;
	}

	.download-manager-redis {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.download-manager-redis-dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: #94a3b8;
		display: inline-block;
	}

	.download-manager-redis[data-state='ok'] .download-manager-redis-dot {
		background: #10b981;
	}

	.download-manager-redis[data-state='warn'] .download-manager-redis-dot {
		background: #f59e0b;
	}

	.download-manager-redis[data-state='unknown'] .download-manager-redis-dot {
		background: #64748b;
	}

	.download-manager-close {
		all: unset;
		cursor: pointer;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
		border-radius: 6px;
		color: var(--color-text-secondary);
		transition: all 0.2s;
		flex-shrink: 0;
	}

	.download-manager-close:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
	}

	.download-manager-error {
		margin: 0 16px 12px;
		padding: 10px 12px;
		border-radius: 10px;
		background: rgba(239, 68, 68, 0.16);
		color: #fecaca;
		font-size: 12px;
		line-height: 1.4;
	}

	.download-manager-warning {
		margin: 0 16px 12px;
		padding: 10px 12px;
		border-radius: 10px;
		background: rgba(245, 158, 11, 0.16);
		color: #fde68a;
		font-size: 12px;
		line-height: 1.4;
	}

	.download-manager-notice {
		margin: 0 16px 12px;
		padding: 10px 12px;
		border-radius: 10px;
		font-size: 12px;
		line-height: 1.4;
		border: 1px solid var(--color-border);
	}

	.download-manager-notice[data-tone='success'] {
		background: rgba(16, 185, 129, 0.16);
		color: #d1fae5;
		border-color: rgba(16, 185, 129, 0.4);
	}

	.download-manager-notice[data-tone='error'] {
		background: rgba(239, 68, 68, 0.16);
		color: #fecaca;
		border-color: rgba(239, 68, 68, 0.4);
	}

	.download-manager-notice[data-tone='info'] {
		background: rgba(245, 245, 245, 0.12);
		color: #f5f5f5;
		border-color: rgba(245, 245, 245, 0.28);
	}

	.download-status-hero {
		margin: 0 16px 12px;
		padding: 12px;
		border-radius: 12px;
		border: 1px solid rgba(148, 163, 184, 0.22);
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.download-status-hero[data-active='false'] {
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
	}

	.download-status-hero__main {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.download-status-hero__eyebrow {
		margin: 0;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.22em;
		color: rgba(226, 232, 240, 0.8);
		font-weight: 700;
	}

	.download-status-hero__main h4 {
		margin: 0;
		font-size: 16px;
		line-height: 1.25;
		color: #f8fafc;
	}

	.download-status-hero__main p {
		margin: 0;
		font-size: 12px;
		color: rgba(226, 232, 240, 0.8);
	}

	.download-status-hero__meter {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.download-status-hero__meter-track {
		height: 8px;
		border-radius: 999px;
		background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
		overflow: hidden;
		border: 1px solid rgba(226, 232, 240, 0.16);
	}

	.download-status-hero__meter-fill {
		height: 100%;
		background: linear-gradient(
			90deg,
			rgba(245, 245, 245, 0.95),
			rgba(212, 212, 212, 0.76)
		);
		transition: width 220ms ease;
	}

	.download-status-hero__meter-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 11px;
		color: rgba(226, 232, 240, 0.86);
	}

	.download-status-hero__meter-meta strong {
		font-size: 13px;
		color: #f8fafc;
	}

	.download-status-hero__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.download-status-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 5px 9px;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.24);
		background: rgba(15, 23, 42, 0.45);
		color: rgba(226, 232, 240, 0.88);
	}

	.download-status-chip[data-tone='ok'] {
		border-color: rgba(16, 185, 129, 0.44);
		background: rgba(16, 185, 129, 0.2);
		color: #d1fae5;
	}

	.download-status-chip[data-tone='warn'] {
		border-color: rgba(245, 158, 11, 0.45);
		background: rgba(245, 158, 11, 0.18);
		color: #fde68a;
	}

	.download-manager-top-strip {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 8px;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		padding: 12px 16px;
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		position: sticky;
		top: 0;
		z-index: 2;
		flex-shrink: 0;
	}

	.download-manager-quick-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--color-border);
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
	}

	.top-strip-item {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px;
		border-radius: 10px;
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		border: 1px solid var(--color-border);
		min-width: 0;
	}

	.top-strip-label {
		font-size: 10px;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.3px;
		font-weight: 600;
	}

	.top-strip-value {
		font-size: 24px;
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1;
	}

	.top-strip-value--text {
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.top-strip-item--running .top-strip-value {
		color: rgba(245, 245, 245, 0.96);
	}

	.top-strip-item--queued .top-strip-value {
		color: #f59e0b;
	}

	.top-strip-item--paused .top-strip-value {
		color: #facc15;
	}

	.top-strip-item--failed .top-strip-value {
		color: #ef4444;
	}

	/* Main content */
	.download-manager-content {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 16px;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.current-section {
		border: 1px solid rgba(16, 185, 129, 0.32);
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		padding: 12px;
		border-radius: 10px;
	}

	.section-title {
		margin: 0;
		font-size: 13px;
		font-weight: 700;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.section-toggle {
		all: unset;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		cursor: pointer;
		border-radius: 8px;
		padding: 4px 6px;
		box-sizing: border-box;
		min-height: 40px;
	}

	.section-toggle:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	.section-title-main {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.section-title-actions {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.section-chevron {
		display: inline-flex;
		align-items: center;
		color: var(--color-text-secondary);
	}

	.section-title-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		color: var(--color-text-secondary);
	}

	.error-title {
		color: var(--color-error);
	}

	.section-count {
		background: var(--color-bg-secondary);
		padding: 3px 8px;
		border-radius: 10px;
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	/* Current items */
	.current-items {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.current-item {
		background: rgba(15, 23, 42, 0.45);
		border: 1px solid rgba(148, 163, 184, 0.2);
		border-radius: 10px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.current-item-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.item-action-row {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.current-item-title {
		font-weight: 600;
		font-size: 13px;
		color: var(--color-text-primary);
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.badge {
		padding: 3px 8px;
		border-radius: 4px;
		font-size: 10px;
		font-weight: 700;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.badge-processing {
		background: rgba(16, 185, 129, 0.2);
		color: #10b981;
	}

	.current-item-meta {
		font-size: 11px;
		color: var(--color-text-secondary);
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.meta-separator {
		opacity: 0.5;
	}

	.progress-bar {
		width: 100%;
		height: 6px;
		background: rgba(148, 163, 184, 0.2);
		border-radius: 999px;
		overflow: hidden;
		margin-top: 4px;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(
			90deg,
			rgba(245, 245, 245, 0.95),
			rgba(212, 212, 212, 0.76)
		);
		transition: width 0.2s ease;
	}

	.progress-text {
		font-size: 10px;
		color: var(--color-text-secondary);
		text-align: right;
	}

	.section-filter-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.section-filter-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.3px;
		color: var(--color-text-secondary);
		font-weight: 600;
	}

	.filter-pills {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.filter-pill {
		all: unset;
		cursor: pointer;
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 11px;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.02);
		min-height: 34px;
		display: inline-flex;
		align-items: center;
	}

	.filter-pill:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-primary);
	}

	.filter-pill.is-active {
		background: rgba(255, 255, 255, 0.14);
		border-color: rgba(255, 255, 255, 0.42);
		color: #f5f5f5;
	}

	.filter-empty-state {
		border: 1px dashed var(--color-border);
		border-radius: 8px;
		padding: 12px;
		font-size: 12px;
		color: var(--color-text-secondary);
		text-align: center;
		background: rgba(255, 255, 255, 0.02);
	}

	/* Queue list */
	.queue-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: 300px;
		overflow-y: auto;
	}

	.queue-item-card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.queue-item-click,
	.failed-item-click {
		cursor: pointer;
		padding: 12px;
		transition: background 0.2s;
		background: none;
		border: none;
		text-align: left;
		width: 100%;
		color: inherit;
		min-height: 44px;
	}

	.queue-item-click:hover,
	.failed-item-click:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.queue-item-main {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.queue-item-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.queue-item-title {
		font-weight: 600;
		font-size: 12px;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.queue-item-artist {
		font-size: 11px;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.queue-item-album {
		font-size: 10px;
		color: var(--color-text-secondary);
		opacity: 0.8;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta-album-progress {
		font-weight: 600;
		color: #10b981;
	}

	.expand-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-secondary);
		flex-shrink: 0;
		transition: transform 0.2s;
	}

	.queue-item-details {
		padding-top: 8px;
		border-top: 1px solid var(--color-border);
		margin-top: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.detail-row {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-size: 11px;
	}

	.detail-label {
		color: var(--color-text-secondary);
		font-weight: 600;
		min-width: 70px;
	}

	.detail-value {
		color: var(--color-text-primary);
		text-align: right;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.detail-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding-top: 8px;
		border-top: 1px solid var(--color-border);
		margin-top: 6px;
	}

	.queue-more-hint {
		text-align: center;
		padding: 8px 10px;
		font-size: 11px;
		color: var(--color-text-secondary);
		background: rgba(255, 255, 255, 0.02);
		border-top: 1px solid var(--color-border);
	}

	/* Completion summary */
	.completion-summary {
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 10px;
		font-size: 12px;
		color: var(--color-text-primary);
	}

	.completion-summary p {
		margin: 0;
	}

	.completed-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.completed-item {
		padding: 10px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
	}

	.completed-item-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.completed-item-title {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.completed-item-meta {
		margin-top: 4px;
		font-size: 11px;
		color: var(--color-text-secondary);
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	/* Failed items */
	.failed-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: 250px;
		overflow-y: auto;
	}

	.failed-item-card {
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: 6px;
		overflow: hidden;
	}

	.failed-item-click {
		cursor: pointer;
		padding: 10px;
		transition: background 0.2s;
	}

	.failed-item-click:hover {
		background: rgba(239, 68, 68, 0.12);
	}

	.failed-item-main {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.failed-item-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.failed-item-title {
		font-weight: 600;
		font-size: 12px;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-bottom: 2px;
	}

	.failed-item-artist {
		font-size: 11px;
		color: var(--color-text-secondary);
		margin-bottom: 3px;
	}

	.failed-item-error-text {
		font-size: 10px;
		color: var(--color-error);
		white-space: normal;
		word-break: break-word;
		line-height: 1.3;
	}

	.failed-item-details {
		padding-top: 8px;
		border-top: 1px solid rgba(239, 68, 68, 0.2);
		margin-top: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.failed-actions {
		display: flex;
		gap: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--color-border);
	}

	/* Controls */
	.control-btn {
		all: unset;
		cursor: pointer;
		padding: 8px 14px;
		border-radius: 6px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
		transition: all 0.2s;
		white-space: nowrap;
		border: 1px solid transparent;
		min-height: 40px;
		box-sizing: border-box;
	}

	.item-action-btn {
		all: unset;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--color-border);
		color: var(--color-text-primary);
		background: rgba(255, 255, 255, 0.04);
		min-height: 28px;
		box-sizing: border-box;
	}

	.item-action-btn:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.item-action-btn:active {
		transform: translateY(1px);
	}

	.item-action-btn:disabled,
	.item-action-btn[aria-disabled='true'] {
		opacity: 0.45;
		cursor: not-allowed;
		pointer-events: none;
	}

	.item-action-btn--primary {
		border-color: rgba(245, 245, 245, 0.45);
		color: #f5f5f5;
		background: rgba(245, 245, 245, 0.12);
	}

	.item-action-btn--warning {
		border-color: rgba(245, 158, 11, 0.5);
		color: #fde68a;
		background: rgba(245, 158, 11, 0.14);
	}

	.item-action-btn--danger {
		border-color: rgba(239, 68, 68, 0.5);
		color: #fecaca;
		background: rgba(239, 68, 68, 0.14);
	}

	.control-btn--secondary {
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
	}

	.control-btn--primary {
		background: rgba(245, 245, 245, 0.16);
		color: #f5f5f5;
		border-color: rgba(245, 245, 245, 0.45);
	}

	.control-btn--primary:hover {
		background: rgba(245, 245, 245, 0.24);
	}

	.control-btn--warning {
		background: rgba(245, 158, 11, 0.18);
		color: #fde68a;
		border-color: rgba(245, 158, 11, 0.4);
	}

	.control-btn--warning:hover {
		background: rgba(245, 158, 11, 0.26);
	}

	.control-btn--secondary:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.control-btn--danger {
		background: rgba(239, 68, 68, 0.1);
		color: var(--color-error);
		border: 1px solid rgba(239, 68, 68, 0.3);
	}

	.control-btn--danger:hover {
		background: rgba(239, 68, 68, 0.2);
	}

	.control-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.control-btn:active:not(:disabled) {
		transform: translateY(1px);
	}

	/* Empty state */
	.download-manager-empty {
		padding: 60px 16px;
		text-align: center;
		color: var(--color-text-secondary);
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		min-height: 200px;
	}

	.empty-message {
		margin: 0 0 8px 0;
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.empty-hint {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		opacity: 0.7;
		max-width: 280px;
	}

	.empty-cta-actions {
		margin-top: 14px;
	}

	.empty-cta-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px 12px;
		border-radius: 8px;
		border: 1px solid rgba(245, 245, 245, 0.45);
		background: rgba(245, 245, 245, 0.14);
		color: #f5f5f5;
		font-size: 12px;
		font-weight: 600;
		text-decoration: none;
		transition: all 0.2s;
	}

	.empty-cta-btn:hover {
		background: rgba(245, 245, 245, 0.24);
	}

	.empty-steps {
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.empty-step {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	/* Footer */
	.download-manager-footer {
		padding: 12px 16px;
		border-top: 1px solid var(--color-border);
		display: flex;
		gap: 8px;
		flex-shrink: 0;
		background: var(--color-bg-secondary);
		position: sticky;
		bottom: 0;
		z-index: 2;
		backdrop-filter: blur(4px);
	}

	.download-manager-panel.compact-mode .download-manager-content {
		gap: 10px;
		padding: 12px;
	}

	.download-manager-panel.compact-mode .current-item,
	.download-manager-panel.compact-mode .queue-item-click,
	.download-manager-panel.compact-mode .failed-item-click,
	.download-manager-panel.compact-mode .completed-item {
		padding: 8px;
	}

	.download-manager-panel.compact-mode .current-item-title,
	.download-manager-panel.compact-mode .queue-item-title,
	.download-manager-panel.compact-mode .failed-item-title,
	.download-manager-panel.compact-mode .completed-item-title {
		font-size: 12px;
	}

	.download-manager-panel.compact-mode .current-item-meta,
	.download-manager-panel.compact-mode .queue-item-artist,
	.download-manager-panel.compact-mode .failed-item-artist,
	.download-manager-panel.compact-mode .completed-item-meta {
		font-size: 10px;
	}

	.rotating {
		display: inline-block;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	/* Scrollbars */
	.download-manager-content::-webkit-scrollbar,
	.queue-list::-webkit-scrollbar,
	.failed-list::-webkit-scrollbar {
		width: 6px;
	}

	.download-manager-content::-webkit-scrollbar-track,
	.queue-list::-webkit-scrollbar-track,
	.failed-list::-webkit-scrollbar-track {
		background: transparent;
	}

	.download-manager-content::-webkit-scrollbar-thumb,
	.queue-list::-webkit-scrollbar-thumb,
	.failed-list::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.15);
		border-radius: 3px;
	}

	.download-manager-content::-webkit-scrollbar-thumb:hover,
	.queue-list::-webkit-scrollbar-thumb:hover,
	.failed-list::-webkit-scrollbar-thumb:hover {
		background: rgba(255, 255, 255, 0.25);
	}

	/* Responsive */
	@media (max-width: 1024px) {
		.download-manager-panel {
			width: min(760px, calc(100vw - 24px));
			max-height: 74vh;
		}

		.download-manager-top-strip {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.download-manager-quick-actions {
			padding: 10px 12px;
		}
	}

	@media (max-width: 640px) {
		.download-manager-panel {
			left: 8px;
			right: 8px;
			width: auto;
			max-height: 68vh;
			max-height: 68dvh;
		}

		.download-manager-top-strip {
			grid-template-columns: repeat(2, 1fr);
		}

		.section-filter-row {
			flex-direction: column;
			align-items: flex-start;
		}

		.filter-pills {
			flex-wrap: wrap;
		}

		.control-btn span {
			display: none;
		}

		.control-btn {
			padding: 8px;
		}

		.download-manager-content {
			padding: 12px;
			gap: 12px;
		}

		.current-item-title,
		.queue-item-title,
		.failed-item-title,
		.completed-item-title {
			white-space: normal;
			display: -webkit-box;
			line-clamp: 2;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
		}

		.download-manager-close {
			width: 40px;
			height: 40px;
		}

			.download-manager-footer {
				padding: 10px 12px;
			}
		}

	.download-manager-panel--page {
		left: auto;
		right: auto;
		width: 100%;
	}
</style>
