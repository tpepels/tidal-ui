<script lang="ts">
	import type { ErrorSummary, ErrorSummarySnapshot } from '$lib/core/errorTracker';

	export let open = false;
	export let loading = false;
	export let summary: ErrorSummary | null = null;
	export let persisted: ErrorSummarySnapshot | null = null;
	export let domainCounts: Record<string, number> | null = null;
	export let health: { status?: string; responseTime?: number; issues?: string[] } | null = null;
	export let retries: { total: number; recent: { attempt: number; delayMs: number }[] } | null = null;
	export let onClose: (() => void) | undefined;
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
		background: rgba(10, 12, 24, 0.72);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 6vh 1.5rem;
		z-index: 120;
	}

	.diagnostics-card {
		width: min(680px, 92vw);
		background: rgba(10, 12, 24, 0.95);
		border: 1px solid rgba(148, 163, 184, 0.2);
		border-radius: 18px;
		padding: 1.5rem;
		box-shadow: 0 24px 60px rgba(2, 6, 23, 0.45);
		color: #e2e8f0;
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
		color: rgba(226, 232, 240, 0.7);
	}

	.diagnostics-close {
		background: rgba(148, 163, 184, 0.15);
		border: 1px solid rgba(148, 163, 184, 0.3);
		border-radius: 999px;
		padding: 0.35rem 0.9rem;
		color: inherit;
		cursor: pointer;
	}

	.diagnostics-section {
		margin-top: 1.25rem;
	}

	.diagnostics-section h3 {
		margin: 0 0 0.5rem 0;
		font-size: 0.95rem;
		color: rgba(226, 232, 240, 0.85);
	}

	.diagnostics-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 0.75rem;
	}

	.diagnostics-grid div {
		background: rgba(15, 23, 42, 0.7);
		border-radius: 12px;
		padding: 0.6rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.diagnostics-grid span {
		font-size: 0.75rem;
		color: rgba(226, 232, 240, 0.6);
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
		color: rgba(226, 232, 240, 0.6);
	}

	.diagnostics-issues {
		margin: 0.5rem 0 0 1rem;
		padding: 0;
		font-size: 0.85rem;
		color: rgba(248, 113, 113, 0.9);
	}
</style>
