<script lang="ts">
	import type { ErrorReport, ErrorSummary, ErrorSummarySnapshot } from '$lib/core/errorTracker';

	export let open = false;
	export let loading = false;
	export let summary: ErrorSummary | null = null;
	export let persisted: ErrorSummarySnapshot | null = null;
	export let domainCounts: Record<string, number> | null = null;
	export let health: { status?: string; responseTime?: number; issues?: string[] } | null = null;
	export let retries: { total: number; recent: { attempt: number; delayMs: number }[] } | null = null;
	export let errors: ErrorReport[] | null = null;
	export let onClose: (() => void) | undefined;

	const resolveDomain = (report: ErrorReport): string => {
		const domain = report.context?.domain;
		return typeof domain === 'string' && domain.length > 0 ? domain : 'other';
	};

	let selectedDomain = 'all';
	let selectedCorrelation = 'all';

	$: domainOptions = Array.from(new Set((errors ?? []).map(resolveDomain))).sort();
	$: correlationOptions = Array.from(
		new Set(
			(errors ?? [])
				.map((report) => report.context?.correlationId)
				.filter((value): value is string => typeof value === 'string' && value.length > 0)
		)
	).sort();

	$: if (selectedDomain !== 'all' && !domainOptions.includes(selectedDomain)) {
		selectedDomain = 'all';
	}

	$: if (selectedCorrelation !== 'all' && !correlationOptions.includes(selectedCorrelation)) {
		selectedCorrelation = 'all';
	}

	$: filteredErrors = (errors ?? [])
		.filter((report) =>
			selectedDomain === 'all' ? true : resolveDomain(report) === selectedDomain
		)
		.filter((report) =>
			selectedCorrelation === 'all'
				? true
				: report.context?.correlationId === selectedCorrelation
		)
		.slice(-50)
		.reverse();
</script>

