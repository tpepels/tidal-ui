<script lang="ts">
	import { ChevronLeft, ChevronRight, User } from 'lucide-svelte';
	import EntityMediaCard from '$lib/components/ui/EntityMediaCard.svelte';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import ToolPanel from '$lib/components/ui/ToolPanel.svelte';
	import { resolveArtistPictureUrl } from '$lib/presentation/catalogPresentation';
	import { getCoverCacheKey, getUnifiedCoverCandidates } from '$lib/utils/coverPipeline';
	import type { Album, Artist, ArtistRecommendations } from '$lib/types';

	type Props = {
		artistId: number;
		artistName: string;
		recommendations: ArtistRecommendations | null;
		recommendationsLoading: boolean;
		recommendationsError: string | null;
		recommendedArtists: Artist[];
		recommendedAlbums: Album[];
		formatAlbumMeta: (album: Album) => string | null;
	};

	let {
		artistId,
		artistName,
		recommendations,
		recommendationsLoading,
		recommendationsError,
		recommendedArtists,
		recommendedAlbums,
		formatAlbumMeta
	}: Props = $props();

	let recommendedArtistsRail = $state<HTMLDivElement | null>(null);
	let recommendedAlbumsRail = $state<HTMLDivElement | null>(null);

	function scrollRecommendationRail(
		rail: HTMLDivElement | null,
		direction: 'left' | 'right'
	): void {
		if (!rail) {
			return;
		}
		const sampleCard = rail.querySelector<HTMLElement>('[data-recommendation-card="true"]');
		const step = sampleCard
			? sampleCard.getBoundingClientRect().width + 14
			: Math.max(rail.clientWidth * 0.85, 260);
		rail.scrollBy({
			left: direction === 'left' ? -step : step,
			behavior: 'smooth'
		});
	}
</script>

<ToolPanel
	eyebrow="Secondary"
	title="Discovery Suggestions"
	subtitle={`Related artists and albums for ${artistName}.`}
	panelRole="artist-discovery"
