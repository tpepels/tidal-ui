<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		errorTracker,
		getErrorSummary,
		getPersistedErrorSummary,
		type ErrorReport
	} from '$lib/core/errorTracker';
	import { getRetrySummary, type RetrySummary } from '$lib/core/retryTracker';
	import { Activity, Gauge, Download, Logs, Settings } from 'lucide-svelte';
	import ApiTargetsStatusCard from '$lib/components/status/ApiTargetsStatusCard.svelte';
	import PageState from '$lib/components/ui/PageState.svelte';

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

<section class="status-page ui-page">
	<div class="ui-page__header">
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
		<div class="ui-page__actions">
			<a href="/download-center" class="ui-chip-link">
				<Download size={14} />
				<span>Download Center</span>
			</a>
			<a href="/download-log" class="ui-chip-link">
				<Logs size={14} />
				<span>Download Log</span>
			</a>
			<a href="/settings" class="ui-chip-link">
				<Settings size={14} />
				<span>Settings</span>
			</a>
			<button
				type="button"
				class="ui-chip-button status-page__refresh-btn"
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
		<PageState kind="error" title="Diagnostics unavailable" message={diagnosticsError} actionLabel="Retry" onAction={() => void refreshDiagnostics()} />
	{/if}

	<div class="status-page__grid">
		<section class="settings-section">
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
		</section>

		<section class="settings-section">
			<ApiTargetsStatusCard
				title="API Targets"
				status={statusTargets}
				loading={diagnosticsLoading}
				lastUpdatedAt={statusLastUpdatedAt}
				onRefresh={() => void refreshDiagnostics()}
				compact={true}
			/>
		</section>

		<section class="settings-section">
			<p class="section-heading">Queue</p>
			<pre class="status-page__json">{JSON.stringify(statusQueueMetrics?.queue ?? {}, null, 2)}</pre>
		</section>

		<section class="settings-section">
			<p class="section-heading">Queue Metrics</p>
			<pre class="status-page__json">{JSON.stringify(statusQueueMetrics?.metrics ?? {}, null, 2)}</pre>
		</section>

		<section class="settings-section">
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
				<PageState kind="empty" title="No domain spikes" message="No domain-specific error concentration detected." />
			{/if}
		</section>

		<section class="settings-section">
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
		</section>

		<section class="settings-section settings-section--wide">
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
				<PageState kind="loading" title="Loading errors" message="Fetching latest error telemetry." />
			{:else}
				<PageState kind="empty" title="No errors recorded" message="No recent errors are currently tracked." />
			{/if}
		</section>

		<section class="settings-section">
			<p class="section-heading">Persisted Summary</p>
			<pre class="status-page__json">{JSON.stringify(diagnosticsPersisted ?? {}, null, 2)}</pre>
		</section>

		<section class="settings-section">
			<p class="section-heading">Tracker Snapshot</p>
			<div class="status-page__tracker-snapshot">
				<Gauge size={14} />
				<span class="section-footnote">Realtime tracker reflects client-side observability state.</span>
			</div>
		</section>
	</div>
</section>

<style>
	.status-page {
		gap: 0.92rem;
	}

	.status-page__grid {
		display: grid;
		gap: 0.85rem;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
	}

	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.72rem 0.78rem;
		border-radius: var(--ui-radius-md, 14px);
		border: 1px solid rgba(212, 212, 212, 0.2);
		background: linear-gradient(160deg, rgba(12, 12, 12, 0.54), rgba(7, 7, 7, 0.38));
	}

	.settings-section--wide {
		grid-column: span 1;
	}

	.section-heading {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		font-weight: 700;
		margin: 0;
		color: rgba(212, 212, 212, 0.7);
	}

	.section-footnote {
		margin: 0;
		font-size: 0.68rem;
		color: rgba(212, 212, 212, 0.7);
		line-height: 1.4;
	}

	.status-page__refresh-label {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}

	.status-page__refresh-btn {
		padding-inline: 0.7rem;
	}

	.status-page__json {
		margin: 0;
		padding: 0.62rem 0.72rem;
		border-radius: 12px;
		border: 1px solid rgba(212, 212, 212, 0.22);
		background: linear-gradient(160deg, rgba(12, 12, 12, 0.58), rgba(7, 7, 7, 0.42));
		font-size: 0.68rem;
		line-height: 1.45;
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.status-page__issues,
	.status-page__errors {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.status-page__errors li {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
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

	@media (min-width: 960px) {
		.settings-section--wide {
			grid-column: span 2;
		}
	}
</style>
