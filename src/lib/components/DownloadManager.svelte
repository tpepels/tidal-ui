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
	let showDetailedSections = $state(false);
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
	let queuedPreviewJobs = $derived(queuedJobs.slice(0, 4));
	let attentionPreviewJobs = $derived(resumableJobs.slice(0, 4));
	let completedPreviewJobs = $derived(completedJobs.slice(0, 4));
	let activeSectionOpen = $derived(pageMode || sectionExpanded.active);
	let queueSectionOpen = $derived(pageMode || sectionExpanded.queue);
	let failedSectionOpen = $derived(pageMode || sectionExpanded.failed);
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

			<div class="download-status-hero" data-active={stats.running > 0} data-ui-block="key-summary">
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

			{#if !pageMode}
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
			{/if}

			{#if !pageMode || showDetailedSections}
			<div class="download-manager-quick-actions" data-ui-block="primary-actions">
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
			{/if}

			<div class="download-manager-content" data-ui-block="main-sections">
				{#if pageMode}
					<div class="section section--priority">
						<div class="section-title section-title-main">
							<span>Priority Overview</span>
						</div>
						<p class="priority-overview-subtitle">
							Key queue information is always visible. Use actions here first.
						</p>
						<div class="priority-grid">
							<div class="priority-column">
								<div class="priority-column__header">
									<h4 class="priority-column__title">Active Now</h4>
									<span class="section-count">{processingJobs.length}</span>
								</div>
								{#if processingJobs.length === 0}
									<p class="priority-empty">No active downloads.</p>
								{:else}
									<div class="priority-list">
										{#each processingJobs as job (job.id)}
											{@const jobPending = isJobActionPending(job.id)}
											<div class="priority-item">
												<div class="priority-item__main">
													<p class="priority-item__title">{job.job.trackTitle || job.job.albumTitle || 'Unknown'}</p>
													<p class="priority-item__meta">
														{job.job.artistName || 'Unknown Artist'} • {Math.round(job.progress * 100)}%
													</p>
												</div>
												<div class="detail-actions">
													<button
														type="button"
														class="item-action-btn"
														onclick={() => handlePauseJob(job)}
														disabled={jobPending}
													>
														<Square size={12} />
														<span>{jobPending ? 'Pausing…' : 'Pause'}</span>
													</button>
													<button
														type="button"
														class="item-action-btn item-action-btn--warning"
														onclick={() => handleCancelJob(job)}
														disabled={jobPending}
													>
														<Square size={12} />
														<span>{jobPending ? 'Stopping…' : 'Stop'}</span>
													</button>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>

							<div class="priority-column">
								<div class="priority-column__header">
									<h4 class="priority-column__title">Needs Attention</h4>
									<span class="section-count">{attentionPreviewJobs.length}</span>
								</div>
								{#if attentionPreviewJobs.length === 0}
									<p class="priority-empty">No blocked items.</p>
								{:else}
									<div class="priority-list">
										{#each attentionPreviewJobs as job (job.id)}
											{@const jobPending = isJobActionPending(job.id)}
											<div class="priority-item">
												<div class="priority-item__main">
													<p class="priority-item__title">{job.job.trackTitle || job.job.albumTitle || 'Unknown'}</p>
													<p class="priority-item__meta">
														{job.status === 'paused' ? 'Paused' : job.status === 'cancelled' ? 'Cancelled' : job.error || 'Failed'}
													</p>
												</div>
												<div class="detail-actions">
													<button
														type="button"
														class="item-action-btn item-action-btn--primary"
														onclick={() => {
															if (job.status === 'paused') {
																void handleResumePausedJob(job);
																return;
															}
															void handleRetryJob(job);
														}}
														disabled={jobPending}
													>
														<RotateCcw size={12} />
														<span>{jobPending ? 'Working…' : job.status === 'paused' ? 'Resume' : 'Retry'}</span>
													</button>
													<button
														type="button"
														class="item-action-btn"
														onclick={() => handleCopyFailureReport(job)}
														disabled={jobPending}
													>
														<ClipboardCopy size={12} />
														<span>{jobPending ? 'Copying…' : 'Report'}</span>
													</button>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>

							<div class="priority-column">
								<div class="priority-column__header">
									<h4 class="priority-column__title">Up Next</h4>
									<span class="section-count">{queuedJobs.length}</span>
								</div>
								{#if queuedPreviewJobs.length === 0}
									<p class="priority-empty">Queue is empty.</p>
								{:else}
									<div class="priority-list">
										{#each queuedPreviewJobs as job (job.id)}
											{@const jobPending = isJobActionPending(job.id)}
											<div class="priority-item">
												<div class="priority-item__main">
													<p class="priority-item__title">{job.job.trackTitle || job.job.albumTitle || 'Unknown'}</p>
													<p class="priority-item__meta">
														{job.job.artistName || 'Unknown Artist'} • {job.job.type === 'album' ? 'Album' : 'Track'}
													</p>
												</div>
												<div class="detail-actions">
													<button
														type="button"
														class="item-action-btn item-action-btn--warning"
														onclick={() => handleCancelJob(job)}
														disabled={jobPending}
													>
														<Square size={12} />
														<span>{jobPending ? 'Stopping…' : 'Stop'}</span>
													</button>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>

							<div class="priority-column">
								<div class="priority-column__header">
									<h4 class="priority-column__title">Recently Completed</h4>
									<span class="section-count">{completedJobs.length}</span>
								</div>
								{#if completedPreviewJobs.length === 0}
									<p class="priority-empty">No completed items yet.</p>
								{:else}
									<div class="priority-list">
										{#each completedPreviewJobs as job (job.id)}
											{@const jobPending = isJobActionPending(job.id)}
											<div class="priority-item">
												<div class="priority-item__main">
													<p class="priority-item__title">{job.job.trackTitle || job.job.albumTitle || 'Unknown'}</p>
													<p class="priority-item__meta">
														{job.job.artistName || 'Unknown Artist'}
														{#if job.completedAt}
															• {new Date(job.completedAt).toLocaleTimeString()}
														{/if}
													</p>
												</div>
												<div class="detail-actions">
													<button
														type="button"
														class="item-action-btn"
														onclick={() => handleRemoveJob(job)}
														disabled={jobPending}
													>
														<Trash2 size={12} />
														<span>{jobPending ? 'Removing…' : 'Dismiss'}</span>
													</button>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>
						{#if stats.total === 0}
							<div class="priority-empty-state">
								<p>No downloads yet. Queue a track or album from Search to start.</p>
								<a href="/" class="empty-cta-btn">Open Search</a>
							</div>
						{/if}
						<div class="priority-bulk-actions">
							<button
								onclick={handlePauseAllActive}
								class="control-btn control-btn--secondary"
								type="button"
								disabled={!canPauseAny || isActionPending(actionKeys.bulkPause)}
							>
								<Square size={14} />
								<span>{isActionPending(actionKeys.bulkPause) ? 'Pausing…' : 'Pause Active'}</span>
							</button>
							<button
								onclick={handleStopAllActive}
								class="control-btn control-btn--warning"
								type="button"
								disabled={!canStopAny || isActionPending(actionKeys.bulkStop)}
							>
								<Square size={14} />
								<span>{isActionPending(actionKeys.bulkStop) ? 'Stopping…' : 'Stop Active'}</span>
							</button>
							<button
								onclick={handleResumeAll}
								class="control-btn control-btn--primary"
								type="button"
								disabled={!canResumeAny || isActionPending(actionKeys.bulkResume)}
							>
								<RotateCcw size={14} />
								<span>{isActionPending(actionKeys.bulkResume) ? 'Resuming…' : 'Resume Blocked'}</span>
							</button>
							<button
								onclick={handleManualRefresh}
								class="control-btn control-btn--secondary"
								type="button"
								disabled={isActionPending(actionKeys.refresh)}
							>
								<RefreshCw size={14} />
								<span>{isActionPending(actionKeys.refresh) ? 'Refreshing…' : 'Refresh'}</span>
							</button>
						</div>
						<div class="priority-overview-actions">
							<button
								type="button"
								class="control-btn control-btn--secondary"
								onclick={() => (showDetailedSections = !showDetailedSections)}
							>
								{showDetailedSections ? 'Hide Detailed Timeline' : 'Show Detailed Timeline'}
							</button>
						</div>
					</div>
				{/if}

				{#if !pageMode || showDetailedSections}
				<!-- Current/Active Downloads -->
				{#if stats.running > 0}
					<div class="section section--active current-section">
						<button
							type="button"
							class="section-toggle"
							onclick={() => {
								if (!pageMode) toggleSection('active');
							}}
							aria-expanded={activeSectionOpen}
						>
							<span class="section-title-main section-title">
								<span class="section-title-icon rotating"><RefreshCw size={14} strokeWidth={2} /></span>
								<span>Active Downloads</span>
							</span>
							<span class="section-title-actions">
								<span class="section-count">{stats.running}</span>
								{#if !pageMode}
									<span class="section-chevron">
										{#if activeSectionOpen}
											<ChevronUp size={16} />
										{:else}
											<ChevronDown size={16} />
										{/if}
									</span>
								{/if}
							</span>
						</button>
						{#if activeSectionOpen}
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
					<div class="section section--queue">
						<button
							type="button"
							class="section-toggle"
							onclick={() => {
								if (!pageMode) toggleSection('queue');
							}}
							aria-expanded={queueSectionOpen}
						>
							<span class="section-title-main section-title">
								<span>Queue</span>
							</span>
							<span class="section-title-actions">
								<span class="section-count">{stats.queued}</span>
								{#if !pageMode}
									<span class="section-chevron">
										{#if queueSectionOpen}
											<ChevronUp size={16} />
										{:else}
											<ChevronDown size={16} />
										{/if}
									</span>
								{/if}
							</span>
						</button>
						{#if queueSectionOpen}
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
										{@const queueItemExpanded = pageMode || expandedJobId === job.id}
										<div class="queue-item-card">
											{#if pageMode}
												<div class="queue-item-click">
													<div class="queue-item-main">
														<div class="queue-item-info">
															<div class="queue-item-title">{job.job.trackTitle || job.job.albumTitle || 'Unknown'}</div>
															<div class="queue-item-artist">{job.job.artistName || 'Unknown Artist'}</div>
															{#if job.job.albumTitle && job.job.trackTitle}
																<div class="queue-item-album">{job.job.albumTitle}</div>
															{/if}
														</div>
													</div>
													<div class="queue-item-summary">
														<span>{job.job.type === 'track' ? 'Track' : 'Album'}</span>
														<span class="meta-separator">•</span>
														<span>{job.job.quality || 'Lossless'}</span>
														{#if job.job.type === 'album' && job.trackCount}
															<span class="meta-separator">•</span>
															<span>{job.completedTracks || 0}/{job.trackCount} tracks</span>
														{/if}
													</div>
												</div>
											{:else}
												<button
													type="button"
													class="queue-item-click"
													onclick={() => {
														expandedJobId = expandedJobId === job.id ? null : job.id;
													}}
													aria-expanded={queueItemExpanded}
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
															{#if queueItemExpanded}
																<ChevronUp size={16} />
															{:else}
																<ChevronDown size={16} />
															{/if}
														</span>
													</div>
													<div class="queue-item-summary">
														<span>{job.job.type === 'track' ? 'Track' : 'Album'}</span>
														<span class="meta-separator">•</span>
														<span>{job.job.quality || 'Lossless'}</span>
														{#if job.job.type === 'album' && job.trackCount}
															<span class="meta-separator">•</span>
															<span>{job.completedTracks || 0}/{job.trackCount} tracks</span>
														{/if}
													</div>
												</button>
											{/if}
											{#if queueItemExpanded}
												<div class="queue-item-details">
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
														<button
															type="button"
															class="item-action-btn"
															onclick={() => {
																void handlePauseJob(job);
															}}
															disabled={jobPending}
														>
															<Square size={12} />
															<span>{jobPending ? 'Pausing…' : 'Pause'}</span>
														</button>
														<button
															type="button"
															class="item-action-btn item-action-btn--warning"
															onclick={() => {
																void handleCancelJob(job);
															}}
															disabled={jobPending}
														>
															<Square size={12} />
															<span>{jobPending ? 'Stopping…' : 'Stop'}</span>
														</button>
													</div>
												</div>
											{/if}
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
					<div class="section section--completed">
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
					<div class="section section--attention">
						<button
							type="button"
							class="section-toggle"
							onclick={() => {
								if (!pageMode) toggleSection('failed');
							}}
							aria-expanded={failedSectionOpen}
						>
							<span class="section-title-main section-title error-title">
								<span>Needs Attention</span>
							</span>
							<span class="section-title-actions">
								<span class="section-count">{resumableJobs.length}</span>
								{#if !pageMode}
									<span class="section-chevron">
										{#if failedSectionOpen}
											<ChevronUp size={16} />
										{:else}
											<ChevronDown size={16} />
										{/if}
									</span>
								{/if}
							</span>
						</button>
						{#if failedSectionOpen}
							<div class="failed-list">
								{#each resumableJobs.slice(0, 4) as job (job.id)}
									{@const jobPending = isJobActionPending(job.id)}
									{@const failedItemExpanded = pageMode || expandedJobId === job.id}
									<div class="failed-item-card">
										{#if pageMode}
											<div class="failed-item-click">
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
												</div>
												<div class="failed-item-summary">
													<span>{job.job.type === 'track' ? 'Track' : 'Album'}</span>
													<span class="meta-separator">•</span>
													<span>{job.job.quality || 'Lossless'}</span>
												</div>
											</div>
										{:else}
											<button
												type="button"
												class="failed-item-click"
												onclick={() => {
													expandedJobId = expandedJobId === job.id ? null : job.id;
												}}
												aria-expanded={failedItemExpanded}
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
														{#if failedItemExpanded}
															<ChevronUp size={16} />
														{:else}
															<ChevronDown size={16} />
														{/if}
													</span>
												</div>
												<div class="failed-item-summary">
													<span>{job.job.type === 'track' ? 'Track' : 'Album'}</span>
													<span class="meta-separator">•</span>
													<span>{job.job.quality || 'Lossless'}</span>
												</div>
											</button>
										{/if}
										{#if failedItemExpanded}
											<div class="failed-item-details">
												<div class="detail-row">
													<span class="detail-label">Status:</span>
													<span class="detail-value">{job.status}</span>
												</div>
												<div class="detail-row">
													<span class="detail-label">Job ID:</span>
													<span class="detail-value detail-value--mono">{job.id}</span>
												</div>
												<div class="detail-actions">
													<button
														type="button"
														class="item-action-btn item-action-btn--primary"
														onclick={() => {
															if (job.status === 'paused') {
																void handleResumePausedJob(job);
																return;
															}
															void handleRetryJob(job);
														}}
														disabled={jobPending}
													>
														<RotateCcw size={12} />
														<span>{jobPending ? 'Resuming…' : job.status === 'paused' ? 'Resume' : 'Retry'}</span>
													</button>
													<button
														type="button"
														class="item-action-btn"
														onclick={() => {
															void handleCopyFailureReport(job);
														}}
														disabled={jobPending}
													>
														<ClipboardCopy size={12} />
														<span>{jobPending ? 'Copying…' : 'Report'}</span>
													</button>
													<button
														type="button"
														class="item-action-btn item-action-btn--danger"
														onclick={() => {
															void handleRemoveJob(job);
														}}
														disabled={jobPending}
													>
														<Trash2 size={12} />
														<span>{jobPending ? 'Removing…' : 'Dismiss'}</span>
													</button>
												</div>
											</div>
										{/if}
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
				{/if}
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

<style>
	.download-manager-container {
		--color-primary: #f5f5f5;
		--color-success: #e5e7eb;
		--color-warning: #d8d8d8;
		--color-error: #c9c9c9;
		--color-bg-primary: var(--mono-surface-card);
		--color-bg-secondary: #101010;
		--color-border: var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		--color-text-primary: rgba(245, 245, 245, 0.96);
		--color-text-secondary: rgba(163, 163, 163, 0.86);
		--dm-surface-0: #121212;
		--dm-surface-1: #171717;
		--dm-surface-2: #1d1d1d;
		--dm-border-strong: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		--dm-ok: rgba(212, 212, 212, 0.94);
		--dm-warn: rgba(225, 225, 225, 0.92);
		--dm-danger: rgba(205, 205, 205, 0.95);
		--dm-section-radius: var(--ui-radius-md, 12px);
		--dm-motion-fast: var(--ui-motion-fast, 140ms);
		--dm-motion-medium: var(--ui-motion-medium, 200ms);
		--dm-ease-standard: var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
		--dm-ease-emphasis: var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
		font-family: var(--ui-font-sans, 'Figtree', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
		font-size: 1rem;
		line-height: 1.45;
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
		transition:
			border-color var(--dm-motion-fast) var(--dm-ease-standard),
			background var(--dm-motion-fast) var(--dm-ease-standard),
			transform var(--dm-motion-fast) var(--dm-ease-emphasis);
	}

	.download-manager-toggle:hover {
		transform: translateY(var(--ui-lift-y, -1px));
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
	}

	.download-manager-toggle:active {
		transform: translateY(var(--ui-press-y, 0px));
	}

	.download-manager-badge {
		position: absolute;
		top: -8px;
		right: -8px;
		min-width: 26px;
		height: 26px;
		padding: 0 6px;
		border-radius: 13px;
		background: rgba(238, 238, 238, 0.9);
		color: #111111;
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
		max-height: none;
		animation: none;
		box-shadow: none;
		font-family: var(--ui-font-sans, 'Figtree', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
		font-size: 1.04rem;
		line-height: 1.46;
		letter-spacing: 0.01em;
	}

	.download-manager-panel--page .download-manager-header {
		padding: 1.08rem 1.1rem 1.02rem;
		border-bottom: 1px solid var(--color-border);
		background: #101010;
	}

	.download-manager-panel--page .download-manager-title {
		font-size: 1.16rem;
		letter-spacing: 0.012em;
	}

	.download-manager-panel--page .download-manager-subtitle-text {
		font-size: 0.9rem;
	}

	.download-manager-panel--page .download-manager-meta-row {
		margin-top: 0.52rem;
		gap: 0.52rem;
	}

	.download-manager-panel--page .download-manager-redis,
	.download-manager-panel--page .download-manager-last-updated,
	.download-manager-panel--page .download-manager-poll-status,
	.download-manager-panel--page .download-manager-meta-separator {
		font-size: 0.84rem;
	}

	.download-manager-panel--page .download-manager-error,
	.download-manager-panel--page .download-manager-warning,
	.download-manager-panel--page .download-manager-notice {
		margin: 0.88rem 1.05rem 0;
		border-radius: 10px;
		font-size: 0.82rem;
	}

	.download-manager-panel--page .download-status-hero {
		margin: 0.88rem 1.05rem 0;
		padding: 0.98rem 1rem;
		border-radius: var(--dm-section-radius);
		border: 1px solid var(--color-border);
		background: var(--dm-surface-0);
	}

	.download-manager-panel--page .download-status-hero[data-active='false'] {
		background: var(--dm-surface-0);
	}

	.download-manager-panel--page .download-status-hero__eyebrow {
		font-size: 0.74rem;
		letter-spacing: 0.12em;
	}

	.download-manager-panel--page .download-status-hero__main h4 {
		font-size: 1.15rem;
	}

	.download-manager-panel--page .download-status-hero__main p {
		font-size: 0.86rem;
	}

	.download-manager-panel--page .download-status-hero__meter-meta {
		font-size: 0.78rem;
	}

	.download-manager-panel--page .download-status-hero__meter-meta strong {
		font-size: 0.94rem;
	}

	.download-manager-panel--page .download-status-chip {
		border-color: var(--color-border);
		background: var(--dm-surface-1);
		color: rgba(235, 235, 235, 0.9);
		font-size: 0.74rem;
	}

	.download-manager-panel--page .download-status-chip[data-tone='ok'] {
		border-color: rgba(255, 255, 255, 0.32);
		background: var(--dm-surface-2);
		color: var(--dm-ok);
	}

	.download-manager-panel--page .download-status-chip[data-tone='warn'] {
		border-color: rgba(255, 255, 255, 0.28);
		background: rgba(255, 255, 255, 0.1);
		color: var(--dm-warn);
	}

	.download-manager-panel--page .poll-stale-chip {
		font-size: 0.68rem;
	}

	.download-manager-panel--page .download-manager-top-strip {
		margin: 0.88rem 1.05rem 0;
		padding: 0;
		border: 0;
		background: transparent;
		position: static;
		gap: 0.68rem;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
	}

	.download-manager-panel--page .top-strip-item {
		border-radius: var(--dm-section-radius);
		background: var(--dm-surface-0);
		border: 1px solid var(--color-border);
		padding: 0.74rem 0.76rem;
		gap: 0.4rem;
	}

	.download-manager-panel--page .top-strip-label {
		letter-spacing: 0.1em;
		font-size: 0.74rem;
	}

	.download-manager-panel--page .top-strip-value {
		font-size: 1.52rem;
	}

	.download-manager-panel--page .top-strip-value--text {
		font-size: 0.9rem;
	}

	.download-manager-panel--page .top-strip-item--running .top-strip-value,
	.download-manager-panel--page .top-strip-item--queued .top-strip-value,
	.download-manager-panel--page .top-strip-item--paused .top-strip-value {
		color: var(--dm-ok);
	}

	.download-manager-panel--page .top-strip-item--failed .top-strip-value {
		color: var(--dm-danger);
	}

	.download-manager-panel--page .download-manager-quick-actions {
		padding: 0;
		margin: 0.84rem 1.05rem 0;
		border: 0;
		background: transparent;
		gap: 0.5rem;
	}

	.download-manager-panel--page .control-btn {
		border-radius: var(--ui-radius-sm, 9px);
		padding: 0.58rem 0.84rem;
		font-size: 0.84rem;
		letter-spacing: 0.014em;
	}

	.download-manager-panel--page .control-btn--secondary {
		background: var(--dm-surface-0);
		border: 1px solid var(--color-border);
	}

	.download-manager-panel--page .download-manager-content {
		padding: 0.92rem 1.1rem 1.08rem;
		gap: 0.85rem;
		overflow-y: visible;
	}

	.download-manager-panel--page .section--priority {
		padding: 0.9rem 0 0;
		gap: 0.78rem;
	}

	.priority-overview-subtitle {
		margin: 0;
		font-size: 0.84rem;
		color: rgba(214, 214, 214, 0.78);
	}

	.priority-grid {
		display: grid;
		gap: 0.92rem;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
	}

	.priority-column {
		display: flex;
		flex-direction: column;
		gap: 0.54rem;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		border-radius: 0;
		background: transparent;
		padding: 0.6rem 0;
	}

	.priority-column__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.priority-column__title {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(236, 236, 236, 0.9);
	}

	.priority-list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.priority-item {
		display: flex;
		flex-direction: column;
		gap: 0.44rem;
		padding: 0.62rem 0;
		border-bottom: 1px solid var(--color-border);
		border-radius: 0;
		background: transparent;
	}

	.priority-item__main {
		display: flex;
		flex-direction: column;
		gap: 0.18rem;
		min-width: 0;
	}

	.priority-item__title {
		margin: 0;
		font-size: 0.86rem;
		font-weight: 600;
		color: rgba(242, 242, 242, 0.95);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.priority-item__meta {
		margin: 0;
		font-size: 0.84rem;
		color: rgba(192, 192, 192, 0.82);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.priority-empty {
		margin: 0;
		font-size: 0.88rem;
		color: rgba(188, 188, 188, 0.82);
	}

	.priority-overview-actions {
		display: flex;
		justify-content: flex-end;
	}

	.priority-bulk-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.48rem;
		padding-top: 0.2rem;
	}

	.priority-bulk-actions .control-btn {
		padding: 0.5rem 0.74rem;
		font-size: 0.88rem;
	}

	.priority-empty-state {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.7rem 0;
		border-top: 1px dashed var(--color-border);
		border-bottom: 1px dashed var(--color-border);
		border-radius: 0;
		background: transparent;
	}

	@media (max-width: 760px) {
		.priority-overview-actions,
		.priority-bulk-actions {
			justify-content: stretch;
		}

		.priority-bulk-actions .control-btn,
		.priority-overview-actions .control-btn {
			flex: 1 1 100%;
			justify-content: center;
		}
	}

	.priority-empty-state p {
		margin: 0;
		font-size: 0.88rem;
		color: rgba(196, 196, 196, 0.84);
	}

	.download-manager-panel--page .section {
		position: relative;
		padding: 0.86rem 0;
		border: 0;
		border-top: 1px solid var(--color-border);
		border-radius: 0;
		background: transparent;
		gap: 0.78rem;
		box-shadow: none;
	}

	.download-manager-panel--page .download-manager-content > .section:first-child {
		padding-top: 0;
		border-top: 0;
	}

	.download-manager-panel--page .current-section {
		border-top-color: var(--dm-border-strong);
	}

	.download-manager-panel--page .section-title {
		font-size: 0.95rem;
		letter-spacing: 0.08em;
	}

	.download-manager-panel--page .section-toggle {
		padding: 0.18rem 0.1rem;
		min-height: 44px;
		cursor: default;
	}

	.download-manager-panel--page .section-toggle:hover {
		background: transparent;
	}

	.download-manager-panel--page .section-count {
		background: transparent;
		border: 1px solid var(--color-border);
		padding: 0.24rem 0.58rem;
		font-size: 0.84rem;
	}

	.download-manager-panel--page .current-items,
	.download-manager-panel--page .queue-list,
	.download-manager-panel--page .completed-list,
	.download-manager-panel--page .failed-list {
		gap: 0;
		border-top: 1px solid var(--color-border);
	}

	.download-manager-panel--page .current-item,
	.download-manager-panel--page .queue-item-card,
	.download-manager-panel--page .completed-item,
	.download-manager-panel--page .failed-item-card,
	.download-manager-panel--page .completion-summary,
	.download-manager-panel--page .queue-more-hint {
		border-radius: 0;
		border: 0;
		border-bottom: 1px solid var(--color-border);
		background: transparent;
	}

	.download-manager-panel--page .section-filter-row {
		padding: 0.66rem 0;
		border: 0;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		border-radius: 0;
		background: transparent;
	}

	.download-manager-panel--page .section-filter-label {
		font-size: 0.84rem;
	}

	.download-manager-panel--page .filter-pill {
		font-size: 0.92rem;
		padding: 0.44rem 0.72rem;
	}

	.download-manager-panel--page .queue-list,
	.download-manager-panel--page .failed-list {
		max-height: none;
	}

	.download-manager-panel--page .completed-list {
		gap: 0;
	}

	.download-manager-panel--page .queue-item-click,
	.download-manager-panel--page .failed-item-click {
		padding: 0.88rem 0;
		cursor: default;
	}

	.download-manager-panel--page .queue-item-click:hover,
	.download-manager-panel--page .failed-item-click:hover {
		background: transparent;
		transform: none;
	}

	.download-manager-panel--page .queue-item-title,
	.download-manager-panel--page .failed-item-title,
	.download-manager-panel--page .completed-item-title,
	.download-manager-panel--page .current-item-title {
		font-size: 1.02rem;
	}

	.download-manager-panel--page .queue-item-artist,
	.download-manager-panel--page .failed-item-artist,
	.download-manager-panel--page .completed-item-meta,
	.download-manager-panel--page .current-item-meta {
		font-size: 0.92rem;
	}

	.download-manager-panel--page .detail-row {
		font-size: 0.9rem;
	}

	.download-manager-panel--page .queue-item-details,
	.download-manager-panel--page .failed-item-details,
	.download-manager-panel--page .detail-actions {
		border-top-style: dashed;
	}

	.download-manager-panel--page .detail-value--mono {
		font-size: 0.84rem;
	}

	.download-manager-panel--page .item-action-btn {
		border-radius: var(--ui-radius-sm, 9px);
		padding: 0.3rem 0.52rem;
		font-size: 0.76rem;
	}

	.download-manager-panel--page .download-manager-empty {
		padding: 2rem 1rem;
		min-height: 0;
		border-radius: var(--dm-section-radius);
		border: 1px dashed var(--color-border);
		background: var(--dm-surface-0);
	}

	.download-manager-panel--page .download-manager-footer {
		padding: 0.76rem 1.05rem 1rem;
		border-top: 1px solid var(--color-border);
		position: static;
		background: transparent;
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
		padding: 1rem;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
		gap: 0.75rem;
	}

	.download-manager-title {
		margin: 0;
		font-size: 1.08rem;
		font-weight: 700;
		color: var(--color-text-primary);
		letter-spacing: 0.02em;
	}

	.download-manager-subtitle-text {
		margin: 0.26rem 0 0 0;
		font-size: 0.9rem;
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
		font-size: 0.82rem;
		color: var(--color-text-secondary);
		opacity: 0.7;
	}

	.download-manager-last-updated {
		font-size: 0.82rem;
		color: var(--color-text-secondary);
	}

	.download-manager-poll-status {
		font-size: 0.82rem;
		color: var(--color-text-secondary);
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.download-manager-poll-status[data-stale='true'] {
		color: rgba(224, 224, 224, 0.92);
	}

	.poll-stale-chip {
		font-size: 11px;
		line-height: 1;
		padding: 4px 6px;
		border-radius: 999px;
		letter-spacing: 0.3px;
		font-weight: 700;
		color: rgba(245, 245, 245, 0.94);
		background: rgba(255, 255, 255, 0.2);
		border: 1px solid rgba(255, 255, 255, 0.36);
	}

	.download-manager-compact-indicator {
		font-size: 0.82rem;
		color: #d4d4d4;
	}

	.download-manager-redis {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.82rem;
		color: var(--color-text-secondary);
	}

	.download-manager-redis-dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: #a8a8a8;
		display: inline-block;
	}

	.download-manager-redis[data-state='ok'] .download-manager-redis-dot {
		background: #f1f1f1;
	}

	.download-manager-redis[data-state='warn'] .download-manager-redis-dot {
		background: #d8d8d8;
	}

	.download-manager-redis[data-state='unknown'] .download-manager-redis-dot {
		background: #7a7a7a;
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
		border-radius: var(--ui-radius-sm, 9px);
		color: var(--color-text-secondary);
		transition:
			background var(--dm-motion-fast) var(--dm-ease-standard),
			color var(--dm-motion-fast) var(--dm-ease-standard),
			transform var(--dm-motion-fast) var(--dm-ease-emphasis);
		flex-shrink: 0;
	}

	.download-manager-close:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.download-manager-close:active {
		transform: translateY(var(--ui-press-y, 0px));
	}

	.download-manager-error {
		margin: 0 16px 12px;
		padding: 10px 12px;
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(255, 255, 255, 0.2);
		background: rgba(255, 255, 255, 0.08);
		color: rgba(220, 220, 220, 0.92);
		font-size: 12px;
		line-height: 1.4;
	}

	.download-manager-warning {
		margin: 0 16px 12px;
		padding: 10px 12px;
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(255, 255, 255, 0.06);
		color: rgba(214, 214, 214, 0.9);
		font-size: 12px;
		line-height: 1.4;
	}

	.download-manager-notice {
		margin: 0 16px 12px;
		padding: 10px 12px;
		border-radius: var(--ui-radius-sm, 9px);
		font-size: 12px;
		line-height: 1.4;
		border: 1px solid var(--color-border);
	}

	.download-manager-notice[data-tone='success'] {
		background: rgba(255, 255, 255, 0.12);
		color: rgba(236, 236, 236, 0.94);
		border-color: rgba(255, 255, 255, 0.3);
	}

	.download-manager-notice[data-tone='error'] {
		background: rgba(255, 255, 255, 0.1);
		color: rgba(214, 214, 214, 0.9);
		border-color: rgba(255, 255, 255, 0.24);
	}

	.download-manager-notice[data-tone='info'] {
		background: rgba(245, 245, 245, 0.12);
		color: #f5f5f5;
		border-color: rgba(245, 245, 245, 0.28);
	}

	.download-status-hero {
		margin: 0 16px 12px;
		padding: 12px;
		border-radius: var(--dm-section-radius);
		border: 1px solid rgba(255, 255, 255, 0.2);
		background: var(--dm-surface-0);
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
		color: rgba(220, 220, 220, 0.8);
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
		color: rgba(220, 220, 220, 0.8);
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
		border: 1px solid rgba(255, 255, 255, 0.16);
	}

	.download-status-hero__meter-fill {
		height: 100%;
		background: rgba(255, 255, 255, 0.92);
		transition: width var(--ui-motion-medium, 200ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	.download-status-hero__meter-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 11px;
		color: rgba(220, 220, 220, 0.86);
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
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: rgba(20, 20, 20, 0.45);
		color: rgba(220, 220, 220, 0.88);
	}

	.download-status-chip[data-tone='ok'] {
		border-color: rgba(255, 255, 255, 0.34);
		background: rgba(255, 255, 255, 0.16);
		color: rgba(242, 242, 242, 0.95);
	}

	.download-status-chip[data-tone='warn'] {
		border-color: rgba(255, 255, 255, 0.28);
		background: rgba(255, 255, 255, 0.12);
		color: rgba(224, 224, 224, 0.9);
	}

	.download-manager-top-strip {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 8px;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		padding: 12px 16px;
		background: #101010;
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
		background: #101010;
	}

	.top-strip-item {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px;
		border-radius: var(--ui-radius-sm, 9px);
		background: var(--dm-surface-0);
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
		color: rgba(228, 228, 228, 0.94);
	}

	.top-strip-item--paused .top-strip-value {
		color: rgba(216, 216, 216, 0.9);
	}

	.top-strip-item--failed .top-strip-value {
		color: rgba(206, 206, 206, 0.9);
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
		border: 1px solid rgba(255, 255, 255, 0.24);
		background: var(--dm-surface-0);
		padding: 12px;
		border-radius: var(--dm-section-radius);
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
		border-radius: var(--ui-radius-sm, 9px);
		padding: 4px 6px;
		box-sizing: border-box;
		min-height: 40px;
		transition:
			background var(--dm-motion-fast) var(--dm-ease-standard),
			transform var(--dm-motion-fast) var(--dm-ease-emphasis);
	}

	.section-toggle:hover {
		background: rgba(255, 255, 255, 0.04);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.section-toggle:active {
		transform: translateY(var(--ui-press-y, 0px));
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
		background: var(--dm-surface-1);
		padding: 3px 8px;
		border-radius: var(--ui-radius-sm, 9px);
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
	}

	/* Current items */
	.current-items {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.current-item {
		background: var(--dm-surface-0);
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-radius: var(--ui-radius-sm, 9px);
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
		border-radius: 999px;
		font-size: 10px;
		font-weight: 700;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.badge-processing {
		background: rgba(255, 255, 255, 0.16);
		color: rgba(242, 242, 242, 0.95);
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
		background: rgba(255, 255, 255, 0.18);
		border-radius: 999px;
		overflow: hidden;
		margin-top: 4px;
	}

	.progress-fill {
		height: 100%;
		background: rgba(255, 255, 255, 0.92);
		transition: width var(--ui-motion-medium, 200ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
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
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
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
		padding: 6px 12px;
		border-radius: var(--ui-radius-sm, 9px);
		font-size: 13px;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.02);
		min-height: 36px;
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
		border-radius: var(--ui-radius-sm, 9px);
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
		gap: 10px;
		max-height: 300px;
		overflow-y: auto;
	}

	.queue-item-card {
		background: var(--dm-surface-0);
		border: 1px solid var(--color-border);
		border-radius: var(--ui-radius-sm, 9px);
		overflow: hidden;
	}

	.queue-item-click,
	.failed-item-click {
		cursor: pointer;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		transition:
			background var(--dm-motion-fast) var(--dm-ease-standard),
			transform var(--dm-motion-fast) var(--dm-ease-emphasis);
		background: none;
		border: none;
		text-align: left;
		width: 100%;
		color: inherit;
		min-height: 52px;
	}

	.queue-item-click:hover,
	.failed-item-click:hover {
		background: rgba(255, 255, 255, 0.08);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.queue-item-click:active,
	.failed-item-click:active {
		transform: translateY(var(--ui-press-y, 0px));
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
		gap: 4px;
	}

	.queue-item-title {
		font-weight: 600;
		font-size: 15px;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.queue-item-artist {
		font-size: 13px;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.queue-item-album {
		font-size: 12px;
		color: var(--color-text-secondary);
		opacity: 0.8;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.queue-item-summary,
	.failed-item-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.meta-album-progress {
		font-weight: 600;
		color: rgba(234, 234, 234, 0.94);
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
		font-size: 13px;
	}

	.detail-label {
		color: var(--color-text-secondary);
		font-weight: 600;
		min-width: 88px;
	}

	.detail-value {
		color: var(--color-text-primary);
		text-align: right;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.detail-value--mono {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
		font-size: 0.82rem;
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
		font-size: 12px;
		color: var(--color-text-secondary);
		background: rgba(255, 255, 255, 0.02);
		border-top: 1px solid var(--color-border);
	}

	/* Completion summary */
	.completion-summary {
		background: var(--dm-surface-0);
		border: 1px solid var(--color-border);
		border-radius: var(--ui-radius-sm, 9px);
		padding: 10px;
		font-size: 13px;
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
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid var(--color-border);
		background: var(--dm-surface-0);
	}

	.completed-item-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.completed-item-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.completed-item-meta {
		margin-top: 4px;
		font-size: 12px;
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
		background: var(--dm-surface-0);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: var(--ui-radius-sm, 9px);
		overflow: hidden;
	}

	.failed-item-click {
		cursor: pointer;
		padding: 10px;
		transition:
			background var(--dm-motion-fast) var(--dm-ease-standard),
			transform var(--dm-motion-fast) var(--dm-ease-emphasis);
	}

	.failed-item-click:hover {
		background: rgba(255, 255, 255, 0.12);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.failed-item-click:active {
		transform: translateY(var(--ui-press-y, 0px));
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
		font-size: 14px;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-bottom: 2px;
	}

	.failed-item-artist {
		font-size: 12px;
		color: var(--color-text-secondary);
		margin-bottom: 3px;
	}

	.failed-item-error-text {
		font-size: 12px;
		color: rgba(208, 208, 208, 0.9);
		white-space: normal;
		word-break: break-word;
		line-height: 1.3;
	}

	.failed-item-details {
		padding-top: 8px;
		border-top: 1px solid rgba(255, 255, 255, 0.16);
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
		border-radius: var(--ui-radius-sm, 9px);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
		transition:
			border-color var(--dm-motion-fast) var(--dm-ease-standard),
			background var(--dm-motion-fast) var(--dm-ease-standard),
			color var(--dm-motion-fast) var(--dm-ease-standard),
			transform var(--dm-motion-fast) var(--dm-ease-emphasis);
		white-space: nowrap;
		border: 1px solid transparent;
		min-height: 42px;
		box-sizing: border-box;
	}

	.item-action-btn {
		all: unset;
		cursor: pointer;
		padding: 6px 10px;
		border-radius: var(--ui-radius-sm, 9px);
		font-size: 12px;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--color-border);
		color: var(--color-text-primary);
		background: rgba(255, 255, 255, 0.04);
		min-height: 32px;
		box-sizing: border-box;
		transition:
			border-color var(--dm-motion-fast) var(--dm-ease-standard),
			background var(--dm-motion-fast) var(--dm-ease-standard),
			transform var(--dm-motion-fast) var(--dm-ease-emphasis);
	}

	.item-action-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		transform: translateY(-1px);
	}

	.item-action-btn:active {
		transform: translateY(0);
	}

	.item-action-btn:disabled {
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
		border-color: rgba(255, 255, 255, 0.3);
		color: rgba(224, 224, 224, 0.9);
		background: rgba(255, 255, 255, 0.1);
	}

	.item-action-btn--danger {
		border-color: rgba(255, 255, 255, 0.24);
		color: rgba(210, 210, 210, 0.9);
		background: rgba(255, 255, 255, 0.08);
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
		background: rgba(255, 255, 255, 0.14);
		color: rgba(224, 224, 224, 0.9);
		border-color: rgba(255, 255, 255, 0.26);
	}

	.control-btn--warning:hover {
		background: rgba(255, 255, 255, 0.2);
	}

	.control-btn--secondary:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.control-btn--danger {
		background: rgba(255, 255, 255, 0.08);
		color: rgba(210, 210, 210, 0.9);
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	.control-btn--danger:hover {
		background: rgba(255, 255, 255, 0.14);
	}

	.control-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.control-btn:hover:not(:disabled) {
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.control-btn:active:not(:disabled) {
		transform: translateY(var(--ui-press-y, 0px));
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
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(245, 245, 245, 0.45);
		background: rgba(245, 245, 245, 0.14);
		color: #f5f5f5;
		font-size: 12px;
		font-weight: 600;
		text-decoration: none;
		transition:
			background var(--dm-motion-fast) var(--dm-ease-standard),
			transform var(--dm-motion-fast) var(--dm-ease-emphasis);
	}

	.empty-cta-btn:hover {
		background: rgba(245, 245, 245, 0.24);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.empty-cta-btn:active {
		transform: translateY(var(--ui-press-y, 0px));
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
		background: #101010;
		position: sticky;
		bottom: 0;
		z-index: 2;
		backdrop-filter: none;
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

	@media (prefers-reduced-motion: reduce) {
		.download-manager-panel {
			animation: none;
		}

		.rotating {
			animation: none;
		}

		.download-status-hero__meter-fill,
		.progress-fill,
		.section-toggle,
		.queue-item-click,
		.failed-item-click,
		.control-btn,
		.item-action-btn,
		.empty-cta-btn {
			transition: none;
		}

		.download-manager-toggle,
		.download-manager-close,
		.section-toggle,
		.queue-item-click,
		.failed-item-click,
		.control-btn,
		.item-action-btn,
		.empty-cta-btn {
			transform: none !important;
		}
	}

	.download-manager-panel--page {
		left: auto;
		right: auto;
		width: 100%;
		max-height: none;
	}
</style>
