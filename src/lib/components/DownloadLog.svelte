<script lang="ts">
	import { downloadLogStore } from '$lib/stores/downloadLog';
	import { getSessionHeaders } from '$lib/core/session';
	import { X, Copy, Trash2, Heart } from 'lucide-svelte';
	import { tick } from 'svelte';

	let scrollContainer: HTMLDivElement | null = null;
	let healthData: {
		activeUploads: number;
		maxConcurrent: number;
		pendingUploads: number;
		chunkUploads: number;
		redisConnected: boolean;
		downloadDir?: string;
		tempDir?: string;
		disk?: {
			freeBytes: number;
			totalBytes: number;
			usedBytes: number;
		} | null;
	} | null = null;
	let loadingHealth = false;

	$: if ($downloadLogStore.entries.length > 0 && scrollContainer) {
		tick().then(() => {
			scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
		});
	}

	function copyLogs() {
		const logText = $downloadLogStore.entries
			.map(
				(entry) =>
					`[${entry.timestamp.toLocaleTimeString()}] [${entry.level.toUpperCase()}] ${entry.message}`
			)
			.join('\n');

		navigator.clipboard.writeText(logText);
	}

	function formatBytes(bytes?: number): string {
		if (!bytes || !Number.isFinite(bytes)) return '—';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let value = bytes;
		let unitIndex = 0;
		while (value >= 1024 && unitIndex < units.length - 1) {
			value /= 1024;
			unitIndex++;
		}
		return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
	}

	async function fetchHealth() {
		loadingHealth = true;
		try {
			const res = await fetch('/api/download-track/health', {
				headers: getSessionHeaders()
			});
			if (res.ok) {
				healthData = await res.json();
			} else {
				console.error('Health check failed');
			}
		} catch (err) {
			console.error('Health fetch error', err);
		} finally {
			loadingHealth = false;
		}
	}

	async function cleanupHealth() {
		try {
			const res = await fetch('/api/download-track/health', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
				body: JSON.stringify({ action: 'cleanup' })
			});
			if (res.ok) {
				await fetchHealth(); // Refresh
			} else {
				console.error('Cleanup failed');
			}
		} catch (err) {
			console.error('Cleanup error', err);
		}
	}
</script>

