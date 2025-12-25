<script lang="ts">
	import { activeTrackDownloads } from '$lib/stores/downloadUi';
	import { Loader } from 'lucide-svelte';
</script>

<!-- Standalone Download Progress - Bottom of screen, independent of log -->
{#if $activeTrackDownloads.length > 0}
	<div class="download-progress-standalone">
		<div class="download-progress-standalone-header">
			<Loader size={16} class="download-progress-icon" />
			<span class="download-progress-title">
				Downloading {$activeTrackDownloads.length} track{$activeTrackDownloads.length > 1 ? 's' : ''}
			</span>
		</div>

		<div class="download-progress-standalone-list">
			{#each $activeTrackDownloads.slice(0, 5) as task (task.id)}
				<div class="download-progress-item">
					<div class="download-progress-item-info">
						<span class="download-progress-item-title" title="{task.title}">{task.title}</span>
						{#if task.subtitle}
							<span class="download-progress-item-subtitle">{task.subtitle}</span>
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
			{#if $activeTrackDownloads.length > 5}
				<div class="download-progress-more">
					+{$activeTrackDownloads.length - 5} more...
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.download-progress-standalone {
		position: fixed;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(11, 16, 26, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		padding: 16px;
		min-width: 320px;
		max-width: 600px;
		backdrop-filter: blur(10px);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		z-index: 1000;
		animation: slideUp 0.3s ease-out;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}

	.download-progress-standalone-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}



	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.download-progress-title {
		font-size: 14px;
		font-weight: 600;
		color: #fff;
	}

	.download-progress-standalone-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.download-progress-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 12px;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 8px;
		border: 1px solid rgba(255, 255, 255, 0.05);
	}

	.download-progress-item-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.download-progress-item-title {
		font-size: 13px;
		font-weight: 500;
		color: #fff;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.download-progress-item-subtitle {
		font-size: 11px;
		color: #aaa;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.download-progress-item-progress {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.download-progress-bar {
		width: 80px;
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

	.download-progress-more {
		font-size: 11px;
		color: #666;
		text-align: center;
		padding: 4px 0;
		font-style: italic;
	}

	/* Responsive: stack items on smaller screens */
	@media (max-width: 480px) {
		.download-progress-standalone {
			left: 10px;
			right: 10px;
			transform: none;
			min-width: auto;
			max-width: none;
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

	/* Hide on very small screens */
	@media (max-width: 320px) {
		.download-progress-standalone {
			display: none;
		}
	}
</style>