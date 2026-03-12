<script lang="ts">
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { Loader } from 'lucide-svelte';

	$: activeDownloads = $downloadUiStore.tasks.filter((task) => task.status === 'running');
	$: hasServerDownloads = activeDownloads.some((task) => task.storage === 'server');
	$: headerLabel = hasServerDownloads ? 'Saving to server' : 'Downloading';

	const formatPhaseLabel = (task: (typeof activeDownloads)[number]) => {
		if (task.storage === 'server') {
			switch (task.phase) {
				case 'uploading':
					return 'Uploading to server';
				case 'embedding':
					return 'Finalizing audio';
				default:
					return 'Downloading source';
			}
		}
		if (task.phase === 'embedding') {
			return 'Finalizing audio';
		}
		return null;
	};
</script>

<!-- Standalone Download Progress - Bottom of screen, independent of log -->
{#if activeDownloads.length > 0}
	<div class="download-progress-standalone">
		<div class="download-progress-standalone-header">
			<Loader size={16} />
			<span class="download-progress-title">
				<span class="download-progress-title-label">{headerLabel}</span>
				<span class="download-progress-title-count">
					{activeDownloads.length} track{activeDownloads.length > 1 ? 's' : ''}
				</span>
			</span>
		</div>

		<div class="download-progress-standalone-list">
			{#each activeDownloads.slice(0, 5) as task (task.id)}
				{@const phaseLabel = formatPhaseLabel(task)}
				<div class="download-progress-item">
					<div class="download-progress-item-info">
						<span class="download-progress-item-title" title="{task.title}">{task.title}</span>
						{#if task.subtitle}
							<span class="download-progress-item-subtitle">{task.subtitle}</span>
						{/if}
						{#if phaseLabel}
							<span class="download-progress-item-phase">{phaseLabel}</span>
						{/if}
					</div>
					<div class="download-progress-item-progress">
						<div class="download-progress-bar">
							<div
								class="download-progress-bar-fill"
								style="width: {Math.max(0, Math.min(100, task.progress * 100))}%"
							></div>
						</div>
						<span class="download-progress-percent">{Math.round(task.progress * 100)}%</span>
					</div>
				</div>
			{/each}
			{#if activeDownloads.length > 5}
				<div class="download-progress-more">
					+{activeDownloads.length - 5} more...
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.download-progress-standalone {
		position: fixed;
		bottom: calc(20px + var(--player-height, 0px) + env(safe-area-inset-bottom, 0px));
		left: 1rem;
		right: 1rem;
		background: rgba(8, 8, 8, 0.96);
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: var(--ui-radius-md, 10px);
		padding: 16px;
		max-width: none;
		z-index: 1000;
		animation: slideUp var(--ui-motion-medium, 200ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.download-progress-standalone-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}



	.download-progress-title {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 15px;
		font-weight: 600;
		color: #fff;
		white-space: nowrap;
	}

	.download-progress-title-count {
		font-variant-numeric: tabular-nums;
	}

	.download-progress-standalone-list {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}

	.download-progress-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 12px;
		background: rgba(255, 255, 255, 0.04);
		border-radius: var(--ui-radius-sm, 8px);
		border: 1px solid rgba(255, 255, 255, 0.12);
	}

	@media (max-width: 1100px) {
		.download-progress-standalone-list {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 620px) {
		.download-progress-standalone-list {
			grid-template-columns: 1fr;
		}
	}

	.download-progress-item-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.download-progress-item-title {
		font-size: 14px;
		font-weight: 500;
		color: #fff;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.download-progress-item-subtitle {
		font-size: 12px;
		color: rgba(212, 212, 212, 0.78);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.download-progress-item-phase {
		font-size: 11px;
		color: rgba(212, 212, 212, 0.68);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.download-progress-item-progress {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.download-progress-bar {
		width: 84px;
		height: 4px;
		background: rgba(255, 255, 255, 0.18);
		border-radius: 2px;
		overflow: hidden;
	}

	.download-progress-bar-fill {
		height: 100%;
		background: rgba(255, 255, 255, 0.92);
		border-radius: 2px;
		transition: width var(--ui-motion-medium, 200ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	.download-progress-percent {
		font-size: 12px;
		font-weight: 500;
		color: rgba(224, 224, 224, 0.9);
		min-width: 36px;
		text-align: right;
	}

	.download-progress-more {
		font-size: 11px;
		color: rgba(170, 170, 170, 0.8);
		text-align: center;
		padding: 4px 0;
		font-style: italic;
	}

	@media (max-width: 480px) {
		.download-progress-standalone {
			left: 0.75rem;
			right: 0.75rem;
		}

		.download-progress-item {
			flex-direction: column;
			align-items: flex-start;
			gap: 6px;
		}

		.download-progress-item-progress {
			width: 100%;
			justify-content: space-between;
		}

		.download-progress-bar {
			flex: 1;
		}
	}

	@media (max-width: 320px) {
		.download-progress-standalone {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.download-progress-standalone,
		.download-progress-standalone *,
		.download-progress-bar-fill {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
