<script lang="ts">
	import { ChevronDown, ChevronUp, ClipboardCopy, RefreshCw, RotateCcw, Square, Trash2 } from 'lucide-svelte';
	import type { QueueJob } from '$lib/features/download-manager/model';

	type JobTypeFilter = 'all' | 'albums' | 'tracks';

	let {
		pageMode,
		showDetailedSections,
		stats,
		processingJobs,
		queuedJobs,
		completedJobs,
		resumableJobs,
		activeSectionOpen,
		queueSectionOpen,
		failedSectionOpen,
		toggleSection,
		isJobActionPending,
		handlePauseJob,
		handleCancelJob,
		handleResumePausedJob,
		handleRetryJob,
		handleCopyFailureReport,
		handleRemoveJob,
		handleClearFailed,
		actionKeys,
		isActionPending
	} = $props();

	let queueTypeFilter = $state<JobTypeFilter>('all');
	let completedTypeFilter = $state<JobTypeFilter>('all');
	let expandedJobId = $state<string | null>(null);

	const matchesTypeFilter = (job: QueueJob, filter: JobTypeFilter): boolean => {
		if (filter === 'all') return true;
		return filter === 'albums' ? job.job.type === 'album' : job.job.type === 'track';
	};
	let filteredQueuedJobs = $derived(queuedJobs.filter((job: QueueJob) => matchesTypeFilter(job, queueTypeFilter)));
	let filteredCompletedJobs = $derived(
		completedJobs.filter((job: QueueJob) => matchesTypeFilter(job, completedTypeFilter))
	);
	let completedAlbums = $derived(completedJobs.filter((j: QueueJob) => j.job.type === 'album').length);
	let completedFiles = $derived(
		completedJobs.reduce((sum: number, job: QueueJob) => {
			if (job.job.type === 'album') {
				const count = job.completedTracks ?? job.trackCount ?? 0;
				return sum + count;
			}
			return sum + 1;
		}, 0)
	);