>
	{#if recommendations?.source === 'artist-mix' && recommendations.mixTitle}
		<p class="ui-action-status">
			Source: {recommendations.mixTitle}
			{#if recommendations.mixSubtitle}
				• {recommendations.mixSubtitle}
			{/if}
		</p>
	{/if}
	{#if recommendationsLoading}
		<StateBlock
			kind="loading"
			title="Loading recommendations"
			message="Fetching related artists and albums."
			embedded={true}
		/>
	{:else if recommendationsError}
		<StateBlock
			kind="error"
			title="Recommendations unavailable"
			message={recommendationsError}
			embedded={true}
		/>
	{:else if recommendedArtists.length > 0 || recommendedAlbums.length > 0}
		<div class="artist-rail-stack">
			{#if recommendedArtists.length > 0}
				<div class="artist-rail-group">
					<div class="artist-rail-group__header">
						<div class="artist-rail-group__title-row">
							<h3 class="artist-rail-group__title">Recommended Artists</h3>
							<span class="recommendation-count-pill">{recommendedArtists.length}</span>
						</div>
						<div class="recommendation-slider__controls">
							<button
								type="button"
								class="recommendation-slider__control"
								onclick={() => scrollRecommendationRail(recommendedArtistsRail, 'left')}
								aria-label="Scroll recommended artists left"
							>
								<ChevronLeft size={16} />
							</button>
							<button
								type="button"
								class="recommendation-slider__control"
								onclick={() => scrollRecommendationRail(recommendedArtistsRail, 'right')}
								aria-label="Scroll recommended artists right"
							>
								<ChevronRight size={16} />
							</button>
						</div>
					</div>
					<div
						class="recommendation-slider"
						role="region"
						aria-label="Recommended artists"
						bind:this={recommendedArtistsRail}
					>
						{#each recommendedArtists as recommendationArtist (recommendationArtist.id)}
							<EntityMediaCard
								type="artist"
								href={`/artist/${recommendationArtist.id}`}
								title={recommendationArtist.name}
								subtitle={recommendationArtist.type || 'Artist'}
								class="recommendation-slider__item"
								data-recommendation-card="true"
							>
								{#snippet artwork()}
									{#if recommendationArtist.picture}
										<img
											src={resolveArtistPictureUrl(recommendationArtist.picture) ?? ''}
											alt={recommendationArtist.name}
											loading="lazy"
										/>
									{:else}
										<div class="flex h-full w-full items-center justify-center text-gray-500">
											<User size={34} />
										</div>
									{/if}
								{/snippet}
							</EntityMediaCard>
						{/each}
					</div>
				</div>
			{/if}
			{#if recommendedAlbums.length > 0}
				<div class="artist-rail-group">
					<div class="artist-rail-group__header">
						<div class="artist-rail-group__title-row">
							<h3 class="artist-rail-group__title">Recommended Albums</h3>
							<span class="recommendation-count-pill">{recommendedAlbums.length}</span>
						</div>
						<div class="recommendation-slider__controls">
							<button
								type="button"
								class="recommendation-slider__control"
								onclick={() => scrollRecommendationRail(recommendedAlbumsRail, 'left')}
								aria-label="Scroll recommended albums left"
							>
								<ChevronLeft size={16} />
							</button>
							<button
								type="button"
								class="recommendation-slider__control"
								onclick={() => scrollRecommendationRail(recommendedAlbumsRail, 'right')}
								aria-label="Scroll recommended albums right"
							>
								<ChevronRight size={16} />
							</button>
						</div>
					</div>
					<div
						class="recommendation-slider"
						role="region"
						aria-label="Recommended albums"
						bind:this={recommendedAlbumsRail}
					>
						{#each recommendedAlbums as recommendationAlbum (recommendationAlbum.id)}
							{@const recommendationCoverCacheKey = getCoverCacheKey({
								coverId: recommendationAlbum.cover,
								size: '640',
								proxy: true,
								overrideKey: `artist:${artistId}:recommendation:${recommendationAlbum.id}`
							})}
							{@const recommendationCoverCandidates = getUnifiedCoverCandidates({
								coverId: recommendationAlbum.cover,
								size: '640',
								proxy: true,
								includeLowerSizes: true
							})}
							<EntityMediaCard
								type="album"
								href={`/album/${recommendationAlbum.id}`}
								title={recommendationAlbum.title}
								subtitle={recommendationAlbum.artist?.name}
								meta={formatAlbumMeta(recommendationAlbum)}
								coverCacheKey={recommendationAlbum.cover ? recommendationCoverCacheKey : null}
								coverCandidates={recommendationAlbum.cover ? recommendationCoverCandidates : []}
								class="recommendation-slider__item"
								data-recommendation-card="true"
							/>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<StateBlock
			kind="empty"
			title="No recommendations yet"
			message="No related artists or albums are available right now."
			embedded={true}
		/>
	{/if}
</ToolPanel>

<style>
	.artist-rail-stack {
		display: flex;
		flex-direction: column;
		gap: 0.82rem;
	}

	.artist-rail-group {
		display: flex;
		flex-direction: column;
		gap: 0.42rem;
	}

	.artist-rail-group__header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.artist-rail-group__title-row {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.artist-rail-group__title {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 700;
		line-height: 1.3;
		color: rgba(238, 238, 238, 0.96);
	}

	.recommendation-count-pill {
		display: inline-flex;
		align-items: center;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: transparent;
		border-radius: var(--ui-radius-sm, 9px);
		padding: 0.14rem 0.42rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: rgba(234, 234, 234, 0.95);
	}

	.recommendation-slider__controls {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
	}

	.recommendation-slider__control {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: transparent;
		border-radius: var(--ui-radius-sm, 9px);
		padding: 0.22rem 0.28rem;
		min-width: 1.8rem;
		min-height: 1.8rem;
		color: rgba(234, 234, 234, 0.95);
		transition:
			background-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.recommendation-slider__control:hover {
		border-color: rgba(255, 255, 255, 0.2);
		background: rgba(255, 255, 255, 0.045);
		color: rgba(246, 246, 246, 0.98);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.recommendation-slider {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(170px, 208px);
		gap: 0.48rem;
		overflow-x: auto;
		padding: 0.05rem 0.05rem 0.32rem;
		scroll-snap-type: x mandatory;
		scrollbar-color: rgba(255, 255, 255, 0.28) rgba(22, 22, 22, 0.4);
		scrollbar-width: thin;
	}

	.recommendation-slider::-webkit-scrollbar {
		height: 8px;
	}

	.recommendation-slider::-webkit-scrollbar-track {
		background: rgba(22, 22, 22, 0.4);
	}

	.recommendation-slider::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.28);
	}

	:global(.recommendation-slider__item) {
		scroll-snap-align: start;
	}

	:global(.recommendation-slider__item.ui-media-card) {
		padding: 0.5rem;
		gap: 0.34rem;
		border-radius: var(--ui-radius-sm, 9px);
	}

	:global(.recommendation-slider__item .ui-media-card__title) {
		font-size: 0.86rem;
	}

	:global(.recommendation-slider__item .ui-media-card__subtitle) {
		font-size: 0.78rem;
	}

	:global(.recommendation-slider__item .ui-media-card__meta) {
		font-size: 0.72rem;
	}

	@media (max-width: 900px) {
		.recommendation-slider {
			grid-auto-columns: minmax(180px, 62vw);
		}
	}

	@media (max-width: 639px) {
		.recommendation-slider {
			grid-auto-columns: minmax(220px, 72vw);
			padding-bottom: 0.35rem;
		}

		.recommendation-slider__controls {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.recommendation-slider__control,
		.recommendation-slider,
		.recommendation-slider * {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
