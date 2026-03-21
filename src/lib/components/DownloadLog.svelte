<script lang="ts">
	import type { DownloadLogEntry } from '$lib/stores/downloadLog';
	import { downloadLogStore } from '$lib/stores/downloadLog';
	import { getSessionHeaders } from '$lib/core/session';
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import ToolPanel from '$lib/components/ui/ToolPanel.svelte';
	import WindowedList from '$lib/components/ui/WindowedList.svelte';
	import { Copy, Trash2, Heart } from 'lucide-svelte';
	import { onMount, tick } from 'svelte';
	import { confirm as requestConfirmation } from '$lib/stores/dialogs';

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

	async function clearLogs() {
		const lineCount = $downloadLogStore.entries.length;
		const shouldClear = await requestConfirmation({
			title: 'Clear download logs?',
			body:
				lineCount === 0
					? 'Clear the current download log view?'
					: `Remove ${lineCount} log line${lineCount === 1 ? '' : 's'} from the current download log view?`,
			confirmLabel: 'Clear logs',
			cancelLabel: 'Keep logs',
			tone: 'danger'
		});
		if (!shouldClear) {
			return;
		}
		downloadLogStore.clear();
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
				<button
					type="button"
					class="download-log-btn"
					title="Check server health"
					aria-label="Check server health"
					onclick={fetchHealth}
					disabled={loadingHealth}
				>
					<Heart size={16} />
				</button>
				<button
					type="button"
					class="download-log-btn"
					title="Copy logs"
					aria-label="Copy logs"
					onclick={copyLogs}
				>
					<Copy size={16} />
				</button>
				<button
					type="button"
					class="download-log-btn"
					title="Clear logs"
					aria-label="Clear logs"
					onclick={() => void clearLogs()}
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
		background: transparent;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
	}

	.download-log-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.7rem 0 0.72rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		flex-shrink: 0;
	}

	.download-log-heading {
		display: flex;
		flex-direction: column;
		gap: 0.18rem;
	}

	.download-log-title {
		margin: 0;
		font-size: 0.96rem;
		font-weight: 600;
		color: var(--ui-text-primary, rgba(245, 245, 245, 0.96));
		letter-spacing: 0.02em;
	}

	.download-log-subtitle {
		margin: 0;
		font-size: 0.8rem;
		color: var(--ui-text-muted, rgba(163, 163, 163, 0.84));
	}

	.download-log-actions {
		display: flex;
		align-items: center;
		gap: 0.38rem;
	}

	.download-log-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.9rem;
		height: 1.8rem;
		padding: 0 0.45rem;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: transparent;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--ui-text-secondary, rgba(212, 212, 212, 0.82));
	}

	.download-log-btn {
		all: unset;
		cursor: pointer;
		padding: 0.4rem;
		min-width: 1.8rem;
		min-height: 1.8rem;
		border-radius: 8px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: transparent;
		color: var(--ui-text-secondary, rgba(212, 212, 212, 0.82));
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
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.22));
		background: rgba(255, 255, 255, 0.045);
		color: var(--ui-text-primary, rgba(255, 255, 255, 0.96));
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
		padding: 0.5rem 0;
		color: var(--ui-text-secondary, rgba(212, 212, 212, 0.88));
		line-height: 1.4;

		display: flex;
		flex-direction: column;

		scroll-behavior: smooth;
	}

	.download-log-panel :global(.download-log-content::-webkit-scrollbar) {
		width: 12px;
	}

	.download-log-panel :global(.download-log-content::-webkit-scrollbar-track) {
		background: var(--ui-layer-section, rgba(255, 255, 255, 0.02));
		border-radius: 6px;
	}

	.download-log-panel :global(.download-log-content::-webkit-scrollbar-thumb) {
		background: rgb(var(--ui-color-parchment-rgb, 242 231 213) / 0.22);
		border-radius: 6px;
		border: 2px solid transparent;
		background-clip: padding-box;
	}

	.download-log-panel :global(.download-log-content::-webkit-scrollbar-thumb:hover) {
		background: rgb(var(--ui-color-parchment-rgb, 242 231 213) / 0.34);
		background-clip: padding-box;
	}

	.download-log-entry {
		margin: 0;
		padding: 0.46rem 0;
		border-radius: 0;
		border: 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		display: flex;
		gap: 8px;
		align-items: flex-start;
		word-break: break-word;
		transition:
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	.download-log-entry:hover {
		background: rgba(255, 255, 255, 0.025);
	}

	.download-log-time {
		color: var(--ui-text-muted, rgba(163, 163, 163, 0.82));
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
		color: var(--ui-text-secondary, rgba(212, 212, 212, 0.84));
	}

	.download-log-entry--info .download-log-level {
		color: var(--ui-text-muted, rgba(163, 163, 163, 0.82));
	}

	.download-log-entry--success {
		color: var(--ui-status-success, rgba(232, 232, 232, 0.92));
	}

	.download-log-entry--success .download-log-level {
		color: var(--ui-status-success, rgba(220, 220, 220, 0.9));
	}

	.download-log-entry--success .download-log-time {
		color: rgb(var(--ui-color-sage-rgb, 126 152 119) / 0.82);
	}

	.download-log-entry--warning {
		color: var(--ui-status-warning, rgba(224, 224, 224, 0.9));
	}

	.download-log-entry--warning .download-log-level {
		color: var(--ui-status-warning, rgba(212, 212, 212, 0.88));
	}

	.download-log-entry--warning .download-log-time {
		color: rgb(var(--ui-color-ochre-rgb, 197 139 58) / 0.82);
	}

	.download-log-entry--error {
		color: var(--ui-status-error, rgba(214, 214, 214, 0.92));
	}

	.download-log-entry--error .download-log-level {
		color: var(--ui-status-error, rgba(200, 200, 200, 0.9));
	}

	.download-log-entry--error .download-log-time {
		color: rgb(var(--ui-color-terracotta-rgb, 198 106 75) / 0.82);
	}

/* Health Summary Styles */
	.download-health-summary {
		padding: 0.72rem 0 0.2rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		border-bottom: 0;
		background: transparent;
	}

	.download-health-title {
		margin: 0 0 0.55rem 0;
		font-size: 0.84rem;
		font-weight: 700;
		color: var(--ui-text-primary, rgba(245, 245, 245, 0.96));
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.download-health-stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.24rem 0.9rem;
		margin-bottom: 0.72rem;
	}

	.download-health-stat {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		align-items: flex-start;
		padding: 0.34rem 0;
		border-radius: 0;
		border: 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		background: transparent;
		font-size: 13px;
	}

.download-health-stat--wide {
	grid-column: 1 / -1;
}

	.download-health-label {
		color: var(--ui-text-secondary, rgba(212, 212, 212, 0.72));
		font-size: 0.76rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.download-health-value {
		color: var(--ui-text-primary, rgba(245, 245, 245, 0.96));
		font-weight: 500;
		font-size: 0.9rem;
	}

.download-health-stat--wide .download-health-value {
	font-size: 13px;
	color: var(--ui-text-secondary, rgba(212, 212, 212, 0.82));
	word-break: break-all;
}

.download-health-value.connected {
	color: var(--ui-status-success, rgba(236, 236, 236, 0.94));
}

	.download-health-btn {
		all: unset;
		cursor: pointer;
		padding: 0.46rem 0.72rem;
		border-radius: 8px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: transparent;
		color: var(--ui-text-primary, rgba(245, 245, 245, 0.92));
		font-size: 0.82rem;
		font-weight: 500;
	transition:
		border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
		background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
		transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.download-health-btn:hover {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		background: var(--ui-surface-interactive, rgba(255, 255, 255, 0.055));
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
	background: var(--ui-surface-raised, rgba(255, 255, 255, 0.055));
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
	color: var(--ui-text-primary, #fff);
	white-space: nowrap;
}

.download-progress-compact-count {
	font-variant-numeric: tabular-nums;
}

.download-progress-compact-toggle {
	background: none;
	border: none;
	color: var(--ui-text-muted, #888);
	cursor: pointer;
	font-size: 12px;
	padding: 2px 6px;
	border-radius: 4px;
	transition: color 0.2s;
}

.download-progress-compact-toggle:hover {
	color: var(--ui-text-primary, #fff);
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
	color: var(--ui-text-secondary, #ccc);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	min-width: 0;
}

.download-progress-compact-bar {
	flex: 0 0 60px;
	height: 4px;
	background: var(--ui-accent-surface, rgba(197, 139, 58, 0.12));
	border-radius: 2px;
	overflow: hidden;
}

.download-progress-compact-bar-fill {
	height: 100%;
	background: var(--ui-accent, rgba(197, 139, 58, 0.92));
	border-radius: 2px;
	transition: width var(--ui-motion-medium, 200ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
}

.download-progress-compact-percent {
	font-size: 11px;
	color: var(--ui-text-muted, #888);
	min-width: 32px;
	text-align: right;
}

.download-progress-compact-more {
	font-size: 11px;
	color: var(--ui-text-muted, #666);
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
