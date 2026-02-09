<script lang="ts">
	import { downloadOrchestrator } from '$lib/orchestrators';
	import { Play, Pause, Square, RotateCcw, AlertCircle, Trash2, RotateCw } from 'lucide-svelte';

	let isOpen = $state(false);
	let queueStatus = $state(downloadOrchestrator.getQueueStatus());
	let failedDownloads = $state(downloadOrchestrator.getFailedDownloads());

	$effect(() => {
		// Update queue status and failed downloads periodically
		const interval = setInterval(() => {
			queueStatus = downloadOrchestrator.getQueueStatus();
			failedDownloads = downloadOrchestrator.getFailedDownloads();
		}, 500);

		return () => clearInterval(interval);
	});

	const handlePause = () => {
		downloadOrchestrator.pauseQueue();
		queueStatus = downloadOrchestrator.getQueueStatus();
	};

	const handleResume = () => {
		downloadOrchestrator.resumeQueue();
		queueStatus = downloadOrchestrator.getQueueStatus();
	};

	const handleStop = () => {
		if (confirm('Stop all downloads and clear the queue?')) {
			downloadOrchestrator.stopQueue();
			queueStatus = downloadOrchestrator.getQueueStatus();
		}
	};

	const handleRestart = () => {
		downloadOrchestrator.restartQueue();
		queueStatus = downloadOrchestrator.getQueueStatus();
	};

	const handleRetryAllFailed = async () => {
		await downloadOrchestrator.retryAllFailedDownloads();
		failedDownloads = downloadOrchestrator.getFailedDownloads();
		queueStatus = downloadOrchestrator.getQueueStatus();
	};

	const handleClearFailed = () => {
		if (confirm('Clear all failed downloads?')) {
			downloadOrchestrator.clearFailedDownloads();
			failedDownloads = downloadOrchestrator.getFailedDownloads();
		}
	};

	const totalItems = $derived(queueStatus.queued + queueStatus.running);
	const hasActivity = $derived(totalItems > 0 || failedDownloads.length > 0);
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
				{totalItems + failedDownloads.length}
			</div>
		{/if}
		<span class="download-manager-icon">⬇</span>
	</button>

	{#if isOpen}
		<div class="download-manager-panel">
			<div class="download-manager-header">
				<h3 class="download-manager-title">Downloads</h3>
				<button
					onclick={() => (isOpen = false)}
					class="download-manager-close"
					type="button"
					aria-label="Close"
				>
					✕
				</button>
			</div>

			<div class="download-manager-section">
				<div class="download-manager-stats">
					<div class="download-manager-stat">
						<span class="stat-label">Running</span>
						<span class="stat-value running">{queueStatus.running}</span>
					</div>
					<div class="download-manager-stat">
						<span class="stat-label">Queued</span>
						<span class="stat-value queued">{queueStatus.queued}</span>
					</div>
					<div class="download-manager-stat">
						<span class="stat-label">Failed</span>
						<span class="stat-value failed">{failedDownloads.length}</span>
					</div>
					<div class="download-manager-stat">
						<span class="stat-label">Status</span>
						<span class="stat-value status"
							>{queueStatus.isPaused ? 'Paused' : 'Active'}</span
						>
					</div>
				</div>
			</div>

			<div class="download-manager-controls">
				{#if queueStatus.isPaused}
					<button
						onclick={handleResume}
						class="control-btn control-btn--primary"
						type="button"
						title="Resume downloads"
					>
						<Play size={16} />
						<span>Resume</span>
					</button>
				{:else}
					<button
						onclick={handlePause}
						class="control-btn control-btn--secondary"
						type="button"
						title="Pause queue"
					>
						<Pause size={16} />
						<span>Pause</span>
					</button>
				{/if}

				<button
					onclick={handleRestart}
					class="control-btn control-btn--secondary"
					type="button"
					title="Restart queue"
					disabled={queueStatus.queued === 0 && queueStatus.running === 0}
				>
					<RotateCcw size={16} />
					<span>Restart</span>
				</button>

				<button
					onclick={handleStop}
					class="control-btn control-btn--danger"
					type="button"
					title="Stop all downloads"
					disabled={queueStatus.queued === 0 && queueStatus.running === 0}
				>
					<Square size={16} />
					<span>Stop</span>
				</button>
			</div>
		{#if !hasActivity}
			<div class="download-manager-empty">
				<p class="empty-message">No active downloads</p>
				<p class="empty-hint">Downloads will appear here when you start downloading tracks or albums</p>
			</div>
		{/if}
			{#if queueStatus.running > 0 || queueStatus.queued > 0}
				<div class="download-manager-section">
					<h4 class="download-manager-subtitle">
						Queue ({queueStatus.running + queueStatus.queued})
					</h4>
					<div class="download-manager-queue">
						<div class="queue-item queue-item--header">
							<span class="queue-item-title">Track</span>
							<span class="queue-item-status">Status</span>
						</div>
						{#each queueStatus.queuedItems.slice(0, 5) as item (item.id)}
							<div class="queue-item">
								<span class="queue-item-title" title={String(item.trackId)}>
									{item.trackId}
								</span>
								<span
									class="queue-item-status {item.retryCount > 0
										? 'retrying'
										: 'pending'}"
								>
									{item.retryCount > 0
										? `Retry ${item.retryCount}/${item.maxRetries}`
										: 'Queued'}
								</span>
							</div>
						{/each}
						{#if queueStatus.queuedItems.length > 5}
							<div class="queue-item queue-item--more">
								<span>+{queueStatus.queuedItems.length - 5} more</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			{#if failedDownloads.length > 0}
				<div class="download-manager-section">
					<div class="download-manager-subtitle-row">
						<h4 class="download-manager-subtitle">
							<AlertCircle size={14} />
							Failed ({failedDownloads.length})
						</h4>
						<div class="download-manager-failed-actions">
							<button
								onclick={handleRetryAllFailed}
								class="failed-action-btn failed-action-btn--retry"
								type="button"
								title="Retry all failed"
							>
								<RotateCw size={14} />
								<span>Retry All</span>
							</button>
							<button
								onclick={handleClearFailed}
								class="failed-action-btn failed-action-btn--clear"
								type="button"
								title="Clear failed list"
							>
								<Trash2 size={14} />
							</button>
						</div>
					</div>
					<div class="download-manager-failed">
						{#each failedDownloads.slice(0, 5) as failed (failed.taskId)}
							<div class="failed-item">
								<div class="failed-item-info">
									<span class="failed-item-title" title={failed.track.title}
										>{failed.track.title}</span
									>
									<span class="failed-item-error">{failed.error}</span>
								</div>
							</div>
						{/each}
						{#if failedDownloads.length > 5}
							<div class="failed-item failed-item--more">
								<span>+{failedDownloads.length - 5} more failed downloads</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<div class="download-manager-info">
				<p>Downloads are processed sequentially (max 2 concurrent). Timeouts trigger auto-retry.</p>
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
		--color-bg-primary: rgba(11, 16, 26, 0.95);
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
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--color-primary);
		color: white;
		font-size: 20px;
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
		min-width: 24px;
		height: 24px;
		padding: 0 6px;
		border-radius: 12px;
		background: var(--color-error);
		color: white;
		font-size: 11px;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--color-bg-primary);
	}

	.download-manager-panel {
		position: fixed;
		bottom: calc(20px + var(--player-height, 0px) + 70px + env(safe-area-inset-bottom, 0px));
		right: 20px;
		z-index: 99998;
		width: 380px;
		max-height: 600px;
		overflow-y: auto;
		border-radius: 12px;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border);
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
		animation: slideUp 0.3s ease;
		display: flex;
		flex-direction: column;
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
		padding: 14px 16px;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.download-manager-title {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
		letter-spacing: 0.5px;
	}

	.download-manager-close {
		all: unset;
		cursor: pointer;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		color: var(--color-text-secondary);
		font-size: 16px;
		transition: all 0.2s;
	}

	.download-manager-close:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
	}

	/* Sections */
	.download-manager-section {
		padding: 12px 16px;
		border-bottom: 1px solid var(--color-border);
	}

	.download-manager-section:last-of-type {
		border-bottom: none;
	}

	/* Stats */
	.download-manager-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.download-manager-stat {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px;
		border-radius: 6px;
		background: var(--color-bg-secondary);
	}

	.stat-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.stat-value {
		font-size: 18px;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.stat-value.running {
		color: var(--color-success);
	}

	.stat-value.queued {
		color: var(--color-warning);
	}

	.stat-value.failed {
		color: var(--color-error);
	}

	.stat-value.status {
		color: var(--color-primary);
		font-size: 13px;
		font-weight: 600;
	}

	/* Controls */
	.download-manager-controls {
		display: flex;
		gap: 8px;
		padding: 12px 16px;
		padding-top: 0;
		flex-shrink: 0;
	}

	.control-btn {
		all: unset;
		flex: 1;
		cursor: pointer;
		padding: 8px 12px;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.control-btn--primary {
		background: var(--color-primary);
		color: white;
	}

	.control-btn--primary:hover {
		background: #2563eb;
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

	/* Subtitle */
	.download-manager-subtitle {
		margin: 0 0 8px 0;
		font-size: 12px;
		font-weight: 700;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.download-manager-subtitle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
		gap: 8px;
	}

	/* Queue */
	.download-manager-queue {
		display: flex;
		flex-direction: column;
		gap: 0;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid var(--color-border);
		max-height: 150px;
		overflow-y: auto;
	}

	.queue-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 10px;
		border-bottom: 1px solid var(--color-border);
		font-size: 12px;
		background: var(--color-bg-secondary);
	}

	.queue-item:last-child {
		border-bottom: none;
	}

	.queue-item--header {
		background: transparent;
		font-weight: 600;
		color: var(--color-text-secondary);
		font-size: 11px;
		text-transform: uppercase;
		padding: 6px 10px;
		border-bottom: 1px solid var(--color-border);
	}

	.queue-item--more {
		justify-content: center;
		color: var(--color-text-secondary);
		font-size: 11px;
		padding: 6px 10px;
	}

	.queue-item-title {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--color-text-primary);
	}

	.queue-item-status {
		margin-left: auto;
		padding-left: 8px;
		white-space: nowrap;
		color: var(--color-text-secondary);
		font-size: 11px;
	}

	.queue-item-status.retrying {
		color: var(--color-warning);
		font-weight: 600;
	}

	/* Failed */
	.download-manager-failed {
		display: flex;
		flex-direction: column;
		gap: 0;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid rgba(239, 68, 68, 0.2);
		max-height: 150px;
		overflow-y: auto;
	}

	.failed-item {
		padding: 8px 10px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(239, 68, 68, 0.05);
		font-size: 12px;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.failed-item:last-child {
		border-bottom: none;
	}

	.failed-item--more {
		justify-content: center;
		color: var(--color-text-secondary);
		font-size: 11px;
		padding: 6px 10px;
		background: transparent;
	}

	.failed-item-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.failed-item-title {
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
	}

	.failed-item-error {
		color: var(--color-error);
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.download-manager-failed-actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}

	.failed-action-btn {
		all: unset;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		font-size: 11px;
		font-weight: 600;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.failed-action-btn--retry {
		background: rgba(16, 185, 129, 0.1);
		color: var(--color-success);
		border: 1px solid rgba(16, 185, 129, 0.3);
	}

	.failed-action-btn--retry:hover {
		background: rgba(16, 185, 129, 0.2);
	}

	.failed-action-btn--clear {
		background: rgba(239, 68, 68, 0.1);
		color: var(--color-error);
		border: 1px solid rgba(239, 68, 68, 0.3);
	}

	.failed-action-btn--clear:hover {
		background: rgba(239, 68, 68, 0.2);
	}

	/* Info */
	.download-manager-info {
		padding: 10px 16px;
		font-size: 11px;
		color: var(--color-text-secondary);
		line-height: 1.4;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		border-radius: 0 0 12px 12px;
		margin: auto 0 0 0;
	}

	.download-manager-info p {
		margin: 0;
	}

	/* Scrollbar */
	.download-manager-panel::-webkit-scrollbar,
	.download-manager-queue::-webkit-scrollbar,
	.download-manager-failed::-webkit-scrollbar {
		width: 6px;
	}

	.download-manager-panel::-webkit-scrollbar-track,
	.download-manager-queue::-webkit-scrollbar-track,
	.download-manager-failed::-webkit-scrollbar-track {
		background: transparent;
	}

	.download-manager-panel::-webkit-scrollbar-thumb,
	.download-manager-queue::-webkit-scrollbar-thumb,
	.download-manager-failed::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.2);
		border-radius: 3px;
	}

	.download-manager-panel::-webkit-scrollbar-thumb:hover,
	.download-manager-queue::-webkit-scrollbar-thumb:hover,
	.download-manager-failed::-webkit-scrollbar-thumb:hover {
		background: rgba(255, 255, 255, 0.3);
	}

	/* Empty state */
	.download-manager-empty {
		padding: 32px 16px;
		text-align: center;
		color: var(--color-text-secondary);
	}

	.empty-message {
		margin: 0 0 8px 0;
		font-size: 14px;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.empty-hint {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		opacity: 0.7;
	}

	/* Toggle button inactive state */
	.download-manager-toggle:not(.has-activity) {
		background: rgba(255, 255, 255, 0.1);
		opacity: 0.6;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	}

	.download-manager-toggle:not(.has-activity):hover {
		opacity: 1;
		background: rgba(255, 255, 255, 0.15);
	}

	/* Responsive */
	@media (max-width: 640px) {
		.download-manager-panel {
			width: calc(100vw - 40px);
			right: 20px;
			max-height: 400px;
		}

		.download-manager-stats {
			grid-template-columns: 1fr 1fr;
		}

		.control-btn span {
			display: none;
		}

		.control-btn {
			padding: 8px;
		}
	}
</style>
