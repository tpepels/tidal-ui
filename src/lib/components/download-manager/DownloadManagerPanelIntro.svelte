<script lang="ts">
	import { Bug, ClipboardCopy, RotateCcw, Square } from 'lucide-svelte';

	let {
		pageMode,
		pollingError,
		pollStatusLabel,
		backendError,
		backendWarning,
		workerWarning,
		isPollingStale,
		lastUpdatedLabel,
		queueSource,
		localMode,
		actionNotice,
		stats,
		pausedCount,
		resumableCount,
		statusHeadline,
		statusSubline,
		activeAverageProgress,
		workerRunning,
		showDetailedSections,
		canPauseAny,
		canStopAny,
		canResumeAny,
		hasFailuresToReport,
		actionKeys,
		isActionPending,
		handlePauseAllActive,
		handleStopAllActive,
		handleResumeAll,
		handleCopyFailureReport,
		handleCreateDebugBundle
	} = $props();
</script>

{#if pollingError}
	<div class="download-manager-error">
		Transport error while polling queue: {pollingError}. {pollStatusLabel}.
	</div>
{/if}

{#if backendError}
	<div class="download-manager-error">
		Queue backend error: {backendError}
	</div>
{/if}

{#if backendWarning}
	<div class="download-manager-warning">
		Queue backend warning: {backendWarning}
	</div>
{/if}

{#if workerWarning}
	<div class="download-manager-warning">
		Worker is not running; queued jobs will not start until the worker is active.
	</div>
{/if}

{#if isPollingStale && !pollingError}
	<div class="download-manager-warning">
		Queue UI may be stale. Last successful update was at {lastUpdatedLabel}.
	</div>
{/if}

{#if queueSource === 'memory' && !localMode}
	<div class="download-manager-warning">
		Redis unavailable; using in-memory queue. UI may be stale if the worker runs in another process.
	</div>
{/if}

{#if actionNotice}
	<div class="download-manager-notice" data-tone={actionNotice.tone}>
		{actionNotice.message}
	</div>
{/if}

<div class="download-status-hero" data-active={stats.running > 0} data-ui-block="key-summary">
	<div class="download-status-hero__main">
		<p class="download-status-hero__eyebrow">Live Session</p>
		<h4>{statusHeadline}</h4>
		<p>{statusSubline}</p>
	</div>
	<div class="download-status-hero__meter">
		<div class="download-status-hero__meter-track">
			<div class="download-status-hero__meter-fill" style={`width: ${activeAverageProgress}%`}></div>
		</div>
		<div class="download-status-hero__meter-meta">
			<span>Average active progress</span>
			<strong>{activeAverageProgress}%</strong>
		</div>
	</div>
	<div class="download-status-hero__chips">
		<span class="download-status-chip" data-tone={workerRunning ? 'ok' : 'warn'}>
			Worker {workerRunning ? 'online' : 'offline'}
		</span>
		<span class="download-status-chip" data-tone={queueSource === 'redis' ? 'ok' : 'neutral'}>
			Queue {queueSource ?? 'unknown'}
		</span>
		{#if isPollingStale}
			<span class="download-status-chip" data-tone="warn">Data stale</span>
		{/if}
	</div>
</div>

{#if !pageMode}
	<div class="download-manager-top-strip">
		<div class="top-strip-item top-strip-item--running">
			<span class="top-strip-label">Running</span>
			<span class="top-strip-value">{stats.running}</span>
		</div>
		<div class="top-strip-item top-strip-item--queued">
			<span class="top-strip-label">Queued</span>
			<span class="top-strip-value">{stats.queued}</span>
		</div>
		<div class="top-strip-item top-strip-item--paused">
			<span class="top-strip-label">Paused</span>
			<span class="top-strip-value">{pausedCount}</span>
		</div>
		<div class="top-strip-item top-strip-item--failed">
			<span class="top-strip-label">Needs Attention</span>
			<span class="top-strip-value">{resumableCount}</span>
		</div>
		<div class="top-strip-item">
			<span class="top-strip-label">Queue source</span>
			<span class="top-strip-value top-strip-value--text">{queueSource ?? 'unknown'}</span>
		</div>
		<div class="top-strip-item">
			<span class="top-strip-label">Last update</span>
			<span class="top-strip-value top-strip-value--text">{lastUpdatedLabel}</span>
		</div>
	</div>
{/if}

{#if !pageMode || showDetailedSections}
	<div class="download-manager-quick-actions" data-ui-block="primary-actions">
		<button
			onclick={handlePauseAllActive}
			class="control-btn control-btn--secondary"
			type="button"
			title="Pause all active and queued jobs"
			disabled={!canPauseAny || isActionPending(actionKeys.bulkPause)}
		>
			<Square size={14} />
			<span>{isActionPending(actionKeys.bulkPause) ? 'Pausing…' : 'Pause Active'}</span>
		</button>
		<button
			onclick={handleStopAllActive}
			class="control-btn control-btn--warning"
			type="button"
			title="Stop all active and queued jobs"
			disabled={!canStopAny || isActionPending(actionKeys.bulkStop)}
		>
			<Square size={14} />
			<span>{isActionPending(actionKeys.bulkStop) ? 'Stopping…' : 'Stop Active'}</span>
		</button>
		<button
			onclick={handleResumeAll}
			class="control-btn control-btn--primary"
			type="button"
			title="Resume all failed or cancelled jobs"
			disabled={!canResumeAny || isActionPending(actionKeys.bulkResume)}
		>
			<RotateCcw size={14} />
			<span>{isActionPending(actionKeys.bulkResume) ? 'Resuming…' : 'Resume Paused/Failed'}</span>
		</button>
		<button
			onclick={() => handleCopyFailureReport()}
			class="control-btn control-btn--secondary"
			type="button"
			title="Copy a failure report for troubleshooting"
			disabled={!hasFailuresToReport || isActionPending(actionKeys.bulkReport)}
		>
			<ClipboardCopy size={14} />
			<span>{isActionPending(actionKeys.bulkReport) ? 'Copying…' : 'Report Failures'}</span>
		</button>
		<button
			onclick={handleCreateDebugBundle}
			class="control-btn control-btn--secondary"
			type="button"
			title="Copy debug bundle with queue snapshot, route, settings, and recent logs"
			disabled={isActionPending(actionKeys.createBundle)}
		>
			<Bug size={14} />
			<span>{isActionPending(actionKeys.createBundle) ? 'Bundling…' : 'Create Debug Bundle'}</span>
		</button>
	</div>
{/if}