</script>

				{#if !pageMode || showDetailedSections}
				<!-- Current/Active Downloads -->
				{#if stats.running > 0}
					<div class="section section--active current-section">
						<button
							type="button"
							class="section-toggle"
							onclick={() => {
								if (!pageMode) toggleSection('active');
							}}
							aria-expanded={activeSectionOpen}
						>
							<span class="section-title-main section-title">
								<span class="section-title-icon rotating"><RefreshCw size={14} strokeWidth={2} /></span>
								<span>Active Downloads</span>
							</span>
							<span class="section-title-actions">
								<span class="section-count">{stats.running}</span>
								{#if !pageMode}
									<span class="section-chevron">
										{#if activeSectionOpen}
											<ChevronUp size={16} />
										{:else}
											<ChevronDown size={16} />
										{/if}
									</span>
								{/if}
							</span>
						</button>
						{#if activeSectionOpen}
							<div class="current-items">
								{#each processingJobs as job (job.id)}
								{@const jobPending = isJobActionPending(job.id)}
								<div class="current-item">
									<div class="current-item-header">
										<div class="current-item-title">
											{job.job.type === 'track' ? job.job.trackTitle : job.job.albumTitle || 'Unknown Album'}
										</div>
										<div class="item-action-row">
											<span class="badge badge-processing">PROCESSING</span>
											<button
												type="button"
												class="item-action-btn"
												title="Pause this download"
												onclick={() => handlePauseJob(job)}
												disabled={jobPending}
											>
												<Square size={12} />
												<span>{jobPending ? 'Pausing…' : 'Pause'}</span>
											</button>
											<button
												type="button"
												class="item-action-btn item-action-btn--warning"
												title="Stop this download"
												onclick={() => handleCancelJob(job)}
												disabled={jobPending}
											>
												<Square size={12} />
												<span>{jobPending ? 'Stopping…' : 'Stop'}</span>
											</button>
										</div>
									</div>
									{#if job.job.type === 'album'}
										<div class="current-item-meta">
											<span>{job.job.artistName}</span>
											<span class="meta-separator">•</span>
											<span class="meta-album-progress">{(job.completedTracks || 0)}/{job.trackCount || '?'} tracks</span>
											<span class="meta-separator">•</span>
											<span>{job.job.quality}</span>
										</div>
									{:else}
										<div class="current-item-meta">
											<span>{job.job.artistName}</span>
											{#if job.job.albumTitle}
												<span class="meta-separator">•</span>
												<span>{job.job.albumTitle}</span>
											{/if}
											<span class="meta-separator">•</span>
											<span>{job.job.quality}</span>
										</div>
									{/if}
									<div class="progress-bar">
										<div class="progress-fill" style="width: {job.progress * 100}%"></div>
									</div>
									<div class="progress-text">{Math.round(job.progress * 100)}%</div>
								</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}

				<!-- Queued items -->
				{#if stats.queued > 0}
					<div class="section section--queue">
						<button
							type="button"
							class="section-toggle"
							onclick={() => {
								if (!pageMode) toggleSection('queue');
							}}
							aria-expanded={queueSectionOpen}
						>
							<span class="section-title-main section-title">
								<span>Queue</span>
							</span>
							<span class="section-title-actions">
								<span class="section-count">{stats.queued}</span>
								{#if !pageMode}
									<span class="section-chevron">
										{#if queueSectionOpen}
											<ChevronUp size={16} />
										{:else}
											<ChevronDown size={16} />
										{/if}
									</span>
								{/if}
							</span>
						</button>
						{#if queueSectionOpen}
							<div class="section-filter-row">
								<div class="section-filter-label">Show</div>
								<div class="filter-pills" role="tablist" aria-label="Queue filters">
									<button
										type="button"
										class="filter-pill"
										class:is-active={queueTypeFilter === 'all'}
										onclick={() => (queueTypeFilter = 'all')}
									>
										All
									</button>
									<button
										type="button"
										class="filter-pill"
										class:is-active={queueTypeFilter === 'albums'}
										onclick={() => (queueTypeFilter = 'albums')}
									>
										Albums
									</button>
									<button
										type="button"
										class="filter-pill"
										class:is-active={queueTypeFilter === 'tracks'}
										onclick={() => (queueTypeFilter = 'tracks')}
									>
										Tracks
									</button>
								</div>
							</div>
							<div class="queue-list">
								{#if filteredQueuedJobs.length === 0}
									<div class="filter-empty-state">
										No {queueTypeFilter === 'all' ? 'queued' : queueTypeFilter} jobs in queue right now.
									</div>
								{:else}
									{#each filteredQueuedJobs.slice(0, 5) as job (job.id)}
										{@const jobPending = isJobActionPending(job.id)}
										{@const queueItemExpanded = expandedJobId === job.id}
										<div class="queue-item-card">
											{#if pageMode}
												<div class="queue-item-click">
													<div class="queue-item-main">
														<div class="queue-item-info">
															<div class="queue-item-title">{job.job.trackTitle || job.job.albumTitle || 'Unknown'}</div>
															<div class="queue-item-artist">{job.job.artistName || 'Unknown Artist'}</div>
															{#if job.job.albumTitle && job.job.trackTitle}
																<div class="queue-item-album">{job.job.albumTitle}</div>
															{/if}
														</div>
													</div>
													<div class="queue-item-summary">
														<span>{job.job.type === 'track' ? 'Track' : 'Album'}</span>
														<span class="meta-separator">•</span>
														<span>{job.job.quality || 'Lossless'}</span>
														{#if job.job.type === 'album' && job.trackCount}
															<span class="meta-separator">•</span>
															<span>{job.completedTracks || 0}/{job.trackCount} tracks</span>
														{/if}
													</div>
												</div>
											{:else}
												<button
													type="button"
													class="queue-item-click"
													onclick={() => {
														expandedJobId = expandedJobId === job.id ? null : job.id;
													}}
													aria-expanded={queueItemExpanded}
												>
													<div class="queue-item-main">
														<div class="queue-item-info">
															<div class="queue-item-title">{job.job.trackTitle || job.job.albumTitle || 'Unknown'}</div>
															<div class="queue-item-artist">{job.job.artistName || 'Unknown Artist'}</div>
															{#if job.job.albumTitle && job.job.trackTitle}
																<div class="queue-item-album">{job.job.albumTitle}</div>
															{/if}
														</div>
														<span class="expand-icon">
															{#if queueItemExpanded}
																<ChevronUp size={16} />
															{:else}
																<ChevronDown size={16} />
															{/if}
														</span>
													</div>
													<div class="queue-item-summary">
														<span>{job.job.type === 'track' ? 'Track' : 'Album'}</span>
														<span class="meta-separator">•</span>
														<span>{job.job.quality || 'Lossless'}</span>
														{#if job.job.type === 'album' && job.trackCount}
															<span class="meta-separator">•</span>
															<span>{job.completedTracks || 0}/{job.trackCount} tracks</span>
														{/if}
													</div>
												</button>
											{/if}
											{#if queueItemExpanded}
												<div class="queue-item-details">
													<div class="detail-row">
														<span class="detail-label">Status:</span>
														<span class="detail-value">{job.status}</span>
													</div>
													{#if job.createdAt}
														<div class="detail-row">
															<span class="detail-label">Added:</span>
															<span class="detail-value">{new Date(job.createdAt).toLocaleTimeString()}</span>
														</div>
													{/if}
													{#if job.startedAt}
														<div class="detail-row">
															<span class="detail-label">Duration:</span>
															<span class="detail-value">{Math.round((job.completedAt || Date.now()) - job.startedAt) / 1000}s</span>
														</div>
													{/if}
													<div class="detail-actions">
														<button
															type="button"
															class="item-action-btn"
															onclick={() => {
																void handlePauseJob(job);
															}}
															disabled={jobPending}
														>
															<Square size={12} />
															<span>{jobPending ? 'Pausing…' : 'Pause'}</span>
														</button>
														<button
															type="button"
															class="item-action-btn item-action-btn--warning"
															onclick={() => {
																void handleCancelJob(job);
															}}
															disabled={jobPending}
														>
															<Square size={12} />
															<span>{jobPending ? 'Stopping…' : 'Stop'}</span>
														</button>
													</div>
												</div>
											{/if}
										</div>
									{/each}
								{/if}

								{#if filteredQueuedJobs.length > 5}
									<div class="queue-more-hint">
										+{filteredQueuedJobs.length - 5} more in queue
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Completed -->
				{#if stats.completed > 0 && !pageMode}
					<div class="section section--completed">
						<h4 class="section-title">
							<span>Completed</span>
							<span class="section-count">{stats.completed}</span>
						</h4>
						<div class="completion-summary">
							{#if completedAlbums > 0}
								<p>
									{completedAlbums} album{completedAlbums !== 1 ? 's' : ''} • {completedFiles} file{completedFiles !== 1 ? 's' : ''} successfully downloaded
								</p>
							{:else}
								<p>{completedFiles} file{completedFiles !== 1 ? 's' : ''} successfully downloaded</p>
							{/if}
						</div>
						<div class="section-filter-row">
							<div class="section-filter-label">Show</div>
							<div class="filter-pills" role="tablist" aria-label="Completed filters">
								<button
									type="button"
									class="filter-pill"
									class:is-active={completedTypeFilter === 'all'}
									onclick={() => (completedTypeFilter = 'all')}
								>
									All
								</button>
								<button
									type="button"
									class="filter-pill"
									class:is-active={completedTypeFilter === 'albums'}
									onclick={() => (completedTypeFilter = 'albums')}
								>
									Albums
								</button>
								<button
									type="button"
									class="filter-pill"
									class:is-active={completedTypeFilter === 'tracks'}
									onclick={() => (completedTypeFilter = 'tracks')}
								>
									Tracks
								</button>
							</div>
						</div>
						<div class="completed-list">
							{#if filteredCompletedJobs.length === 0}
								<div class="filter-empty-state">
									No completed {completedTypeFilter === 'all' ? '' : `${completedTypeFilter} `}jobs yet.
								</div>
							{:else}
								{#each filteredCompletedJobs.slice(0, 5) as job (job.id)}
									{@const jobPending = isJobActionPending(job.id)}
									<div class="completed-item">
										<div class="completed-item-header">
											<div class="completed-item-title">
												{job.job.trackTitle || job.job.albumTitle || 'Unknown'}
											</div>
											<button
												type="button"
												class="item-action-btn"
												title="Remove from history"
												onclick={() => handleRemoveJob(job)}
												disabled={jobPending}
											>
												<Trash2 size={12} />
												<span>{jobPending ? 'Removing…' : 'Dismiss'}</span>
											</button>
										</div>
										<div class="completed-item-meta">
											<span>{job.job.artistName || 'Unknown Artist'}</span>
											<span class="meta-separator">•</span>
											<span>{job.job.type === 'album' ? 'Album' : 'Track'}</span>
											{#if job.completedAt}
												<span class="meta-separator">•</span>
												<span>{new Date(job.completedAt).toLocaleTimeString()}</span>
											{/if}
										</div>
									</div>
								{/each}
							{/if}

							{#if filteredCompletedJobs.length > 5}
								<div class="queue-more-hint">
									+{filteredCompletedJobs.length - 5} more completed
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Failed / Cancelled -->
				{#if resumableJobs.length > 0}
					<div class="section section--attention">
						<button
							type="button"
							class="section-toggle"
							onclick={() => {
								if (!pageMode) toggleSection('failed');
							}}
							aria-expanded={failedSectionOpen}
						>
							<span class="section-title-main section-title error-title">
								<span>Needs Attention</span>
							</span>
							<span class="section-title-actions">
								<span class="section-count">{resumableJobs.length}</span>
								{#if !pageMode}
									<span class="section-chevron">
										{#if failedSectionOpen}
											<ChevronUp size={16} />
										{:else}
											<ChevronDown size={16} />
										{/if}
									</span>
								{/if}
							</span>
						</button>
						{#if failedSectionOpen}
							<div class="failed-list">
								{#each resumableJobs.slice(0, 4) as job (job.id)}
									{@const jobPending = isJobActionPending(job.id)}
									{@const failedItemExpanded = expandedJobId === job.id}
									<div class="failed-item-card">
										{#if pageMode}
											<div class="failed-item-click">
												<div class="failed-item-main">
													<div class="failed-item-info">
														<div class="failed-item-title">
															{job.job.type === 'track' ? job.job.trackTitle : job.job.albumTitle || 'Unknown'}
														</div>
														<div class="failed-item-artist">{job.job.artistName || 'Unknown'}</div>
														<div class="failed-item-error-text">
															{job.status === 'paused'
																? 'Paused by user'
																: job.status === 'cancelled'
																	? 'Cancelled by user'
																	: job.error || 'Unknown error'}
														</div>
													</div>
												</div>
												<div class="failed-item-summary">
													<span>{job.job.type === 'track' ? 'Track' : 'Album'}</span>
													<span class="meta-separator">•</span>
													<span>{job.job.quality || 'Lossless'}</span>
												</div>
											</div>
										{:else}
											<button
												type="button"
												class="failed-item-click"
												onclick={() => {
													expandedJobId = expandedJobId === job.id ? null : job.id;
												}}
												aria-expanded={failedItemExpanded}
											>
												<div class="failed-item-main">
													<div class="failed-item-info">
														<div class="failed-item-title">
															{job.job.type === 'track' ? job.job.trackTitle : job.job.albumTitle || 'Unknown'}
														</div>
														<div class="failed-item-artist">{job.job.artistName || 'Unknown'}</div>
														<div class="failed-item-error-text">
															{job.status === 'paused'
																? 'Paused by user'
																: job.status === 'cancelled'
																	? 'Cancelled by user'
																	: job.error || 'Unknown error'}
														</div>
													</div>
													<span class="expand-icon">
														{#if failedItemExpanded}
															<ChevronUp size={16} />
														{:else}
															<ChevronDown size={16} />
														{/if}
													</span>
												</div>
												<div class="failed-item-summary">
													<span>{job.job.type === 'track' ? 'Track' : 'Album'}</span>
													<span class="meta-separator">•</span>
													<span>{job.job.quality || 'Lossless'}</span>
												</div>
											</button>
										{/if}
										{#if failedItemExpanded}
											<div class="failed-item-details">
												<div class="detail-row">
													<span class="detail-label">Status:</span>
													<span class="detail-value">{job.status}</span>
												</div>
												<div class="detail-row">
													<span class="detail-label">Job ID:</span>
													<span class="detail-value detail-value--mono">{job.id}</span>
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
														<span>{jobPending ? 'Resuming…' : job.status === 'paused' ? 'Resume' : 'Retry'}</span>
													</button>
													<button
														type="button"
														class="item-action-btn"
														onclick={() => {
															void handleCopyFailureReport(job);
														}}
														disabled={jobPending}
													>
														<ClipboardCopy size={12} />
														<span>{jobPending ? 'Copying…' : 'Report'}</span>
													</button>
													<button
														type="button"
														class="item-action-btn item-action-btn--danger"
														onclick={() => {
															void handleRemoveJob(job);
														}}
														disabled={jobPending}
													>
														<Trash2 size={12} />
														<span>{jobPending ? 'Removing…' : 'Dismiss'}</span>
													</button>
												</div>
											</div>
										{/if}
									</div>
								{/each}

								{#if resumableJobs.length > 4}
									<div class="queue-more-hint">
										+{resumableJobs.length - 4} more items
									</div>
								{/if}
							</div>
							<div class="failed-actions">
								<button
									onclick={handleClearFailed}
									class="control-btn control-btn--danger"
									type="button"
									title="Clear failed and cancelled download history"
									disabled={isActionPending(actionKeys.clearHistory)}
								>
									<Trash2 size={14} />
									<span>
										{isActionPending(actionKeys.clearHistory) ? 'Clearing…' : 'Clear History'}
									</span>
								</button>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Empty state -->
				{#if stats.total === 0}
					<div class="download-manager-empty">
						<p class="empty-message">No downloads yet</p>
						<p class="empty-hint">Queue a track or album and it will appear here in real time.</p>
						<div class="empty-cta-actions">
							<a href="/" class="empty-cta-btn">Open Search</a>
						</div>
						<div class="empty-steps">
							<div class="empty-step">1. Open an album page and click <strong>Download Album</strong>.</div>
							<div class="empty-step">2. Open a track page and click <strong>Download</strong>.</div>
						</div>
					</div>
					{/if}
					{/if}
