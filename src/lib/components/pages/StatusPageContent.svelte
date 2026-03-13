<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		errorTracker,
		getErrorSummary,
		getPersistedErrorSummary,
		type ErrorReport
	} from '$lib/core/errorTracker';
	import { getRetrySummary, type RetrySummary } from '$lib/core/retryTracker';
	import { Activity, Gauge } from 'lucide-svelte';
	import ApiTargetsStatusCard from '$lib/components/status/ApiTargetsStatusCard.svelte';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import ToolPanel from '$lib/components/ui/ToolPanel.svelte';

	let diagnosticsLoading = $state(false);
	let diagnosticsSummary = $state<ReturnType<typeof getErrorSummary> | null>(null);
	let diagnosticsDomains = $state<Record<string, number> | null>(null);
	let diagnosticsHealth = $state<{ status?: string; responseTime?: number; issues?: string[] } | null>(null);
	let diagnosticsPersisted = $state<ReturnType<typeof getPersistedErrorSummary> | null>(null);
	let diagnosticsRetries = $state<RetrySummary | null>(null);
	let diagnosticsErrors = $state<ErrorReport[] | null>(null);
	let statusTargets = $state<{
		success?: boolean;
		source?: string;
		targetCount?: number;
		lastSuccessfulRefreshIso?: string | null;
		error?: string | null;
		targets?: Array<{ name: string; baseUrl: string; weight: number }>;
		refresh?: {
			updated?: boolean;
			count?: number;
			source?: string;
			lastUpdated?: string;
		};
	} | null>(null);
	let statusQueueMetrics = $state<{
		source?: string;
		queue?: Record<string, unknown>;
		metrics?: Record<string, unknown>;
		error?: string;
	} | null>(null);
	let statusLastUpdatedAt = $state<number | null>(null);
	let statusPollInterval: ReturnType<typeof setInterval> | null = null;
	let diagnosticsError = $state<string | null>(null);

	type QueueSnapshot = {
		queued: number;
		processing: number;
		paused: number;
		completed: number;
		failed: number;
		total: number;
	};

	type QueueMetrics = {
		total_jobs: number;
		queued: number;
		processing: number;
		paused: number;
		completed: number;
		failed: number;
		cancelled: number;
		avg_success_rate: number;
		avg_retry_count: number;
		total_download_time_ms: number;
		avg_job_duration_ms: number;
		failure_by_code: Record<string, number>;
	};

	const queueSnapshot = $derived((statusQueueMetrics?.queue ?? null) as Partial<QueueSnapshot> | null);
	const queueMetrics = $derived((statusQueueMetrics?.metrics ?? null) as Partial<QueueMetrics> | null);

	function toMetricNumber(value: unknown, fallback = 0): number {
		return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	}

	function formatDurationFromMs(value: unknown): string {
		const ms = toMetricNumber(value, 0);
		if (ms <= 0) return '0s';
		const seconds = Math.round(ms / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
	}

	async function refreshDiagnostics(): Promise<void> {
		diagnosticsLoading = true;
		diagnosticsError = null;
		diagnosticsSummary = getErrorSummary();
		diagnosticsDomains = errorTracker.getDomainSummary();
		diagnosticsPersisted = getPersistedErrorSummary();
		diagnosticsRetries = getRetrySummary();
		diagnosticsErrors = errorTracker.getErrors({ limit: 50 });

		try {
			const [healthResponse, targetsResponse, queueMetricsResponse] = await Promise.all([
				fetch('/api/health'),
				fetch('/api/targets/status'),
				fetch('/api/download-queue/metrics')
			]);
			diagnosticsHealth = (await healthResponse.json()) as typeof diagnosticsHealth;
			statusTargets = (await targetsResponse.json()) as typeof statusTargets;
			statusQueueMetrics = (await queueMetricsResponse.json()) as typeof statusQueueMetrics;
			statusLastUpdatedAt = Date.now();
		} catch (error) {
			diagnosticsHealth = null;
			statusTargets = null;
			statusQueueMetrics = null;
			diagnosticsError = error instanceof Error ? error.message : 'Failed to refresh diagnostics';
		} finally {
			diagnosticsLoading = false;
		}
	}

	$effect(() => {
		void refreshDiagnostics();
		if (statusPollInterval) {
			clearInterval(statusPollInterval);
		}
		statusPollInterval = setInterval(() => {
			void refreshDiagnostics();
		}, 5000);
		return () => {
			if (statusPollInterval) {
				clearInterval(statusPollInterval);
				statusPollInterval = null;
			}
		};
	});

	onDestroy(() => {
		if (statusPollInterval) {
			clearInterval(statusPollInterval);
			statusPollInterval = null;
		}
	});
</script>

<section class="status-page ui-page" data-ui-archetype="tool" data-ui-route="status">
	<div class="ui-page__header" data-ui-block="page-header">
		<div class="ui-page__title-group">
			<p class="ui-page__eyebrow">Tools</p>
			<h1 class="ui-page__title">Status</h1>
			<p class="ui-page__subtitle">
				{#if statusLastUpdatedAt}
					Last updated {new Date(statusLastUpdatedAt).toLocaleTimeString()}
				{:else}
					Waiting for first refresh…
				{/if}
			</p>
		</div>
		<div class="ui-page__actions" data-ui-block="primary-actions">
			<button
				type="button"
				class="ui-chip-button status-page__refresh-btn"
				data-tone="tertiary"
				onclick={() => void refreshDiagnostics()}
				disabled={diagnosticsLoading}
			>
				<span class="status-page__refresh-label">
					<Activity size={16} />
					<span>{diagnosticsLoading ? 'Refreshing…' : 'Refresh now'}</span>
				</span>
			</button>
		</div>
	</div>

	{#if diagnosticsError}
		<StateBlock
			kind="error"
			title="Diagnostics unavailable"
			message={diagnosticsError}
			actionLabel="Retry"
			onAction={() => void refreshDiagnostics()}
		/>
	{/if}

	<div class="status-page__grid" data-ui-block="main-sections">
		<div data-ui-block="key-summary">
			<ToolPanel tone="secondary">
				<p class="section-heading">Health</p>
				<p class="section-footnote">
					Status: <strong>{diagnosticsHealth?.status ?? 'unknown'}</strong>
				</p>
				<p class="section-footnote">Response: {diagnosticsHealth?.responseTime ?? '—'} ms</p>
				{#if diagnosticsHealth?.issues?.length}
					<ul class="status-page__issues">
						{#each diagnosticsHealth.issues as issue (issue)}
							<li>{issue}</li>
						{/each}
					</ul>
				{/if}
			</ToolPanel>
		</div>

		<ToolPanel tone="secondary">
			<ApiTargetsStatusCard
				title="API Targets"
				status={statusTargets}
				loading={diagnosticsLoading}
				lastUpdatedAt={statusLastUpdatedAt}
				onRefresh={() => void refreshDiagnostics()}
				compact={true}
			/>
		</ToolPanel>

		<ToolPanel tone="tertiary">
			<p class="section-heading">Queue</p>
			<div class="status-page__metric-grid">
				<div class="status-page__metric">
					<p class="status-page__metric-label">Queued</p>
					<p class="status-page__metric-value">{toMetricNumber(queueSnapshot?.queued)}</p>
				</div>
				<div class="status-page__metric">
					<p class="status-page__metric-label">Processing</p>
					<p class="status-page__metric-value">{toMetricNumber(queueSnapshot?.processing)}</p>
				</div>
				<div class="status-page__metric">
					<p class="status-page__metric-label">Paused</p>
					<p class="status-page__metric-value">{toMetricNumber(queueSnapshot?.paused)}</p>
				</div>
				<div class="status-page__metric">
					<p class="status-page__metric-label">Completed</p>
					<p class="status-page__metric-value">{toMetricNumber(queueSnapshot?.completed)}</p>
				</div>
				<div class="status-page__metric">
					<p class="status-page__metric-label">Failed</p>
					<p class="status-page__metric-value">{toMetricNumber(queueSnapshot?.failed)}</p>
				</div>
				<div class="status-page__metric">
					<p class="status-page__metric-label">Total</p>
					<p class="status-page__metric-value">{toMetricNumber(queueSnapshot?.total)}</p>
				</div>
			</div>
			<details class="status-page__details">
				<summary>Show raw queue snapshot</summary>
				<pre class="status-page__json">{JSON.stringify(statusQueueMetrics?.queue ?? {}, null, 2)}</pre>
			</details>
		</ToolPanel>

		<ToolPanel tone="tertiary">
			<p class="section-heading">Queue Metrics</p>
			<div class="status-page__metric-grid">
				<div class="status-page__metric">
					<p class="status-page__metric-label">Success Rate</p>
					<p class="status-page__metric-value">{toMetricNumber(queueMetrics?.avg_success_rate)}%</p>
				</div>
				<div class="status-page__metric">
					<p class="status-page__metric-label">Avg Retry Count</p>
					<p class="status-page__metric-value">{toMetricNumber(queueMetrics?.avg_retry_count)}</p>
				</div>
				<div class="status-page__metric">
					<p class="status-page__metric-label">Avg Job Duration</p>
					<p class="status-page__metric-value">{formatDurationFromMs(queueMetrics?.avg_job_duration_ms)}</p>
				</div>
				<div class="status-page__metric">
					<p class="status-page__metric-label">Total Download Time</p>
					<p class="status-page__metric-value">{formatDurationFromMs(queueMetrics?.total_download_time_ms)}</p>
				</div>
				<div class="status-page__metric">
					<p class="status-page__metric-label">Cancelled</p>
					<p class="status-page__metric-value">{toMetricNumber(queueMetrics?.cancelled)}</p>
				</div>
				<div class="status-page__metric">
					<p class="status-page__metric-label">Jobs Tracked</p>
					<p class="status-page__metric-value">{toMetricNumber(queueMetrics?.total_jobs)}</p>
				</div>
			</div>
			{#if queueMetrics?.failure_by_code && Object.keys(queueMetrics.failure_by_code).length > 0}
				<ul class="status-page__issues">
					{#each Object.entries(queueMetrics.failure_by_code) as [code, count] (code)}
						<li>{code}: {count}</li>
					{/each}
				</ul>
			{/if}
			<details class="status-page__details">
				<summary>Show raw metrics snapshot</summary>
				<pre class="status-page__json">{JSON.stringify(statusQueueMetrics?.metrics ?? {}, null, 2)}</pre>
			</details>
		</ToolPanel>

		<ToolPanel tone="secondary">
			<p class="section-heading">Errors (Last Hour)</p>
			<p class="section-footnote">
				Total: {diagnosticsSummary?.totalErrors ?? 0} ·
				Unique: {diagnosticsSummary?.uniqueErrors ?? 0} ·
				Critical: {diagnosticsSummary?.criticalErrors ?? 0}
			</p>
			{#if diagnosticsDomains && Object.keys(diagnosticsDomains).length > 0}
				<ul class="status-page__issues">
					{#each Object.entries(diagnosticsDomains) as [domain, count] (domain)}
						<li>{domain}: {count}</li>
					{/each}
				</ul>
			{:else}
				<StateBlock
					kind="empty"
					title="No domain spikes"
					message="No domain-specific error concentration detected."
					embedded={true}
				/>
				{/if}
		</ToolPanel>

		<details class="status-page__advanced">
			<summary>Advanced diagnostics</summary>
			<div class="status-page__advanced-grid">
				<ToolPanel tone="tertiary">
					<p class="section-heading">Retry Health</p>
					<p class="section-footnote">Total retries (last hour): {diagnosticsRetries?.total ?? 0}</p>
					<p class="section-footnote">Recent retry events: {diagnosticsRetries?.recent?.length ?? 0}</p>
					{#if diagnosticsRetries?.recent?.length}
						<ul class="status-page__issues">
							{#each diagnosticsRetries.recent as retryEvent (retryEvent.id)}
								<li>
									{retryEvent.operation ?? 'request'} attempt {retryEvent.attempt} ({Math.round(
										retryEvent.delayMs
									)}ms backoff)
								</li>
							{/each}
						</ul>
					{/if}
				</ToolPanel>

				<ToolPanel tone="secondary" wide={true}>
					<p class="section-heading">Recent Errors</p>
					{#if diagnosticsErrors && diagnosticsErrors.length > 0}
						<ul class="status-page__errors">
							{#each diagnosticsErrors.slice(0, 20) as errorReport (errorReport.id)}
								<li>
									<strong>{errorReport.context?.domain ?? 'unknown'}</strong>
									<span>{new Date(errorReport.timestamp).toLocaleTimeString()}</span>
									<p>{errorReport.error.message}</p>
								</li>
							{/each}
						</ul>
					{:else if diagnosticsLoading}
						<StateBlock
							kind="loading"
							title="Loading errors"
							message="Fetching latest error telemetry."
							embedded={true}
						/>
					{:else}
						<StateBlock
							kind="empty"
							title="No errors recorded"
							message="No recent errors are currently tracked."
							embedded={true}
						/>
					{/if}
				</ToolPanel>

				<ToolPanel tone="tertiary">
					<p class="section-heading">Persisted Summary</p>
					{#if diagnosticsPersisted}
						<p class="section-footnote">
							Captured {new Date(diagnosticsPersisted.capturedAt).toLocaleTimeString()}
						</p>
						<div class="status-page__metric-grid">
							<div class="status-page__metric">
								<p class="status-page__metric-label">Total Errors</p>
								<p class="status-page__metric-value">{diagnosticsPersisted.summary.totalErrors}</p>
							</div>
							<div class="status-page__metric">
								<p class="status-page__metric-label">Unique Errors</p>
								<p class="status-page__metric-value">{diagnosticsPersisted.summary.uniqueErrors}</p>
							</div>
							<div class="status-page__metric">
								<p class="status-page__metric-label">Critical Errors</p>
								<p class="status-page__metric-value">{diagnosticsPersisted.summary.criticalErrors}</p>
							</div>
							<div class="status-page__metric">
								<p class="status-page__metric-label">Error Rate</p>
								<p class="status-page__metric-value">{diagnosticsPersisted.summary.errorRate}/min</p>
							</div>
						</div>
						<details class="status-page__details">
							<summary>Show raw persisted snapshot</summary>
							<pre class="status-page__json">{JSON.stringify(diagnosticsPersisted, null, 2)}</pre>
						</details>
					{:else}
						<StateBlock
							kind="empty"
							title="No persisted summary"
							message="A persisted snapshot will appear after errors are tracked."
							embedded={true}
						/>
					{/if}
				</ToolPanel>

				<ToolPanel tone="secondary">
					<p class="section-heading">Tracker Snapshot</p>
					<div class="status-page__tracker-snapshot">
						<Gauge size={14} />
						<span class="section-footnote">Realtime tracker reflects client-side observability state.</span>
					</div>
				</ToolPanel>
			</div>
		</details>
	</div>
</section>

<style>
	.status-page {
		gap: 1rem;
	}

	.status-page__grid {
		display: grid;
		gap: 0.92rem;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
	}

	.section-heading {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		font-weight: 700;
		margin: 0;
		color: rgba(212, 212, 212, 0.7);
	}

	.section-footnote {
		margin: 0;
		font-size: 0.9rem;
		color: rgba(212, 212, 212, 0.7);
		line-height: 1.4;
	}

	.status-page__refresh-label {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}

	.status-page__refresh-btn {
		padding-inline: 0.84rem;
	}

	.status-page__advanced {
		grid-column: 1 / -1;
		border-top: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		border-bottom: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		padding: 0.2rem 0;
	}

	.status-page__advanced > summary {
		list-style: none;
		cursor: pointer;
		padding: 0.6rem 0.1rem;
		font-size: 0.88rem;
		font-weight: 620;
		color: rgba(224, 224, 224, 0.9);
	}

	.status-page__advanced > summary::-webkit-details-marker {
		display: none;
	}

	.status-page__advanced-grid {
		display: grid;
		gap: 0.92rem;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		padding-bottom: 0.6rem;
	}

	.status-page__metric-grid {
		display: grid;
		gap: 0.46rem;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	}

	.status-page__metric {
		margin: 0;
		padding: 0.32rem 0;
		background: transparent;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.35rem;
	}

	.status-page__metric-label {
		margin: 0;
		font-size: 0.76rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(163, 163, 163, 0.86);
	}

	.status-page__metric-value {
		margin: 0;
		font-size: 1.08rem;
		font-weight: 650;
		color: rgba(245, 245, 245, 0.96);
	}

	.status-page__details {
		border-top: 1px dashed var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		border-bottom: 1px dashed var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		overflow: hidden;
	}

	.status-page__details summary {
		list-style: none;
		cursor: pointer;
		padding: 0.6rem 0.1rem;
		font-size: 0.84rem;
		font-weight: 600;
		color: rgba(220, 220, 220, 0.88);
	}

	.status-page__details summary::-webkit-details-marker {
		display: none;
	}

	.status-page__details[open] summary {
		border-bottom: 1px dashed var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
	}

	.status-page__json {
		margin: 0;
		padding: 0.74rem 0.1rem;
		border: 0;
		background: transparent;
		font-size: 0.84rem;
		line-height: 1.45;
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.status-page__issues,
	.status-page__errors {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.42rem;
		font-size: 0.84rem;
	}

	.status-page__issues {
		padding-left: 1.1rem;
	}

	.status-page__errors {
		padding-left: 0;
		list-style: none;
	}

	.status-page__errors li {
		display: flex;
		flex-direction: column;
		gap: 0.24rem;
		padding: 0.54rem 0;
		border-bottom: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: transparent;
	}

	.status-page__errors p {
		margin: 0;
		opacity: 0.88;
	}

	.status-page__tracker-snapshot {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

</style>
