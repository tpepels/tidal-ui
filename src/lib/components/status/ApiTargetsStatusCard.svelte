<script lang="ts">
	type TargetsStatus = {
		success?: boolean;
		source?: string;
		targetCount?: number;
		browseTargetCount?: number;
		streamTargetCount?: number;
		qobuzTargetCount?: number;
		lastSuccessfulRefreshIso?: string | null;
		error?: string | null;
		browseTargets?: Array<{ name: string; baseUrl: string; weight: number }>;
		streamTargets?: Array<{ name: string; baseUrl: string; weight: number }>;
		qobuzTargets?: Array<{ name: string; baseUrl: string; weight: number }>;
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

	const ENDPOINT_PREVIEW_LIMIT = 4;

	let showAllBrowse = $state(false);
	let showAllStream = $state(false);
	let showAllQobuz = $state(false);

	const browseTargets = $derived(status?.browseTargets ?? []);
	const streamTargets = $derived(status?.streamTargets ?? []);
	const qobuzTargets = $derived(status?.qobuzTargets ?? []);

	const hiddenBrowseCount = $derived(Math.max(0, browseTargets.length - ENDPOINT_PREVIEW_LIMIT));
	const hiddenStreamCount = $derived(Math.max(0, streamTargets.length - ENDPOINT_PREVIEW_LIMIT));
	const hiddenQobuzCount = $derived(Math.max(0, qobuzTargets.length - ENDPOINT_PREVIEW_LIMIT));

	function formatEndpointHost(baseUrl: string): string {
		try {
			return new URL(baseUrl).host;
		} catch {
			return baseUrl;
		}
	}
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

	<div class="api-targets-card__summary-grid" role="group" aria-label="API target summary">
		<div class="api-targets-card__summary-item">
			<p class="api-targets-card__summary-label">All</p>
			<p class="api-targets-card__summary-value">{status?.targetCount ?? 0}</p>
		</div>
		<div class="api-targets-card__summary-item">
			<p class="api-targets-card__summary-label">Browse</p>
			<p class="api-targets-card__summary-value">{status?.browseTargetCount ?? 0}</p>
		</div>
		<div class="api-targets-card__summary-item">
			<p class="api-targets-card__summary-label">Stream</p>
			<p class="api-targets-card__summary-value">{status?.streamTargetCount ?? 0}</p>
		</div>
		<div class="api-targets-card__summary-item">
			<p class="api-targets-card__summary-label">Qobuz</p>
			<p class="api-targets-card__summary-value">{status?.qobuzTargetCount ?? 0}</p>
		</div>
	</div>

	<div class="api-targets-card__meta">
		<p class="section-footnote">Source: <strong>{status?.source ?? 'unknown'}</strong></p>
		{#if status?.lastSuccessfulRefreshIso}
			<p class="section-footnote">
				Last successful refresh: {new Date(status.lastSuccessfulRefreshIso).toLocaleString()}
			</p>
		{/if}
		{#if status?.refresh}
			<p class="section-footnote">
				Refresh check: {status.refresh.updated ? 'updated targets' : 'no update'} ({status.refresh.count ?? 0}
				target(s))
			</p>
		{/if}
		{#if lastUpdatedAt}
			<p class="section-footnote">Checked in UI: {new Date(lastUpdatedAt).toLocaleTimeString()}</p>
		{/if}
	</div>

	{#if browseTargets.length}
		<div class="api-targets-card__group">
			<div class="api-targets-card__group-header">
				<p class="section-footnote"><strong>Browse endpoints</strong> ({browseTargets.length})</p>
				{#if hiddenBrowseCount > 0}
					<button
						type="button"
						class="ui-chip-button ui-chip-button--compact ui-chip-button--detail"
						onclick={() => {
							showAllBrowse = !showAllBrowse;
						}}
					>
						{showAllBrowse ? 'Show less' : `Show all (${browseTargets.length})`}
					</button>
				{/if}
			</div>
			<ul class="api-targets-card__list">
				{#each (showAllBrowse ? browseTargets : browseTargets.slice(0, ENDPOINT_PREVIEW_LIMIT)) as target (target.name + target.baseUrl)}
					<li class="api-targets-card__item">
						<span class="api-targets-card__name">{target.name} · {formatEndpointHost(target.baseUrl)}</span>
						<span class="api-targets-card__url">{target.baseUrl}</span>
					</li>
				{/each}
				{#if !showAllBrowse && hiddenBrowseCount > 0}
					<li class="api-targets-card__item api-targets-card__item--more">+ {hiddenBrowseCount} more</li>
				{/if}
			</ul>
		</div>
	{/if}
	{#if streamTargets.length}
		<div class="api-targets-card__group">
			<div class="api-targets-card__group-header">
				<p class="section-footnote"><strong>Streaming endpoints</strong> ({streamTargets.length})</p>
				{#if hiddenStreamCount > 0}
					<button
						type="button"
						class="ui-chip-button ui-chip-button--compact ui-chip-button--detail"
						onclick={() => {
							showAllStream = !showAllStream;
						}}
					>
						{showAllStream ? 'Show less' : `Show all (${streamTargets.length})`}
					</button>
				{/if}
			</div>
			<ul class="api-targets-card__list">
				{#each (showAllStream ? streamTargets : streamTargets.slice(0, ENDPOINT_PREVIEW_LIMIT)) as target (target.name + target.baseUrl)}
					<li class="api-targets-card__item">
						<span class="api-targets-card__name">{target.name} · {formatEndpointHost(target.baseUrl)}</span>
						<span class="api-targets-card__url">{target.baseUrl}</span>
					</li>
				{/each}
				{#if !showAllStream && hiddenStreamCount > 0}
					<li class="api-targets-card__item api-targets-card__item--more">+ {hiddenStreamCount} more</li>
				{/if}
			</ul>
		</div>
	{/if}
	{#if qobuzTargets.length}
		<div class="api-targets-card__group">
			<div class="api-targets-card__group-header">
				<p class="section-footnote"><strong>Qobuz endpoints</strong> ({qobuzTargets.length})</p>
				{#if hiddenQobuzCount > 0}
					<button
						type="button"
						class="ui-chip-button ui-chip-button--compact ui-chip-button--detail"
						onclick={() => {
							showAllQobuz = !showAllQobuz;
						}}
					>
						{showAllQobuz ? 'Show less' : `Show all (${qobuzTargets.length})`}
					</button>
				{/if}
			</div>
			<ul class="api-targets-card__list">
				{#each (showAllQobuz ? qobuzTargets : qobuzTargets.slice(0, ENDPOINT_PREVIEW_LIMIT)) as target (target.name + target.baseUrl)}
					<li class="api-targets-card__item">
						<span class="api-targets-card__name">{target.name} · {formatEndpointHost(target.baseUrl)}</span>
						<span class="api-targets-card__url">{target.baseUrl}</span>
					</li>
				{/each}
				{#if !showAllQobuz && hiddenQobuzCount > 0}
					<li class="api-targets-card__item api-targets-card__item--more">+ {hiddenQobuzCount} more</li>
				{/if}
			</ul>
		</div>
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

	.api-targets-card__summary-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.3rem;
	}

	.api-targets-card__summary-item {
		display: flex;
		flex-direction: column;
		gap: 0.08rem;
		padding: 0.38rem 0.42rem;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 0.5rem;
		background: rgba(255, 255, 255, 0.02);
	}

	.api-targets-card__summary-label {
		margin: 0;
		font-size: 0.66rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(198, 198, 198, 0.72);
	}

	.api-targets-card__summary-value {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: rgba(244, 244, 244, 0.96);
	}

	.api-targets-card__meta {
		display: flex;
		flex-direction: column;
		gap: 0.14rem;
	}

	.api-targets-card__group {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-top: 0.2rem;
	}

	.api-targets-card__group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.35rem;
	}

	.api-targets-card__list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.22rem;
	}

	.api-targets-card__item {
		display: flex;
		flex-direction: column;
		gap: 0.08rem;
		padding: 0.18rem 0.3rem;
		border-radius: 0.5rem;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
	}

	.api-targets-card__item--more {
		font-size: 0.74rem;
		color: rgba(210, 210, 210, 0.7);
		align-items: flex-start;
	}

	.api-targets-card__name {
		font-size: 0.72rem;
		font-weight: 600;
		color: rgba(236, 236, 236, 0.88);
	}

	.api-targets-card__url {
		font-size: 0.7rem;
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
		font-size: 0.82rem;
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
