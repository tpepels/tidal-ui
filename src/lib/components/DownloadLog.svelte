<script lang="ts">
	import { downloadLogStore } from '$lib/stores/downloadLog';
	import { downloadUiStore, activeTrackDownloads, completedTrackDownloads, erroredTrackDownloads } from '$lib/stores/downloadUi';
	import { X, Copy, Trash2, CheckCircle, XCircle, Loader, Pause, Play, Heart } from 'lucide-svelte';
	import { tick, onMount } from 'svelte';

	let scrollContainer: HTMLDivElement | null = null;
	let healthData: any = null;
	let loadingHealth = false;

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	function isNearBottom(el: HTMLElement, px = 24) {
		return el.scrollTop + el.clientHeight >= el.scrollHeight - px;
	}

	let cleanup: (() => void) | null = null;

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

	async function fetchHealth() {
		loadingHealth = true;
		try {
			const res = await fetch('/api/download-track/health');
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
				headers: { 'Content-Type': 'application/json' },
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

<div class="download-log-container" class:is-visible={$downloadLogStore.isVisible}>
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

		<!-- Progress Summary Section -->
		{#if $activeTrackDownloads.length > 0 || $completedTrackDownloads.length > 0 || $erroredTrackDownloads.length > 0}
			<div class="download-progress-summary">
				<h4 class="download-progress-title">Download Progress</h4>
				<div class="download-progress-scroll">
					<!-- Active Downloads -->
					{#if $activeTrackDownloads.length > 0}
						<div class="download-progress-section">
							<h5 class="download-progress-section-title">
								<Loader size={16} class="download-progress-icon download-progress-icon--active" />
								Active Downloads ({$activeTrackDownloads.length})
							</h5>
							<div class="download-progress-tasks">
								{#each $activeTrackDownloads as task (task.id)}
									<div class="download-progress-task">
										<div class="download-progress-task-header">
											<span class="download-progress-task-title" title="{task.title}">{task.title}</span>
											{#if task.subtitle}
												<span class="download-progress-task-subtitle">{task.subtitle}</span>
											{/if}
										</div>
										<div class="download-progress-task-progress">
											<div class="download-progress-bar">
												<div class="download-progress-bar-fill" style="width: {task.progress * 100}%"></div>
											</div>
											<span class="download-progress-percent">{Math.round(task.progress * 100)}%</span>
										</div>
										{#if task.totalBytes}
											<div class="download-progress-task-bytes">
												{formatBytes(task.receivedBytes)} / {formatBytes(task.totalBytes)}
											</div>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Completed Downloads -->
					{#if $completedTrackDownloads.length > 0}
						<div class="download-progress-section">
							<h5 class="download-progress-section-title">
								<CheckCircle size={16} class="download-progress-icon download-progress-icon--completed" />
								Completed ({$completedTrackDownloads.length})
							</h5>
						</div>
					{/if}

					<!-- Errored Downloads -->
					{#if $erroredTrackDownloads.length > 0}
						<div class="download-progress-section">
							<h5 class="download-progress-section-title">
								<XCircle size={16} class="download-progress-icon download-progress-icon--error" />
								Errors ({$erroredTrackDownloads.length})
							</h5>
							<div class="download-progress-tasks">
								{#each $erroredTrackDownloads as task (task.id)}
									<div class="download-progress-task download-progress-task--error">
										<div class="download-progress-task-header">
											<span class="download-progress-task-title" title="{task.title}">{task.title}</span>
											{#if task.subtitle}
												<span class="download-progress-task-subtitle">{task.subtitle}</span>
											{/if}
										</div>
										{#if task.error}
											<div class="download-progress-task-error">{task.error}</div>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}

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

		z-index: 9999;
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

/* Progress Summary Styles */
.download-progress-summary {
	padding: 16px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	background: rgba(0, 0, 0, 0.2);
	max-height: 200px;
	display: flex;
	flex-direction: column;
}

.download-progress-scroll {
	flex: 1;
	overflow-y: auto;
}

	.download-progress-title {
		margin: 0 0 12px 0;
		font-size: 14px;
		font-weight: 600;
		color: #fff;
		letter-spacing: 0.5px;
	}

	.download-progress-section {
		margin-bottom: 16px;
	}

	.download-progress-section:last-child {
		margin-bottom: 0;
	}

	.download-progress-section-title {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 8px 0;
		font-size: 13px;
		font-weight: 500;
		color: #ccc;
	}

	.download-progress-icon {
		flex-shrink: 0;
	}

	.download-progress-icon--active {
		color: #3b82f6;
		animation: spin 1s linear infinite;
	}

	.download-progress-icon--completed {
		color: #22c55e;
	}

	.download-progress-icon--error {
		color: #ef4444;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.download-progress-tasks {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.download-progress-task {
		padding: 8px 12px;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 6px;
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	.download-progress-task--error {
		border-color: rgba(239, 68, 68, 0.3);
		background: rgba(239, 68, 68, 0.05);
	}

	.download-progress-task-header {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 6px;
	}

	.download-progress-task-title {
		font-size: 13px;
		font-weight: 500;
		color: #fff;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.download-progress-task-subtitle {
		font-size: 11px;
		color: #aaa;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.download-progress-task-progress {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}

	.download-progress-bar {
		flex: 1;
		height: 4px;
		background: rgba(255, 255, 255, 0.2);
		border-radius: 2px;
		overflow: hidden;
	}

	.download-progress-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #3b82f6, #06b6d4);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.download-progress-percent {
		font-size: 11px;
		font-weight: 500;
		color: #ccc;
		min-width: 32px;
		text-align: right;
	}

	.download-progress-task-bytes {
		font-size: 11px;
		color: #888;
		text-align: right;
	}

	.download-progress-task-error {
		font-size: 12px;
		color: #ef4444;
		margin-top: 4px;
		word-break: break-word;
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

.download-health-label {
	color: #ccc;
}

.download-health-value {
	color: #fff;
	font-weight: 500;
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
</style>
