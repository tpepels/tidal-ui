<script lang="ts">
	import { downloadLogStore } from '$lib/stores/downloadLog';
	import { X, ChevronDown, Copy, Trash2 } from 'lucide-svelte';

	let scrollContainer: HTMLDivElement;

	function autoScroll() {
		if (scrollContainer) {
			// Scroll to bottom immediately
			scrollContainer.scrollTop = scrollContainer.scrollHeight;
		}
	}

	// Auto-scroll on new entries
	$: if ($downloadLogStore.entries.length > 0) {
		// Use requestAnimationFrame to ensure DOM has been updated
		requestAnimationFrame(() => {
			autoScroll();
		});
	}

	$: console.log('[DownloadLog] Visibility:', $downloadLogStore.isVisible, 'Entries:', $downloadLogStore.entries.length);

	function copyLogs() {
		const logText = $downloadLogStore.entries
			.map((entry) => `[${entry.timestamp.toLocaleTimeString()}] [${entry.level.toUpperCase()}] ${entry.message}`)
			.join('\n');
		navigator.clipboard.writeText(logText);
	}
</script>

<div class="download-log-container" class:is-visible={$downloadLogStore.isVisible}>
	<div class="download-log-panel">
		<div class="download-log-header">
			<h3 class="download-log-title">Download Log</h3>
			<div class="download-log-actions">
				<button
					type="button"
					class="download-log-btn"
					title="Copy logs"
					onclick={copyLogs}
				>
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
				<button
					type="button"
					class="download-log-btn"
					title="Close"
					onclick={() => downloadLogStore.hide()}
				>
					<X size={16} />
				</button>
			</div>
		</div>

		<div class="download-log-content" bind:this={scrollContainer}>
			{#each $downloadLogStore.entries as entry (entry.id)}
				<div class="download-log-entry download-log-entry--{entry.level}">
					<span class="download-log-time">{entry.timestamp.toLocaleTimeString()}</span>
					<span class="download-log-level">[{entry.level.toUpperCase()}]</span>
					<span class="download-log-message">{entry.message}</span>
				</div>
			{/each}
			<div style="flex-shrink: 0; height: 1px;"></div>
		</div>
	</div>
</div>

<style>
	.download-log-container {
		position: fixed;
		bottom: 0;
		right: 0;
		left: 0;
		max-height: 0;
		overflow: hidden;
		transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		z-index: 9999;
	}

	.download-log-container.is-visible {
		max-height: 300px;
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
		overflow-y: scroll;
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
</style>
