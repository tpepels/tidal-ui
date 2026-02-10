<script lang="ts">
	import { serverQueue, queueStats, workerStatus, totalDownloads } from '$lib/stores/serverQueue.svelte';
	import { Trash2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-svelte';

	interface QueueJob {
		id: string;
		status: 'queued' | 'processing' | 'completed' | 'failed';
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
		error?: string;
		trackCount?: number; // For albums
		completedTracks?: number; // For albums
	}

	let isOpen = $state(false);
	let isLoading = $state(false);
	let queueJobs = $state<QueueJob[]>([]);
	let expandedJobId = $state<string | null>(null);

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

	let totalItems = $derived($totalDownloads + stats.failed);
	let hasActivity = $derived(totalItems > 0);

	// Start polling when component mounts
	$effect(() => {
		serverQueue.startPolling(500);
		return () => serverQueue.stopPolling();
	});

	// Fetch queue jobs details
	const fetchQueueJobs = async () => {
		try {
			const response = await fetch('/api/download-queue');
			if (!response.ok) throw new Error('Failed to fetch jobs');
			
			const data = await response.json() as { success: boolean; jobs: QueueJob[] };
			if (data.success) {
				queueJobs = data.jobs;
			}
		} catch (err) {
			console.error('Failed to fetch queue jobs:', err);
		}
	};

	// Auto-refresh jobs when panel opens or stats change
	$effect(() => {
		if (isOpen) {
			fetchQueueJobs();
		}
	});

	$effect(() => {
		if (isOpen && stats.running > 0) {
			const interval = setInterval(fetchQueueJobs, 1000);
			return () => clearInterval(interval);
		}
	});

	const handleClearFailed = async () => {
		if (confirm('Clear all failed downloads?')) {
			isLoading = true;
			try {
				// Fetch all jobs
				const response = await fetch('/api/download-queue');
				if (!response.ok) throw new Error('Failed to fetch jobs');
				
				const data = await response.json() as { success: boolean; jobs: Array<{ id: string; status: string }> };
				if (!data.success) throw new Error('Failed to get jobs');
				
				// Filter for failed jobs and delete them
				const failedJobs = data.jobs.filter(j => j.status === 'failed');
				await Promise.all(
					failedJobs.map(j => 
						fetch(`/api/download-queue/${j.id}`, { method: 'DELETE' })
					)
				);
				
				// Refresh stats
				await serverQueue.poll();
			} catch (err) {
				console.error('Failed to clear failed jobs:', err);
			} finally {
				isLoading = false;
			}
		}
	};

	const handleManualRefresh = async () => {
		isLoading = true;
		try {
			await serverQueue.poll();
			await fetchQueueJobs();
		} finally {
			isLoading = false;
		}
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
		<div class="download-manager-panel">
			<div class="download-manager-header">
				<div>
					<h3 class="download-manager-title">Download Manager</h3>
					<p class="download-manager-subtitle-text">{stats.running} downloading • {stats.queued} queued</p>
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

			<!-- Stats bar -->
			<div class="download-manager-stats-bar">
				<div class="stat-item stat-running">
					<span class="stat-number">{stats.running}</span>
					<span class="stat-label">Running</span>
				</div>
				<div class="stat-item stat-queued">
					<span class="stat-number">{stats.queued}</span>
					<span class="stat-label">Queued</span>
				</div>
				<div class="stat-item stat-completed">
					<span class="stat-number">{stats.completed}</span>
					<span class="stat-label">Completed</span>
				</div>
				<div class="stat-item stat-failed">
					<span class="stat-number">{stats.failed}</span>
					<span class="stat-label">Failed</span>
				</div>
			</div>

			<div class="download-manager-content">
				<!-- Current/Active Downloads -->
				{#if stats.running > 0}
					<div class="section current-section">
						<h4 class="section-title">
							<span class="section-title-icon rotating"><RefreshCw size={14} strokeWidth={2} /></span>
							<span>Currently Downloading</span>
							<span class="section-count">{stats.running}</span>
						</h4>
						<div class="current-items">
							{#each queueJobs.filter(j => j.status === 'processing') as job (job.id)}
								<div class="current-item">
									<div class="current-item-header">
										<div class="current-item-title">
											{job.job.type === 'track' ? job.job.trackTitle : job.job.albumTitle || 'Unknown Album'}
										</div>
										<span class="badge badge-processing">PROCESSING</span>
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
					</div>
				{/if}

				<!-- Queued items -->
				{#if stats.queued > 0}
					<div class="section">
						<h4 class="section-title">
							<span>📋 Queue</span>
							<span class="section-count">{stats.queued}</span>
						</h4>
						<div class="queue-list">
							{#each queueJobs.filter(j => j.status === 'queued').slice(0, 5) as job (job.id)}
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
											</div>
										{/if}
									</button>
								</div>
							{/each}

							{#if stats.queued > 5}
								<div class="queue-more-hint">
									+{stats.queued - 5} more in queue
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Completed -->
				{#if stats.completed > 0}
					<div class="section">
						<h4 class="section-title">
							<span>✓ Completed</span>
							<span class="section-count">{stats.completed}</span>
						</h4>
						<div class="completion-summary">
							<p>{stats.completed} file{stats.completed !== 1 ? 's' : ''} successfully downloaded</p>
						</div>
					</div>
				{/if}

				<!-- Failed -->
				{#if stats.failed > 0}
					<div class="section">
						<h4 class="section-title error-title">
							<span>⚠️ Failed ({stats.failed})</span>
						</h4>
						<div class="failed-list">
							{#each queueJobs.filter(j => j.status === 'failed').slice(0, 3) as job (job.id)}
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
												<div class="failed-item-error-text">{job.error || 'Unknown error'}</div>
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
													<span class="detail-label">Type:</span>
													<span class="detail-value">{job.job.type === 'track' ? 'Single Track' : 'Album'}</span>
												</div>
												<div class="detail-row">
													<span class="detail-label">Artist:</span>
													<span class="detail-value">{job.job.artistName || 'Unknown'}</span>
												</div>
											</div>
										{/if}
									</button>
								</div>
							{/each}

							{#if stats.failed > 3}
								<div class="queue-more-hint">
									+{stats.failed - 3} more failed items
								</div>
							{/if}
						</div>
						<div class="failed-actions">
							<button
								onclick={handleClearFailed}
								class="control-btn control-btn--danger"
								type="button"
								title="Clear failed downloads"
								disabled={isLoading}
							>
								<Trash2 size={14} />
								<span>Clear Failed</span>
							</button>
						</div>
					</div>
				{/if}

				<!-- Empty state -->
				{#if stats.running === 0 && stats.queued === 0 && stats.completed === 0 && stats.failed === 0}
					<div class="download-manager-empty">
						<p class="empty-message">No downloads yet</p>
						<p class="empty-hint">Start downloading tracks or albums to see them here</p>
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
					disabled={isLoading}
				>
					<span class:rotating={isLoading}>
						<RefreshCw size={14} />
					</span>
					<span>Refresh</span>
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
		width: 600px;
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

	/* Stats bar */
	.download-manager-stats-bar {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1px;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		padding: 0;
		background: var(--color-border);
		flex-shrink: 0;
	}

	.stat-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 12px 8px;
		background: var(--color-bg-primary);
		text-align: center;
		gap: 4px;
	}

	.stat-number {
		font-size: 18px;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.stat-label {
		font-size: 10px;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.3px;
		font-weight: 600;
	}

	.stat-running .stat-number {
		color: #10b981;
	}

	.stat-queued .stat-number {
		color: #f59e0b;
	}

	.stat-completed .stat-number {
		color: #06b6d4;
	}

	.stat-failed .stat-number {
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
		font-size: 12px;
		font-weight: 700;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
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
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 11px;
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
		padding: 10px;
		transition: background 0.2s;
		background: none;
		border: none;
		text-align: left;
		width: 100%;
		color: inherit;
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
	}

	.control-btn--secondary {
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
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

	/* Footer */
	.download-manager-footer {
		padding: 12px 16px;
		border-top: 1px solid var(--color-border);
		display: flex;
		gap: 8px;
		flex-shrink: 0;
		background: var(--color-bg-secondary);
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
	@media (max-width: 900px) {
		.download-manager-panel {
			width: calc(100vw - 40px);
			max-height: 70vh;
		}
	}

	@media (max-width: 640px) {
		.download-manager-panel {
			width: calc(100vw - 30px);
			right: 15px;
			max-height: 60vh;
		}

		.download-manager-stats-bar {
			grid-template-columns: repeat(2, 1fr);
		}

		.control-btn span {
			display: none;
		}

		.control-btn {
			padding: 8px;
		}
	}
</style>