{#if open}
	<div class="diagnostics-overlay" role="dialog" aria-modal="true">
		<div class="diagnostics-card">
			<header class="diagnostics-header">
				<div>
					<h2>QA Diagnostics</h2>
					<p class="diagnostics-subtitle">
						{loading ? 'Refreshing…' : 'Live error + health snapshot'}
					</p>
				</div>
				<button type="button" class="diagnostics-close" on:click={() => onClose?.()}>
					Close
				</button>
			</header>

			<section class="diagnostics-section">
				<h3>Errors (last hour)</h3>
				{#if summary}
					<div class="diagnostics-grid">
						<div>
							<span>Total</span>
							<strong>{summary.totalErrors}</strong>
						</div>
						<div>
							<span>Unique</span>
							<strong>{summary.uniqueErrors}</strong>
						</div>
						<div>
							<span>Critical</span>
							<strong>{summary.criticalErrors}</strong>
						</div>
						<div>
							<span>Rate/min</span>
							<strong>{summary.errorRate}</strong>
						</div>
					</div>
				{:else}
					<p class="diagnostics-muted">No summary available yet.</p>
				{/if}
			</section>

			<section class="diagnostics-section">
				<h3>Error Drilldown</h3>
				<div class="diagnostics-filters">
					<label class="diagnostics-filter">
						<span>Type</span>
						<select aria-label="Type" bind:value={selectedDomain}>
							<option value="all">All</option>
							{#each domainOptions as option (option)}
								<option value={option}>{option}</option>
							{/each}
						</select>
					</label>
					<label class="diagnostics-filter">
						<span>Correlation</span>
						<select aria-label="Correlation" bind:value={selectedCorrelation}>
							<option value="all">All</option>
							{#each correlationOptions as option (option)}
								<option value={option}>{option}</option>
							{/each}
						</select>
					</label>
				</div>
				{#if filteredErrors.length > 0}
					<ul class="diagnostics-error-list">
						{#each filteredErrors as errorReport (errorReport.id)}
							<li>
								<div class="diagnostics-error-header">
									<span class="diagnostics-error-domain">
										{resolveDomain(errorReport)}
									</span>
									<span class="diagnostics-error-time">
										{new Date(errorReport.timestamp).toLocaleTimeString()}
									</span>
									<span class="diagnostics-error-severity">{errorReport.severity}</span>
								</div>
								<p class="diagnostics-error-message">{errorReport.error.message}</p>
								<div class="diagnostics-error-meta">
									<span>
										correlation: {errorReport.context?.correlationId ?? 'missing'}
									</span>
									<span>
										{errorReport.context?.component
											? `component: ${String(errorReport.context.component)}`
											: 'component: unknown'}
									</span>
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="diagnostics-muted">No errors match the current filters.</p>
				{/if}
			</section>

			<section class="diagnostics-section">
				<h3>Domains</h3>
				{#if domainCounts}
					<div class="diagnostics-grid diagnostics-grid--compact">
						{#each Object.entries(domainCounts) as [domain, count] (domain)}
							<div>
								<span>{domain}</span>
								<strong>{count}</strong>
							</div>
						{/each}
					</div>
				{:else}
					<p class="diagnostics-muted">No domain metrics.</p>
				{/if}
			</section>

			<section class="diagnostics-section">
				<h3>Health</h3>
				{#if health}
					<div class="diagnostics-grid diagnostics-grid--compact">
						<div>
							<span>Status</span>
							<strong>{health.status ?? 'unknown'}</strong>
						</div>
						<div>
							<span>Response</span>
							<strong>{health.responseTime ?? '—'} ms</strong>
						</div>
					</div>
					{#if health.issues?.length}
						<ul class="diagnostics-issues">
							{#each health.issues as issue (issue)}
								<li>{issue}</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<p class="diagnostics-muted">Health check unavailable.</p>
				{/if}
			</section>

			<section class="diagnostics-section">
				<h3>Retries</h3>
				{#if retries}
					<p class="diagnostics-muted">Total retries (last hour): {retries.total}</p>
					{#if retries.recent.length > 0}
						<ul class="diagnostics-issues">
							{#each retries.recent as retry, index (index)}
								<li>
									Attempt {retry.attempt} · {Math.round(retry.delayMs)} ms backoff
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<p class="diagnostics-muted">No retry data yet.</p>
				{/if}
			</section>

			<section class="diagnostics-section">
				<h3>Persisted Snapshot</h3>
				{#if persisted}
					<p class="diagnostics-muted">
						Last saved {new Date(persisted.capturedAt).toLocaleTimeString()}
					</p>
				{:else}
					<p class="diagnostics-muted">No persisted snapshot found.</p>
				{/if}
			</section>
		</div>
	</div>
{/if}

<style>
	.diagnostics-overlay {
		position: fixed;
		inset: 0;
		background: rgba(8, 8, 8, 0.82);
		display: flex;
		align-items: flex-start;
		justify-content: stretch;
		padding: 4vh 1rem;
		z-index: 120;
	}

	.diagnostics-card {
		width: min(980px, 100%);
		margin: 0 auto;
		background: rgba(10, 10, 10, 0.96);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: var(--ui-radius-lg, 16px);
		padding: 1.5rem;
		color: rgba(226, 226, 226, 0.94);
		max-height: 92vh;
		overflow: auto;
	}

	.diagnostics-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}

	.diagnostics-header h2 {
		margin: 0 0 0.25rem 0;
		font-size: 1.2rem;
	}

	.diagnostics-subtitle {
		margin: 0;
		font-size: 0.85rem;
		color: rgba(212, 212, 212, 0.7);
	}

	.diagnostics-close {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 999px;
		padding: 0.35rem 0.9rem;
		color: inherit;
		cursor: pointer;
		transition:
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.diagnostics-close:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.28);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.diagnostics-section {
		margin-top: 1.25rem;
		padding: 0.95rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--ui-radius-md, 12px);
		background: rgba(255, 255, 255, 0.02);
	}

	.diagnostics-section h3 {
		margin: 0 0 0.5rem 0;
		font-size: 0.95rem;
		color: rgba(222, 222, 222, 0.85);
	}

	.diagnostics-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 0.75rem;
	}

	.diagnostics-grid div {
		background: rgba(255, 255, 255, 0.03);
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		padding: 0.6rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.diagnostics-grid span {
		font-size: 0.75rem;
		color: rgba(204, 204, 204, 0.62);
	}

	.diagnostics-grid strong {
		font-size: 1rem;
	}

	.diagnostics-grid--compact {
		grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
	}

	.diagnostics-muted {
		margin: 0;
		font-size: 0.85rem;
		color: rgba(200, 200, 200, 0.62);
	}

	.diagnostics-issues {
		margin: 0.5rem 0 0 1rem;
		padding: 0;
		font-size: 0.85rem;
		color: rgba(196, 196, 196, 0.88);
	}

	.diagnostics-filters {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.diagnostics-filter {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: rgba(210, 210, 210, 0.75);
	}

	.diagnostics-filter select {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.16);
		color: inherit;
		border-radius: 8px;
		padding: 0.35rem 0.6rem;
		font-size: 0.85rem;
	}

	.diagnostics-error-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-height: 280px;
		overflow-y: auto;
	}

	.diagnostics-error-list li {
		background: rgba(255, 255, 255, 0.03);
		border-radius: var(--ui-radius-sm, 9px);
		padding: 0.6rem 0.75rem;
		border: 1px solid rgba(255, 255, 255, 0.12);
	}

	.diagnostics-error-header {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: rgba(188, 188, 188, 0.82);
	}

	.diagnostics-error-domain {
		font-weight: 600;
		color: rgba(232, 232, 232, 0.92);
	}

	.diagnostics-error-severity {
		margin-left: auto;
		font-weight: 600;
		color: rgba(194, 194, 194, 0.9);
	}

	.diagnostics-error-message {
		margin: 0.35rem 0 0.25rem;
		font-size: 0.9rem;
		color: rgba(242, 242, 242, 0.94);
	}

	.diagnostics-error-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: rgba(186, 186, 186, 0.8);
	}

	@media (prefers-reduced-motion: reduce) {
		.diagnostics-card,
		.diagnostics-card *,
		.diagnostics-close {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
