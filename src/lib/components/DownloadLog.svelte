<script lang="ts">
	import type { DownloadLogEntry } from '$lib/stores/downloadLog';
	import { downloadLogStore } from '$lib/stores/downloadLog';
	import { getSessionHeaders } from '$lib/core/session';
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import ToolPanel from '$lib/components/ui/ToolPanel.svelte';
	import WindowedList from '$lib/components/ui/WindowedList.svelte';
	import { Copy, Trash2, Heart } from 'lucide-svelte';
	import { onMount, tick } from 'svelte';

	let scrollContainer = $state<HTMLDivElement | null>(null);
	let healthData = $state<{
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
	} | null>(null);
	let loadingHealth = $state(false);
	let shouldFollowLogTail = $state(true);
	let isDocumentVisible = $state(true);
	const sectionNavItems = $derived.by(() => {
		const items = [];
		if (healthData) {
			items.push({ id: 'download-log-health', label: 'Health', tone: 'secondary' as const });
		}
		items.push({ id: 'download-log-stream', label: 'Event Stream', tone: 'tertiary' as const });
		return items;
	});

	$effect(() => {
		if (
			$downloadLogStore.entries.length === 0 ||
			!scrollContainer ||
			!shouldFollowLogTail ||
			!isDocumentVisible
		) {
			return;
		}
		void tick().then(() => {
			scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'auto' });
		});
	});

	function updateTailFollowState() {
		if (!scrollContainer) {
			return;
		}
		const remaining =
			scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
		shouldFollowLogTail = remaining <= 40;
	}

	onMount(() => {
		const updateDocumentVisibility = () => {
			isDocumentVisible = document.visibilityState !== 'hidden';
		};

		updateDocumentVisibility();
		document.addEventListener('visibilitychange', updateDocumentVisibility);

		return () => {
			document.removeEventListener('visibilitychange', updateDocumentVisibility);
		};
	});

	$effect(() => {
		if (!scrollContainer) {
			return;
		}
		updateTailFollowState();
		scrollContainer.addEventListener('scroll', updateTailFollowState, { passive: true });
		return () => {
			scrollContainer?.removeEventListener('scroll', updateTailFollowState);
		};
	});

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

<PageSectionNav items={sectionNavItems} sticky={true} />

