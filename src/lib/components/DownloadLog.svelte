<script lang="ts">
	import { downloadLogStore } from '$lib/stores/downloadLog';
	import { getSessionHeaders } from '$lib/core/session';
	import { Copy, Trash2, Heart } from 'lucide-svelte';
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

<section class="download-log-container">
	<div class="download-log-panel">
		<div class="download-log-header">
			<div class="download-log-heading">
				<h3 class="download-log-title">Event Stream</h3>
				<p class="download-log-subtitle">Realtime queue, metadata, and file-system logs.</p>
			</div>
			<div class="download-log-actions">
				<span class="download-log-count" title="Current log lines">{$downloadLogStore.entries.length}</span>
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
</section>

<style>
	.download-log-container {
		height: clamp(360px, 65vh, 780px);
		border-radius: var(--ui-radius-md, 14px);
		overflow: hidden;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		box-shadow: var(--ui-shadow-soft, 0 10px 28px rgba(0, 0, 0, 0.22));
	}

	.download-log-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
		backdrop-filter: blur(var(--perf-blur-low, 10px)) saturate(var(--perf-saturate, 145%));
		-webkit-backdrop-filter: blur(var(--perf-blur-low, 10px)) saturate(var(--perf-saturate, 145%));
	}

	.download-log-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		flex-shrink: 0;
	}

	.download-log-heading {
		display: flex;
		flex-direction: column;
		gap: 0.18rem;
	}

	.download-log-title {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 600;
		color: rgba(245, 245, 245, 0.96);
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.download-log-subtitle {
		margin: 0;
		font-size: 0.68rem;
		color: rgba(163, 163, 163, 0.84);
	}

	.download-log-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.download-log-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2rem;
		height: 1.7rem;
		padding: 0 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		font-size: 0.68rem;
		font-weight: 600;
		color: rgba(212, 212, 212, 0.82);
	}

	.download-log-btn {
		all: unset;
		cursor: pointer;
		padding: 0.34rem;
		border-radius: 8px;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		color: rgba(212, 212, 212, 0.82);
		transition: border-color 140ms ease, background 140ms ease, color 140ms ease, box-shadow 140ms ease;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
	}

	.download-log-btn:hover {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
		color: rgba(255, 255, 255, 0.96);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.download-log-btn:active {
		background: var(--ui-surface-2, rgba(255, 255, 255, 0.09));
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
		color: rgba(212, 212, 212, 0.88);
		line-height: 1.4;

		display: flex;
		flex-direction: column;

		scroll-behavior: smooth;
	}

	.download-log-content::-webkit-scrollbar {
		width: 12px;
	}

	.download-log-content::-webkit-scrollbar-track {
		background: rgba(255, 255, 255, 0.02);
		border-radius: 6px;
	}

	.download-log-content::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.22);
		border-radius: 6px;
		border: 2px solid transparent;
		background-clip: padding-box;
	}

	.download-log-content::-webkit-scrollbar-thumb:hover {
		background: rgba(255, 255, 255, 0.34);
		background-clip: padding-box;
	}

	.download-log-entry {
		margin: 0;
		padding: 0.34rem 0.48rem;
		border-radius: 8px;
		border: 1px solid transparent;
		display: flex;
		gap: 8px;
		align-items: flex-start;
		word-break: break-word;
		transition: border-color 140ms ease, background 140ms ease;
	}

	.download-log-entry:hover {
		border-color: var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
	}

	.download-log-time {
		color: rgba(163, 163, 163, 0.82);
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
		color: rgba(212, 212, 212, 0.84);
	}

	.download-log-entry--info .download-log-level {
		color: rgba(163, 163, 163, 0.82);
	}

	.download-log-entry--success {
		color: rgba(220, 252, 231, 0.92);
	}

	.download-log-entry--success .download-log-level {
		color: rgba(187, 247, 208, 0.9);
	}

	.download-log-entry--success .download-log-time {
		color: rgba(134, 239, 172, 0.88);
	}

	.download-log-entry--warning {
		color: rgba(254, 240, 138, 0.9);
	}

	.download-log-entry--warning .download-log-level {
		color: rgba(253, 224, 71, 0.88);
	}

	.download-log-entry--warning .download-log-time {
		color: rgba(245, 158, 11, 0.84);
	}

	.download-log-entry--error {
		color: rgba(254, 226, 226, 0.92);
	}

	.download-log-entry--error .download-log-level {
		color: rgba(252, 165, 165, 0.9);
	}

	.download-log-entry--error .download-log-time {
		color: rgba(248, 113, 113, 0.88);
	}

/* Health Summary Styles */
.download-health-summary {
	padding: 16px;
	border-bottom: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
	background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
}

.download-health-title {
	margin: 0 0 12px 0;
	font-size: 0.74rem;
	font-weight: 600;
	color: rgba(245, 245, 245, 0.96);
	letter-spacing: 0.16em;
	text-transform: uppercase;
}

.download-health-stats {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	gap: 8px;
	margin-bottom: 12px;
}

.download-health-stat {
	display: flex;
	flex-direction: column;
	gap: 4px;
	align-items: flex-start;
	padding: 0.5rem 0.58rem;
	border-radius: 10px;
	border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
	background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
	font-size: 13px;
}

.download-health-stat--wide {
	grid-column: 1 / -1;
}

.download-health-label {
	color: rgba(212, 212, 212, 0.8);
}

.download-health-value {
	color: rgba(245, 245, 245, 0.96);
	font-weight: 500;
}

.download-health-stat--wide .download-health-value {
	font-size: 12px;
	color: rgba(212, 212, 212, 0.82);
	word-break: break-all;
}

.download-health-value.connected {
	color: #bbf7d0;
}

.download-health-btn {
	all: unset;
	cursor: pointer;
	padding: 6px 12px;
	border-radius: 8px;
	border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
	background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
	color: rgba(245, 245, 245, 0.92);
	font-size: 12px;
	font-weight: 500;
	transition: border-color 140ms ease, background 140ms ease;
}

.download-health-btn:hover {
	border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
	background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
}

.download-health-btn:active {
	background: var(--ui-surface-2, rgba(255, 255, 255, 0.09));
}

/* Compact Progress Indicator Styles */
.download-progress-compact {
	position: fixed;
	bottom: calc(20px + var(--player-height, 0px) + env(safe-area-inset-bottom, 0px));
	right: 20px;
	background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
	border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
	border-radius: 12px;
	padding: 12px 16px;
	min-width: 280px;
	max-width: 400px;
	backdrop-filter: blur(var(--perf-blur-low, 10px));
	box-shadow: var(--ui-shadow-soft, 0 10px 28px rgba(0, 0, 0, 0.22));
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
	background: linear-gradient(90deg, rgba(255, 255, 255, 0.9), rgba(212, 212, 212, 0.72));
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
