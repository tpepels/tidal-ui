<script lang="ts">
	type TargetsStatus = {
		success?: boolean;
		source?: string;
		targetCount?: number;
		lastSuccessfulRefreshIso?: string | null;
		error?: string | null;
		refresh?: {
			updated?: boolean;
			count?: number;
			source?: string;
			lastUpdated?: string;
		};
	};

	let {
		title = 'API Targets',
		status = null,
		loading = false,
		lastUpdatedAt = null,
		onRefresh = null,
		compact = false
	}: {
		title?: string;
		status?: TargetsStatus | null;
		loading?: boolean;
		lastUpdatedAt?: number | null;
		onRefresh?: (() => void) | null;
		compact?: boolean;
	} = $props();
</script>

<section class="api-targets-card" class:api-targets-card--compact={compact}>
	<div class="api-targets-card__header">
		<p class="section-heading">{title}</p>
		{#if onRefresh}
			<button type="button" class="glass-action" onclick={onRefresh} disabled={loading}>
				<span class="glass-action__label">{loading ? 'Refreshing...' : 'Refresh'}</span>
			</button>
		{/if}
	</div>

	<p class="section-footnote">
		Source: <strong>{status?.source ?? 'unknown'}</strong>
	</p>
	<p class="section-footnote">
		Available targets: {status?.targetCount ?? 0}
	</p>
	{#if status?.lastSuccessfulRefreshIso}
		<p class="section-footnote">
			Last successful refresh: {new Date(status.lastSuccessfulRefreshIso).toLocaleString()}
		</p>
	{/if}
	{#if status?.refresh}
		<p class="section-footnote">
			Refresh check: {status.refresh.updated ? 'updated targets' : 'no update'} ({status.refresh.count ?? 0} target(s))
		</p>
	{/if}
	{#if lastUpdatedAt}
		<p class="section-footnote">
			Checked in UI: {new Date(lastUpdatedAt).toLocaleTimeString()}
		</p>
	{/if}
	{#if status?.error}
		<p class="section-footnote section-footnote--error">{status.error}</p>
	{/if}
</section>

<style>
	.api-targets-card {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.api-targets-card--compact {
		gap: 0.35rem;
	}

	.api-targets-card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
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

	.section-footnote--error {
		color: rgba(212, 212, 212, 0.86);
	}

	.glass-action {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.85rem;
		border-radius: var(--ui-radius-md, 14px);
		border: 1px solid rgba(212, 212, 212, 0.24);
		background: linear-gradient(155deg, rgba(15, 15, 15, 0.62), rgba(8, 8, 8, 0.44));
		padding: 0.4rem 0.65rem;
		font-size: 0.74rem;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
	}

	.glass-action:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.glass-action__label {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
	}
</style>