<section class="download-log-container" data-ui-block="main-sections">
	<ToolPanel flush={true} tone="tertiary" panelRole="download-log">
		<div class="download-log-panel">
		<div class="download-log-header" data-ui-block="primary-actions">
			<div class="download-log-heading">
				<h3 class="download-log-title">Event Stream</h3>
				<p class="download-log-subtitle">Realtime queue, metadata, and file-system logs.</p>
			</div>
			<div class="download-log-actions">
				<span class="download-log-count" title="Current log lines">{$downloadLogStore.entries.length}</span>
				<button type="button" class="download-log-btn" title="Check server health" onclick={fetchHealth} disabled={loadingHealth}>
					<Heart size={16} />
				</button>
				<button type="button" class="download-log-btn" title="Copy logs" onclick={copyLogs}>
					<Copy size={16} />
				</button>
				<button
					type="button"
					class="download-log-btn"
					title="Clear logs"
					onclick={() => downloadLogStore.clear()}
				>
					<Trash2 size={16} />
				</button>
			</div>
		</div>

		<!-- Health Status -->
		{#if healthData}
			<div
				id="download-log-health"
				class="ui-section-anchor download-health-summary"
				data-ui-block="key-summary"
			>
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
				<button type="button" class="download-health-btn" onclick={cleanupHealth}>Cleanup Stuck</button>
			</div>
		{/if}

		<!-- Log Content -->
		<WindowedList
			id="download-log-stream"
			className="ui-section-anchor download-log-content"
			items={$downloadLogStore.entries}
			itemHeight={42}
			overscan={24}
			threshold={160}
			useContainerScroll={true}
			bind:containerElement={scrollContainer}
		>
			{#snippet row(item)}
				{@const entry = item as DownloadLogEntry}
				<div class="download-log-entry ui-perf-log-entry download-log-entry--{entry.level}" data-window-item>
					<span class="download-log-time">{entry.timestamp.toLocaleTimeString()}</span>
					<span class="download-log-level">[{entry.level.toUpperCase()}]</span>
					<span class="download-log-message">{entry.message}</span>
				</div>
			{/snippet}
		</WindowedList>
		</div>
	</ToolPanel>
</section>

<style>
	.download-log-container {
		height: clamp(420px, 68vh, 820px);
	}

	.download-log-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: #101010;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
	}

	.download-log-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 18px;
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
		font-size: 1rem;
		font-weight: 600;
		color: rgba(245, 245, 245, 0.96);
		letter-spacing: 0.02em;
	}

	.download-log-subtitle {
		margin: 0;
		font-size: 0.84rem;
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
		min-width: 2.2rem;
		height: 2rem;
		padding: 0 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		font-size: 0.84rem;
		font-weight: 600;
		color: rgba(212, 212, 212, 0.82);
	}

	.download-log-btn {
		all: unset;
		cursor: pointer;
		padding: 0.46rem;
		min-width: 2rem;
		min-height: 2rem;
		border-radius: 8px;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		color: rgba(212, 212, 212, 0.82);
		transition:
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: none;
	}

	.download-log-btn:hover {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
		color: rgba(255, 255, 255, 0.96);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.download-log-btn:active {
		background: var(--ui-surface-2, rgba(255, 255, 255, 0.09));
		transform: translateY(var(--ui-press-y, 0px));
	}

	.download-log-panel :global(.download-log-content) {
		flex: 1;

		/* IMPORTANT: allow a flex child to actually shrink and become scrollable */
		min-height: 0;

		overflow-y: auto;
		overflow-x: hidden;

		font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
		font-size: 13px;
		padding: 10px 14px;
		color: rgba(212, 212, 212, 0.88);
		line-height: 1.4;

		display: flex;
		flex-direction: column;

		scroll-behavior: smooth;
	}

	.download-log-panel :global(.download-log-content::-webkit-scrollbar) {
		width: 12px;
	}

	.download-log-panel :global(.download-log-content::-webkit-scrollbar-track) {
		background: rgba(255, 255, 255, 0.02);
		border-radius: 6px;
	}

	.download-log-panel :global(.download-log-content::-webkit-scrollbar-thumb) {
		background: rgba(255, 255, 255, 0.22);
		border-radius: 6px;
		border: 2px solid transparent;
		background-clip: padding-box;
	}

	.download-log-panel :global(.download-log-content::-webkit-scrollbar-thumb:hover) {
		background: rgba(255, 255, 255, 0.34);
		background-clip: padding-box;
	}

	.download-log-entry {
		margin: 0;
		padding: 0.48rem 0.62rem;
		border-radius: 8px;
		border: 1px solid transparent;
		display: flex;
		gap: 8px;
		align-items: flex-start;
		word-break: break-word;
		transition:
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	.download-log-entry:hover {
		border-color: var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
	}

	.download-log-time {
		color: rgba(163, 163, 163, 0.82);
		flex-shrink: 0;
		min-width: 12ch;
		font-size: 0.82rem;
	}

	.download-log-level {
		flex-shrink: 0;
		min-width: 8ch;
		font-weight: 500;
		font-size: 0.82rem;
	}

	.download-log-message {
		flex: 1;
		word-break: break-word;
		font-size: 0.9rem;
	}

	.download-log-entry--info {
		color: rgba(212, 212, 212, 0.84);
	}

	.download-log-entry--info .download-log-level {
		color: rgba(163, 163, 163, 0.82);
	}

	.download-log-entry--success {
		color: rgba(232, 232, 232, 0.92);
	}

	.download-log-entry--success .download-log-level {
		color: rgba(220, 220, 220, 0.9);
	}

	.download-log-entry--success .download-log-time {
		color: rgba(206, 206, 206, 0.88);
	}

	.download-log-entry--warning {
		color: rgba(224, 224, 224, 0.9);
	}

	.download-log-entry--warning .download-log-level {
		color: rgba(212, 212, 212, 0.88);
	}

	.download-log-entry--warning .download-log-time {
		color: rgba(194, 194, 194, 0.84);
	}

	.download-log-entry--error {
		color: rgba(214, 214, 214, 0.92);
	}

	.download-log-entry--error .download-log-level {
		color: rgba(200, 200, 200, 0.9);
	}

	.download-log-entry--error .download-log-time {
		color: rgba(186, 186, 186, 0.88);
	}

/* Health Summary Styles */
.download-health-summary {
	padding: 16px;
	border-bottom: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
	background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
}

.download-health-title {
	margin: 0 0 12px 0;
	font-size: 0.9rem;
	font-weight: 600;
	color: rgba(245, 245, 245, 0.96);
	letter-spacing: 0.04em;
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
	font-size: 0.84rem;
}

.download-health-value {
	color: rgba(245, 245, 245, 0.96);
	font-weight: 500;
	font-size: 0.94rem;
}

.download-health-stat--wide .download-health-value {
	font-size: 13px;
	color: rgba(212, 212, 212, 0.82);
	word-break: break-all;
}

.download-health-value.connected {
	color: rgba(236, 236, 236, 0.94);
}

.download-health-btn {
	all: unset;
	cursor: pointer;
	padding: 8px 14px;
	border-radius: 8px;
	border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
	background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
	color: rgba(245, 245, 245, 0.92);
	font-size: 13px;
	font-weight: 500;
	transition:
		border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
		background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
		transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
}

.download-health-btn:hover {
	border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
	background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
	transform: translateY(var(--ui-lift-y, -1px));
}

.download-health-btn:active {
	background: var(--ui-surface-2, rgba(255, 255, 255, 0.09));
	transform: translateY(var(--ui-press-y, 0px));
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
	backdrop-filter: none;
	box-shadow: none;
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
	background: rgba(255, 255, 255, 0.92);
	border-radius: 2px;
	transition: width var(--ui-motion-medium, 200ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
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

@media (prefers-reduced-motion: reduce) {
	.download-log-panel :global(.download-log-content) {
		scroll-behavior: auto;
	}

	.download-log-btn,
	.download-health-btn,
	.download-progress-compact-bar-fill {
		transition: none;
	}

	.download-log-btn:hover,
	.download-health-btn:hover {
		transform: none;
	}
}
</style>