<!-- Compact progress indicator disabled - use DownloadManager instead -->
<!-- {#if activeDownloads.length > 0 && !$downloadLogStore.isVisible}
	<div class="download-progress-compact">
		<div class="download-progress-compact-header">
			<span class="download-progress-compact-title">
				<span class="download-progress-compact-label">{compactLabel}</span>
				<span class="download-progress-compact-count">
					{activeDownloads.length} track{activeDownloads.length > 1 ? 's' : ''}
				</span>
			</span>
			<button
				type="button"
				class="download-progress-compact-toggle"
				on:click={() => downloadLogStore.toggle()}
				title={$downloadLogStore.isVisible ? 'Hide details' : 'Show details'}
			>
				{$downloadLogStore.isVisible ? '▼' : '▶'}
			</button>
		</div>
		<div class="download-progress-compact-tasks">
			{#each activeDownloads.slice(0, 3) as task (task.id)}
				<div class="download-progress-compact-task">
					<span class="download-progress-compact-task-title" title="{task.title}">{task.title}</span>
					<div class="download-progress-compact-bar">
						<div class="download-progress-compact-bar-fill" style="width: {task.progress * 100}%"></div>
					</div>
					<span class="download-progress-compact-percent">{Math.round(task.progress * 100)}%</span>
				</div>
			{/each}
			{#if activeDownloads.length > 3}
				<div class="download-progress-compact-more">
					+{activeDownloads.length - 3} more...
				</div>
			{/if}
		</div>
	</div>
{/if} -->

<!-- Full download log (only when toggled) -->
<div class="download-log-container" class:is-visible={$downloadLogStore.isVisible} on:click|stopPropagation role="presentation">
	<div class="download-log-panel">
		<div class="download-log-header">
			<h3 class="download-log-title">Download Log</h3>
			<div class="download-log-actions">
				<button type="button" class="download-log-btn" title="Check server health" on:click={fetchHealth} disabled={loadingHealth}>
					<Heart size={16} />
				</button>
				<button type="button" class="download-log-btn" title="Copy logs" on:click={copyLogs}>
					<Copy size={16} />
				</button>
				<button
					type="button"
					class="download-log-btn"
					title="Clear logs"
					on:click={() => downloadLogStore.clear()}
				>
					<Trash2 size={16} />
				</button>
				<button
					type="button"
					class="download-log-btn"
					title="Close"
					on:click={() => downloadLogStore.hide()}
				>
					<X size={16} />
				</button>
			</div>
		</div>

		<!-- Health Status -->
		{#if healthData}
			<div class="download-health-summary">
				<h4 class="download-health-title">Server Health</h4>
				<div class="download-health-stats">
					<div class="download-health-stat">
						<span class="download-health-label">Active Uploads:</span>
						<span class="download-health-value">{healthData.activeUploads} / {healthData.maxConcurrent}</span>
					</div>
					<div class="download-health-stat">
						<span class="download-health-label">Pending:</span>
						<span class="download-health-value">{healthData.pendingUploads}</span>
					</div>
					<div class="download-health-stat">
						<span class="download-health-label">Chunked:</span>
						<span class="download-health-value">{healthData.chunkUploads}</span>
					</div>
					<div class="download-health-stat">
						<span class="download-health-label">Redis:</span>
						<span class="download-health-value" class:connected={healthData.redisConnected}>
							{healthData.redisConnected ? 'Connected' : 'Disconnected'}
						</span>
					</div>
					{#if healthData.downloadDir}
						<div class="download-health-stat download-health-stat--wide">
							<span class="download-health-label">Download Dir:</span>
							<span class="download-health-value">{healthData.downloadDir}</span>
						</div>
					{/if}
					{#if healthData.tempDir}
						<div class="download-health-stat download-health-stat--wide">
							<span class="download-health-label">Temp Dir:</span>
							<span class="download-health-value">{healthData.tempDir}</span>
						</div>
					{/if}
					{#if healthData.disk}
						<div class="download-health-stat download-health-stat--wide">
							<span class="download-health-label">Disk Free:</span>
							<span class="download-health-value">
								{formatBytes(healthData.disk.freeBytes)} / {formatBytes(healthData.disk.totalBytes)}
							</span>
						</div>
					{/if}
				</div>
				<button type="button" class="download-health-btn" on:click={cleanupHealth}>Cleanup Stuck</button>
			</div>
		{/if}

		<!-- Log Content -->
		<div class="download-log-content" bind:this={scrollContainer}>
			{#each $downloadLogStore.entries as entry (entry.id)}
				<div class="download-log-entry download-log-entry--{entry.level}">
					<span class="download-log-time">{entry.timestamp.toLocaleTimeString()}</span>
					<span class="download-log-level">[{entry.level.toUpperCase()}]</span>
					<span class="download-log-message">{entry.message}</span>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.download-log-container {
		position: fixed;
		bottom: 0;
		right: 0;
		left: 0;

		/* IMPORTANT: use height rather than max-height to give inner flex a stable box */
		height: 0;
		overflow: hidden;
		transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1);

		z-index: 100000;
	}

	.download-log-container.is-visible {
		height: 450px;
	}

	.download-log-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: rgba(0, 0, 0, 0.9);
		border-top: 1px solid rgba(255, 255, 255, 0.1);
		backdrop-filter: blur(10px);
	}

	.download-log-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		flex-shrink: 0;
	}

	.download-log-title {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: #fff;
		letter-spacing: 0.5px;
	}

	.download-log-actions {
		display: flex;
		gap: 8px;
	}

	.download-log-btn {
		all: unset;
		cursor: pointer;
		padding: 6px;
		border-radius: 4px;
		color: #aaa;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.download-log-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
	}

	.download-log-btn:active {
		background: rgba(255, 255, 255, 0.15);
	}

	.download-log-content {
		flex: 1;

		/* IMPORTANT: allow a flex child to actually shrink and become scrollable */
		min-height: 0;

		overflow-y: auto;
		overflow-x: hidden;

		font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
		font-size: 12px;
		padding: 8px 12px;
		color: #ccc;
		line-height: 1.4;

		display: flex;
		flex-direction: column;

		scroll-behavior: smooth;
	}

	.download-log-content::-webkit-scrollbar {
		width: 12px;
	}

	.download-log-content::-webkit-scrollbar-track {
		background: rgba(255, 255, 255, 0.05);
		border-radius: 6px;
	}

	.download-log-content::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.3);
		border-radius: 6px;
		border: 2px solid transparent;
		background-clip: padding-box;
	}

	.download-log-content::-webkit-scrollbar-thumb:hover {
		background: rgba(255, 255, 255, 0.5);
		background-clip: padding-box;
	}

	.download-log-entry {
		margin: 4px 0;
		display: flex;
		gap: 8px;
		align-items: flex-start;
		word-break: break-word;
	}

	.download-log-time {
		color: #666;
		flex-shrink: 0;
		min-width: 12ch;
	}

	.download-log-level {
		flex-shrink: 0;
		min-width: 8ch;
		font-weight: 500;
	}

	.download-log-message {
		flex: 1;
		word-break: break-word;
	}

	.download-log-entry--info {
		color: #aaa;
	}

	.download-log-entry--info .download-log-level {
		color: #666;
	}

	.download-log-entry--success {
		color: #4ade80;
	}

	.download-log-entry--success .download-log-level {
		color: #22c55e;
	}

	.download-log-entry--success .download-log-time {
		color: #166534;
	}

	.download-log-entry--warning {
		color: #facc15;
	}

	.download-log-entry--warning .download-log-level {
		color: #eab308;
	}

	.download-log-entry--warning .download-log-time {
		color: #713f12;
	}

	.download-log-entry--error {
		color: #ef4444;
	}

	.download-log-entry--error .download-log-level {
		color: #dc2626;
	}

	.download-log-entry--error .download-log-time {
		color: #7f1d1d;
	}

/* Health Summary Styles */
.download-health-summary {
	padding: 16px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	background: rgba(0, 0, 0, 0.2);
}

.download-health-title {
	margin: 0 0 12px 0;
	font-size: 14px;
	font-weight: 600;
	color: #fff;
	letter-spacing: 0.5px;
}

.download-health-stats {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-bottom: 12px;
}

.download-health-stat {
	display: flex;
	justify-content: space-between;
	align-items: center;
	font-size: 13px;
}

.download-health-stat--wide {
	align-items: flex-start;
	flex-direction: column;
	gap: 4px;
}

.download-health-label {
	color: #ccc;
}

.download-health-value {
	color: #fff;
	font-weight: 500;
}

.download-health-stat--wide .download-health-value {
	font-size: 12px;
	color: #e2e8f0;
	word-break: break-all;
}

.download-health-value.connected {
	color: #10b981;
}

.download-health-btn {
	all: unset;
	cursor: pointer;
	padding: 6px 12px;
	border-radius: 4px;
	background: rgba(255, 255, 255, 0.1);
	color: #fff;
	font-size: 12px;
	font-weight: 500;
	transition: all 0.2s;
}

.download-health-btn:hover {
	background: rgba(255, 255, 255, 0.2);
}

.download-health-btn:active {
	background: rgba(255, 255, 255, 0.25);
}

/* Compact Progress Indicator Styles */
.download-progress-compact {
	position: fixed;
	bottom: calc(20px + var(--player-height, 0px) + env(safe-area-inset-bottom, 0px));
	right: 20px;
	background: rgba(11, 16, 26, 0.95);
	border: 1px solid rgba(255, 255, 255, 0.1);
	border-radius: 12px;
	padding: 12px 16px;
	min-width: 280px;
	max-width: 400px;
	backdrop-filter: blur(10px);
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	z-index: 1000;
}

.download-progress-compact-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 8px;
}

.download-progress-compact-title {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-size: 14px;
	font-weight: 600;
	color: #fff;
	white-space: nowrap;
}

.download-progress-compact-count {
	font-variant-numeric: tabular-nums;
}

.download-progress-compact-toggle {
	background: none;
	border: none;
	color: #888;
	cursor: pointer;
	font-size: 12px;
	padding: 2px 6px;
	border-radius: 4px;
	transition: color 0.2s;
}

.download-progress-compact-toggle:hover {
	color: #fff;
}

.download-progress-compact-tasks {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.download-progress-compact-task {
	display: flex;
	align-items: center;
	gap: 8px;
}

.download-progress-compact-task-title {
	flex: 1;
	font-size: 12px;
	color: #ccc;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	min-width: 0;
}

.download-progress-compact-bar {
	flex: 0 0 60px;
	height: 4px;
	background: rgba(255, 255, 255, 0.2);
	border-radius: 2px;
	overflow: hidden;
}

.download-progress-compact-bar-fill {
	height: 100%;
	background: linear-gradient(90deg, #3b82f6, #8b5cf6);
	border-radius: 2px;
	transition: width 0.3s ease;
}

.download-progress-compact-percent {
	font-size: 11px;
	color: #888;
	min-width: 32px;
	text-align: right;
}

.download-progress-compact-more {
	font-size: 11px;
	color: #666;
	text-align: center;
	padding: 4px 0;
}

/* Responsive: horizontal layout on larger screens */
@media (min-width: 768px) {
	.download-progress-compact-tasks {
		flex-direction: row;
		flex-wrap: wrap;
		gap: 12px;
	}

	.download-progress-compact-task {
		flex: 1;
		min-width: 200px;
		max-width: 300px;
	}
}
</style>
