<script lang="ts">
	type TargetsStatus = {
		success?: boolean;
		source?: string;
		targetCount?: number;
		browseTargetCount?: number;
		streamTargetCount?: number;
		lastSuccessfulRefreshIso?: string | null;
		error?: string | null;
		browseTargets?: Array<{ name: string; baseUrl: string; weight: number }>;
		streamTargets?: Array<{ name: string; baseUrl: string; weight: number }>;
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
			<button type="button" class="ui-chip-button api-targets-card__refresh" onclick={onRefresh} disabled={loading}>
				<span>{loading ? 'Refreshing...' : 'Refresh'}</span>
			</button>
		{/if}
	</div>

	<p class="section-footnote">
		Source: <strong>{status?.source ?? 'unknown'}</strong>
	</p>
	<p class="section-footnote">
		Available targets: {status?.targetCount ?? 0}
	</p>
	<p class="section-footnote">
		Browse targets: {status?.browseTargetCount ?? 0}
	</p>
	<p class="section-footnote">
		Streaming targets: {status?.streamTargetCount ?? 0}
	</p>
	{#if status?.browseTargets?.length}
		<div class="api-targets-card__group">
			<p class="section-footnote"><strong>Browse endpoints</strong></p>
			<ul class="api-targets-card__list">
				{#each status.browseTargets as target (target.name + target.baseUrl)}
					<li class="api-targets-card__item">
						<span class="api-targets-card__name">{target.name}</span>
						<span class="api-targets-card__url">{target.baseUrl}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if status?.streamTargets?.length}
		<div class="api-targets-card__group">
			<p class="section-footnote"><strong>Streaming endpoints</strong></p>
			<ul class="api-targets-card__list">
				{#each status.streamTargets as target (target.name + target.baseUrl)}
					<li class="api-targets-card__item">
						<span class="api-targets-card__name">{target.name}</span>
						<span class="api-targets-card__url">{target.baseUrl}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
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

	.api-targets-card__group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-top: 0.2rem;
	}

	.api-targets-card__list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.api-targets-card__item {
		display: flex;
		flex-direction: column;
		gap: 0.08rem;
		padding: 0.22rem 0.38rem;
		border-radius: 0.5rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
	}

	.api-targets-card__name {
		font-size: 0.75rem;
		font-weight: 600;
		color: rgba(236, 236, 236, 0.88);
	}

	.api-targets-card__url {
		font-size: 0.75rem;
		word-break: break-all;
		color: rgba(210, 210, 210, 0.78);
	}

	.api-targets-card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.section-heading {
		font-size: 0.82rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-weight: 700;
		margin: 0;
		color: rgba(224, 224, 224, 0.76);
	}

	.section-footnote {
		margin: 0;
		font-size: 0.9rem;
		color: rgba(212, 212, 212, 0.7);
		line-height: 1.4;
	}

	.section-footnote--error {
		color: rgba(212, 212, 212, 0.86);
	}

	.api-targets-card__refresh {
		min-height: 40px;
		padding-inline: 0.78rem;
		font-size: 0.86rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.api-targets-card__refresh {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
