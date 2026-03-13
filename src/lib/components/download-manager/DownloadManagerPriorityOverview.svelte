<script lang="ts">
	import { ClipboardCopy, RefreshCw, RotateCcw, Square } from 'lucide-svelte';

	let {
		stats,
		processingJobs,
		attentionPreviewJobs,
		queuedJobs,
		queuedPreviewJobs,
		isJobActionPending,
		handlePauseJob,
		handleCancelJob,
		handleResumePausedJob,
		handleRetryJob,
		handleCopyFailureReport,
		canPauseAny,
		canStopAny,
		canResumeAny,
		isActionPending,
		actionKeys,
		handlePauseAllActive,
		handleStopAllActive,
		handleResumeAll,
		handleManualRefresh,
		showDetailedSections,
		toggleDetailedSections
	} = $props();
</script>

<div class="section section--priority">
	<div class="section-title section-title-main">
		<span>Priority Overview</span>
	</div>
	<div class="priority-grid">
		<div class="priority-column">
			<div class="priority-column__header">
				<h4 class="priority-column__title">Active Now</h4>
				<span class="section-count">{processingJobs.length}</span>
			</div>
			{#if processingJobs.length === 0}
				<p class="priority-empty">No active downloads.</p>
			{:else}
				<div class="priority-list">
					{#each processingJobs as job (job.id)}
						{@const jobPending = isJobActionPending(job.id)}
						<div class="priority-item">
							<div class="priority-item__main">
								<p class="priority-item__title">{job.job.trackTitle || job.job.albumTitle || 'Unknown'}</p>
								<p class="priority-item__meta">
									{job.job.artistName || 'Unknown Artist'} • {Math.round(job.progress * 100)}%
								</p>
							</div>
							<div class="detail-actions">
								<button
									type="button"
									class="item-action-btn"
									onclick={() => handlePauseJob(job)}
									disabled={jobPending}
								>
									<Square size={12} />
									<span>{jobPending ? 'Pausing…' : 'Pause'}</span>
								</button>
								<button
									type="button"
									class="item-action-btn item-action-btn--warning"
									onclick={() => handleCancelJob(job)}
									disabled={jobPending}
								>
									<Square size={12} />
									<span>{jobPending ? 'Stopping…' : 'Stop'}</span>
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="priority-column">
			<div class="priority-column__header">
				<h4 class="priority-column__title">Needs Attention</h4>
				<span class="section-count">{attentionPreviewJobs.length}</span>
			</div>
			{#if attentionPreviewJobs.length === 0}
				<p class="priority-empty">No blocked items.</p>
			{:else}
				<div class="priority-list">
					{#each attentionPreviewJobs as job (job.id)}
						{@const jobPending = isJobActionPending(job.id)}
						<div class="priority-item">
							<div class="priority-item__main">
								<p class="priority-item__title">{job.job.trackTitle || job.job.albumTitle || 'Unknown'}</p>
								<p class="priority-item__meta">
									{job.status === 'paused'
										? 'Paused'
										: job.status === 'cancelled'
											? 'Cancelled'
											: job.error || 'Failed'}
								</p>
							</div>
							<div class="detail-actions">
								<button
									type="button"
									class="item-action-btn item-action-btn--primary"
									onclick={() => {
										if (job.status === 'paused') {
											void handleResumePausedJob(job);
											return;
										}
										void handleRetryJob(job);
									}}
									disabled={jobPending}
								>
									<RotateCcw size={12} />
									<span>{jobPending ? 'Working…' : job.status === 'paused' ? 'Resume' : 'Retry'}</span>
								</button>
								<button
									type="button"
									class="item-action-btn"
									onclick={() => handleCopyFailureReport(job)}
									disabled={jobPending}
								>
									<ClipboardCopy size={12} />
									<span>{jobPending ? 'Copying…' : 'Report'}</span>
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="priority-column">
			<div class="priority-column__header">
				<h4 class="priority-column__title">Up Next</h4>
				<span class="section-count">{queuedJobs.length}</span>
			</div>
			{#if queuedPreviewJobs.length === 0}
				<p class="priority-empty">Queue is empty.</p>
			{:else}
				<div class="priority-list">
					{#each queuedPreviewJobs as job (job.id)}
						{@const jobPending = isJobActionPending(job.id)}
						<div class="priority-item">
							<div class="priority-item__main">
								<p class="priority-item__title">{job.job.trackTitle || job.job.albumTitle || 'Unknown'}</p>
								<p class="priority-item__meta">
									{job.job.artistName || 'Unknown Artist'} • {job.job.type === 'album' ? 'Album' : 'Track'}
								</p>
							</div>
							<div class="detail-actions">
								<button
									type="button"
									class="item-action-btn item-action-btn--warning"
									onclick={() => handleCancelJob(job)}
									disabled={jobPending}
								>
									<Square size={12} />
									<span>{jobPending ? 'Stopping…' : 'Stop'}</span>
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
	{#if stats.total === 0}
		<div class="priority-empty-state">
			<p>No downloads yet. Queue a track or album from Search to start.</p>
			<a href="/" class="empty-cta-btn">Open Search</a>
		</div>
	{/if}
	<div class="priority-bulk-actions">
		<button
			onclick={handlePauseAllActive}
			class="control-btn control-btn--secondary"
			type="button"
			disabled={!canPauseAny || isActionPending(actionKeys.bulkPause)}
		>
			<Square size={14} />
			<span>{isActionPending(actionKeys.bulkPause) ? 'Pausing…' : 'Pause Active'}</span>
		</button>
		<button
			onclick={handleStopAllActive}
			class="control-btn control-btn--warning"
			type="button"
			disabled={!canStopAny || isActionPending(actionKeys.bulkStop)}
		>
			<Square size={14} />
			<span>{isActionPending(actionKeys.bulkStop) ? 'Stopping…' : 'Stop Active'}</span>
		</button>
		<button
			onclick={handleResumeAll}
			class="control-btn control-btn--primary"
			type="button"
			disabled={!canResumeAny || isActionPending(actionKeys.bulkResume)}
		>
			<RotateCcw size={14} />
			<span>{isActionPending(actionKeys.bulkResume) ? 'Resuming…' : 'Resume Blocked'}</span>
		</button>
		<button
			onclick={handleManualRefresh}
			class="control-btn control-btn--secondary"
			type="button"
			disabled={isActionPending(actionKeys.refresh)}
		>
			<RefreshCw size={14} />
			<span>{isActionPending(actionKeys.refresh) ? 'Refreshing…' : 'Refresh'}</span>
		</button>
	</div>
	<div class="priority-overview-actions">
		<button type="button" class="control-btn control-btn--secondary" onclick={toggleDetailedSections}>
			{showDetailedSections ? 'Hide timeline details' : 'Show timeline details'}
		</button>
	</div>
</div>
