<script lang="ts">
	import ToolPanel from '$lib/components/ui/ToolPanel.svelte';
	import ActionPanel from '$lib/components/ui/ActionPanel.svelte';
	import DataGrid from '$lib/components/ui/DataGrid.svelte';
</script>

<section class="ui-page archetype-preview-page" data-ui-archetype="collection" data-ui-route="ui-archetypes">
	<header class="ui-page__header" data-ui-block="page-header">
		<div class="ui-page__title-group">
			<p class="ui-page__eyebrow">Internal</p>
			<h1 class="ui-page__title">UI Archetype Visual Baselines</h1>
			<p class="ui-page__subtitle">
				Reference cards for visual regression snapshots across tool, detail, collection, and embed archetypes.
			</p>
		</div>
	</header>

	<div class="archetype-preview-grid">
		<article class="ui-surface-card archetype-preview-card" data-testid="archetype-tool">
			<div class="archetype-preview-card__meta">
				<span class="ui-meta-pill">Tool Archetype</span>
			</div>
			<div class="archetype-preview-card__content">
				<ToolPanel
					eyebrow="Tools"
					title="PageHeader -> KeySummary -> PrimaryActions -> MainSections"
					subtitle="Operational surface sample with summary-first hierarchy."
				>
					<div class="archetype-kpi-grid">
						<div class="archetype-kpi">
							<p class="archetype-kpi__label">Queue</p>
							<p class="archetype-kpi__value">14 active</p>
						</div>
						<div class="archetype-kpi">
							<p class="archetype-kpi__label">Errors</p>
							<p class="archetype-kpi__value">0 critical</p>
						</div>
					</div>
					<div class="ui-action-row ui-action-row--progressive">
						<button type="button" class="ui-action-button ui-action-button--primary">Primary Action</button>
						<button type="button" class="ui-chip-button">Secondary</button>
					</div>
				</ToolPanel>
			</div>
		</article>

		<article class="ui-surface-card archetype-preview-card" data-testid="archetype-detail">
			<div class="archetype-preview-card__meta">
				<span class="ui-meta-pill">Detail Archetype</span>
			</div>
			<div class="archetype-preview-card__content">
				<div class="ui-action-row">
					<button type="button" class="ui-chip-button ui-chip-button--compact">Back</button>
				</div>
				<ActionPanel
					intent="Entity Hero + Primary Actions"
					summary="BackNav -> EntityHero -> PrimaryActions -> ContextMetadata -> MainContent."
					intentful={true}
				>
					<div class="ui-action-row ui-action-row--progressive">
						<button type="button" class="ui-action-button ui-action-button--primary">Play</button>
						<button type="button" class="ui-action-button">Download</button>
					</div>
					<DataGrid>
						<div class="ui-data-point">
							<p class="ui-data-point__label">Artist</p>
							<p class="ui-data-point__value">Sample Artist</p>
						</div>
						<div class="ui-data-point">
							<p class="ui-data-point__label">Tracks</p>
							<p class="ui-data-point__value">12</p>
						</div>
					</DataGrid>
				</ActionPanel>
			</div>
		</article>

		<article class="ui-surface-card archetype-preview-card" data-testid="archetype-collection">
			<div class="archetype-preview-card__meta">
				<span class="ui-meta-pill">Collection Archetype</span>
			</div>
			<div class="archetype-preview-card__content">
				<div class="ui-page__actions">
					<button type="button" class="ui-chip-button ui-chip-button--compact">Filter A</button>
					<button type="button" class="ui-chip-button ui-chip-button--compact">Filter B</button>
				</div>
				<div class="ui-media-grid ui-media-grid--albums archetype-media-grid">
					<div class="ui-media-card">
						<div class="ui-media-card__artwork"></div>
						<div class="ui-media-card__body">
							<p class="ui-media-card__title">Result Card</p>
							<p class="ui-media-card__subtitle">Summary-first metadata</p>
						</div>
					</div>
					<div class="ui-media-card">
						<div class="ui-media-card__artwork"></div>
						<div class="ui-media-card__body">
							<p class="ui-media-card__title">Result Card</p>
							<p class="ui-media-card__subtitle">Consistent card grammar</p>
						</div>
					</div>
				</div>
			</div>
		</article>

		<article class="ui-surface-card archetype-preview-card" data-testid="archetype-embed">
			<div class="archetype-preview-card__meta">
				<span class="ui-meta-pill">Embed Archetype</span>
			</div>
			<div class="archetype-preview-card__content archetype-preview-card__content--compact">
				<ActionPanel intent="Compact Hierarchy" summary="EntityHero -> PrimaryActions -> MainSections">
					<div class="ui-action-row">
						<button type="button" class="ui-action-button ui-action-button--primary">Play</button>
					</div>
					<p class="ui-action-status">Compact controls, no custom branch visuals.</p>
				</ActionPanel>
			</div>
		</article>
	</div>
</section>

<style>
	.archetype-preview-page {
		gap: 1.1rem;
	}

	.archetype-preview-grid {
		display: grid;
		gap: 0.9rem;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
	}

	.archetype-preview-card {
		display: flex;
		flex-direction: column;
		gap: 0.72rem;
	}

	.archetype-preview-card__meta {
		display: flex;
		justify-content: flex-start;
	}

	.archetype-preview-card__content {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.archetype-preview-card__content--compact {
		max-width: 420px;
	}

	.archetype-kpi-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.45rem;
	}

	.archetype-kpi {
		padding: 0.5rem 0.55rem;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		border-radius: var(--ui-radius-sm, 9px);
		background: var(--ui-surface-base, #0d0d0d);
	}

	.archetype-kpi__label {
		margin: 0;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(163, 163, 163, 0.85);
	}

	.archetype-kpi__value {
		margin: 0.22rem 0 0;
		font-size: 0.95rem;
		font-weight: 640;
		color: rgba(245, 245, 245, 0.95);
	}

	.archetype-media-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
</style>
