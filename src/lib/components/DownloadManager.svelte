<script lang="ts">
	import { serverQueue, queueStats, workerStatus } from '$lib/stores/serverQueue.svelte';
	import {
		Trash2,
		RefreshCw,
		ChevronDown,
		ChevronUp,
		RotateCcw,
		Square,
		ClipboardCopy
	} from 'lucide-svelte';

	interface QueueJob {
		id: string;
		status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
		job: {
			type: 'track' | 'album';
			trackId?: number;
			trackTitle?: string;
			artistName?: string;
			albumTitle?: string;
			albumId?: number;
			quality?: string;
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

	// Use server queue data
	let stats = $derived.by(() => {
		const serverStats = $queueStats;
		return {
			running: $workerStatus.activeDownloads,
			queued: serverStats.queued,
			completed: serverStats.completed,
			failed: serverStats.failed,
			total: serverStats.total
		};
	});

	let totalItems = $derived(stats.total);
	let hasActivity = $derived(totalItems > 0);
	let workerWarning = $derived(!$workerStatus.running && (stats.running > 0 || stats.queued > 0));
	const matchesTypeFilter = (job: QueueJob, filter: JobTypeFilter): boolean => {
		if (filter === 'all') return true;
		return filter === 'albums' ? job.job.type === 'album' : job.job.type === 'track';
	};
	let processingJobs = $derived(queueJobs.filter(j => j.status === 'processing'));
	let queuedJobs = $derived(queueJobs.filter(j => j.status === 'queued'));
	let completedJobs = $derived(queueJobs.filter(j => j.status === 'completed'));
	let failedJobs = $derived(queueJobs.filter(j => j.status === 'failed'));
	let cancelledJobs = $derived(queueJobs.filter(j => j.status === 'cancelled'));
	let stoppableJobs = $derived(queueJobs.filter(j => j.status === 'processing' || j.status === 'queued'));
	let resumableJobs = $derived(
		queueJobs.filter(j => j.status === 'failed' || j.status === 'cancelled')
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
	let canResumeAny = $derived(resumableJobs.length > 0);
	let hasFailuresToReport = $derived(failedJobs.length > 0 || cancelledJobs.length > 0);
	const actionKeys = {
		refresh: 'refresh',
		bulkStop: 'bulk-stop',
		bulkResume: 'bulk-resume',
		bulkReport: 'bulk-report',
		clearHistory: 'clear-history'
	} as const;

	const cancelActionKey = (jobId: string): string => `job:${jobId}:cancel`;
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

	function summarizeJob(job: QueueJob): string {
		const title = job.job.trackTitle || job.job.albumTitle || 'Unknown';
		const artist = job.job.artistName ? ` by ${job.job.artistName}` : '';
		return `${title}${artist}`;
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
		action: 'cancel' | 'retry'
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

	// Start polling when component mounts
	$effect(() => {
		serverQueue.startPolling(500);
		return () => serverQueue.stopPolling();
	});

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
		if (!isOpen) return;
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
					failed: 2,
					cancelled: 3,
					completed: 4
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
			}
		} catch (err) {
			console.error('Failed to fetch queue jobs:', err);
		}
	};

	// Auto-refresh jobs while the panel is open
	$effect(() => {
		if (isOpen) {
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
				await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
				return;
			}
			setActionNotice('error', result.error ?? `Failed to stop ${summarizeJob(job)}`);
		});
	};

	const handleRetryJob = async (job: QueueJob) => {
		const key = retryActionKey(job.id);
		await runWithPendingAction(key, async () => {
			const result = await runJobAction(job.id, 'retry');
			if (result.success) {
				setActionNotice('success', `Resumed ${summarizeJob(job)}`);
				await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
				return;
			}
			setActionNotice('error', result.error ?? `Failed to resume ${summarizeJob(job)}`);
		});
	};

	const handleRemoveJob = async (job: QueueJob) => {
		const key = deleteActionKey(job.id);
		await runWithPendingAction(key, async () => {
			const result = await deleteQueueJob(job.id);
			if (result.success) {
				setActionNotice('success', `Removed ${summarizeJob(job)}`);
				await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
				return;
			}
			setActionNotice('error', result.error ?? `Failed to remove ${summarizeJob(job)}`);
		});
	};

	const handleStopAllActive = async () => {
		if (stoppableJobs.length === 0) {
			setActionNotice('info', 'No active or queued downloads to stop.');
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
			await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
		});
	};

	const handleResumeAll = async () => {
		if (resumableJobs.length === 0) {
			setActionNotice('info', 'No failed or cancelled downloads to resume.');
			return;
		}
		await runWithPendingAction(actionKeys.bulkResume, async () => {
			const results = await Promise.all(resumableJobs.map((job) => runJobAction(job.id, 'retry')));
			const succeeded = results.filter((result) => result.success).length;
			const failed = results.length - succeeded;
			setActionNotice(
				failed > 0 ? 'error' : 'success',
				failed > 0
					? `Resumed ${succeeded} job(s), ${failed} failed.`
					: `Resumed ${succeeded} failed/cancelled job(s).`
			);
			await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
		});
	};

	const handleCopyFailureReport = async (job?: QueueJob) => {
		const reportJobs = job ? [job] : resumableJobs;
		if (reportJobs.length === 0) {
			setActionNotice('info', 'No failure details available to report.');
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
			} catch (error) {
				setActionNotice(
					'error',
					error instanceof Error ? error.message : 'Failed to copy failure report'
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
			await Promise.all([serverQueue.poll(), fetchQueueJobs()]);
		});
	};

	const handleManualRefresh = async () => {
		await runWithPendingAction(actionKeys.refresh, async () => {
			await serverQueue.poll();
			await fetchQueueJobs();
		});
	};
</script>

<div class="download-manager-container">
	<button
		onclick={() => (isOpen = !isOpen)}
		type="button"
		class="download-manager-toggle"
		class:has-activity={hasActivity}
		title={isOpen ? 'Hide download manager' : 'Show download manager'}
	>
		{#if hasActivity}
			<div class="download-manager-badge">
				{totalItems}
			</div>
		{/if}
		<span class="download-manager-icon">⬇</span>
	</button>

	{#if isOpen}
		<div class="download-manager-panel" class:compact-mode={isCompactViewport}>
			<div class="download-manager-header">
				<div>
					<h3 class="download-manager-title">Download Manager</h3>
					<p class="download-manager-subtitle-text">
						Live server queue status for tracks and albums
					</p>
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
				<button
					onclick={() => (isOpen = false)}
					class="download-manager-close"
					type="button"
					aria-label="Close"
				>
					✕
				</button>
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

			{#if $serverQueue.queueSource === 'memory'}
				<div class="download-manager-warning">
					Redis unavailable; using in-memory queue. UI may be stale if the worker runs in another process.
				</div>
			{/if}

			{#if actionNotice}
				<div class="download-manager-notice" data-tone={actionNotice.tone}>
					{actionNotice.message}
				</div>
			{/if}

			<div class="download-manager-top-strip">
				<div class="top-strip-item top-strip-item--running">
					<span class="top-strip-label">Running</span>
					<span class="top-strip-value">{stats.running}</span>
				</div>
				<div class="top-strip-item top-strip-item--queued">
					<span class="top-strip-label">Queued</span>
					<span class="top-strip-value">{stats.queued}</span>
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
					<span>{isActionPending(actionKeys.bulkResume) ? 'Resuming…' : 'Resume Failed'}</span>
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
														{job.status === 'cancelled' ? 'Cancelled by user' : job.error || 'Unknown error'}
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
																void handleRetryJob(job);
															}}
															onkeydown={(event) => {
																if (jobPending) return;
																if (event.key === 'Enter' || event.key === ' ') {
																	event.preventDefault();
																	event.stopPropagation();
																	void handleRetryJob(job);
																}
															}}
															aria-disabled={jobPending}
														>
															<RotateCcw size={12} />
															<span>{jobPending ? 'Resuming…' : 'Resume'}</span>
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
		--color-primary: #3b82f6;
		--color-success: #10b981;
		--color-warning: #f59e0b;
		--color-error: #ef4444;
		--color-bg-primary: rgba(11, 16, 26, 0.98);
		--color-bg-secondary: rgba(255, 255, 255, 0.05);
		--color-border: rgba(255, 255, 255, 0.1);
		--color-text-primary: #e2e8f0;
		--color-text-secondary: #a1a5b5;
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
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--color-primary);
		color: white;
		font-size: 24px;
		box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
		transition: all 0.3s ease;
	}

	.download-manager-toggle:hover {
		transform: scale(1.1);
		box-shadow: 0 6px 24px rgba(59, 130, 246, 0.5);
	}

	.download-manager-badge {
		position: absolute;
		top: -8px;
		right: -8px;
		min-width: 26px;
		height: 26px;
		padding: 0 6px;
		border-radius: 13px;
		background: var(--color-error);
		color: white;
		font-size: 11px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--color-bg-primary);
	}

	.download-manager-panel {
		position: fixed;
		bottom: calc(20px + var(--player-height, 0px) + 80px + env(safe-area-inset-bottom, 0px));
		right: 20px;
		z-index: 99998;
		width: 680px;
		max-height: 80vh;
		max-height: 80dvh;
		border-radius: 12px;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border);
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
		animation: slideUp 0.3s ease;
		display: flex;
		flex-direction: column;
		overflow: hidden;
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
		color: #bfdbfe;
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
		background: rgba(59, 130, 246, 0.16);
		color: #dbeafe;
		border-color: rgba(59, 130, 246, 0.4);
	}

	.download-manager-top-strip {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 8px;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		padding: 12px 16px;
		background: rgba(255, 255, 255, 0.02);
		flex-shrink: 0;
	}

	.download-manager-quick-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.02);
	}

	.top-strip-item {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
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
		font-size: 22px;
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
		color: #10b981;
	}

	.top-strip-item--queued .top-strip-value {
		color: #f59e0b;
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
		border: 1px solid rgba(16, 185, 129, 0.2);
		background: rgba(16, 185, 129, 0.05);
		padding: 12px;
		border-radius: 8px;
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
		background: rgba(59, 130, 246, 0.1);
		border: 1px solid rgba(59, 130, 246, 0.3);
		border-radius: 8px;
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
		height: 4px;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 2px;
		overflow: hidden;
		margin-top: 4px;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #10b981, #06b6d4);
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
		background: rgba(59, 130, 246, 0.2);
		border-color: rgba(59, 130, 246, 0.4);
		color: #bfdbfe;
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
		background: rgba(6, 182, 212, 0.05);
		border: 1px solid rgba(6, 182, 212, 0.2);
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
		border: 1px solid rgba(6, 182, 212, 0.18);
		background: rgba(6, 182, 212, 0.05);
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
		border-color: rgba(59, 130, 246, 0.5);
		color: #bfdbfe;
		background: rgba(59, 130, 246, 0.14);
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
		background: rgba(59, 130, 246, 0.2);
		color: #dbeafe;
		border-color: rgba(59, 130, 246, 0.5);
	}

	.control-btn--primary:hover {
		background: rgba(59, 130, 246, 0.3);
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
		border: 1px solid rgba(59, 130, 246, 0.4);
		background: rgba(59, 130, 246, 0.14);
		color: #bfdbfe;
		font-size: 12px;
		font-weight: 600;
		text-decoration: none;
		transition: all 0.2s;
	}

	.empty-cta-btn:hover {
		background: rgba(59, 130, 246, 0.24);
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
</style>
