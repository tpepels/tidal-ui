<script lang="ts">
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import EntityMediaCard from '$lib/components/ui/EntityMediaCard.svelte';
	import ToolPanel from '$lib/components/ui/ToolPanel.svelte';
	import {
		buildArtistAlbumCoverCandidates as buildAlbumCoverCandidates,
		serializeCoverCandidates
	} from '$lib/presentation/artistCoverPresentation';
	import type { ArtistFeaturedDiscographyAlbum } from '$lib/screens/artist/artistViewModel';
	import { getCoverCacheKey, getResolvedCoverUrl } from '$lib/utils/coverPipeline';
	import type { Album } from '$lib/types';

	type Props = {
		artistId: number;
		artistName: string;
		featuredDiscographyAlbums: ArtistFeaturedDiscographyAlbum[];
		albumCoverOverrides: Record<number, string>;
		albumCoverFailures: Record<number, boolean>;
		coverHydrationGeneration: number;
		formatAlbumMeta: (album: Album) => string | null;
		onAlbumCoverError: (event: Event) => void;
		onAlbumCoverLoad: (event: Event) => void;
	};

	let {
		artistId,
		artistName,
		featuredDiscographyAlbums,
		albumCoverOverrides,
		albumCoverFailures,
		coverHydrationGeneration,
		formatAlbumMeta,
		onAlbumCoverError,
		onAlbumCoverLoad
	}: Props = $props();

	let featuredDiscographyRail = $state<HTMLDivElement | null>(null);

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

{#if featuredDiscographyAlbums.length > 0}
	<ToolPanel
		eyebrow="Secondary"
		title="Discography Highlights"
		subtitle={`Best-known releases from ${artistName}, separated from the full catalog below.`}
		panelRole="artist-discography-highlights"
	>
		<div class="artist-rail-group">
			<div class="artist-rail-group__header">
				<h3 class="artist-rail-group__title">Featured Releases</h3>
				<div class="recommendation-slider__controls">
					<button
						type="button"
						class="recommendation-slider__control"
						onclick={() => scrollRecommendationRail(featuredDiscographyRail, 'left')}
						aria-label="Scroll recommended discography albums left"
					>
						<ChevronLeft size={16} />
					</button>
					<button
						type="button"
						class="recommendation-slider__control"
						onclick={() => scrollRecommendationRail(featuredDiscographyRail, 'right')}
						aria-label="Scroll recommended discography albums right"
					>
						<ChevronRight size={16} />
					</button>
				</div>
			</div>
			<div
				class="recommendation-slider discography-featured__slider"
				role="region"
				aria-label="Recommended albums from this artist discography"
				bind:this={featuredDiscographyRail}
			>
				{#each featuredDiscographyAlbums as featured (`featured:${featured.entry.key}:${featured.entry.representative.id}`)}
					{@const album = featured.entry.representative}
					{@const hasOfficialTidalSource = album.discographySource === 'official_tidal'}
					{@const coverOverride = albumCoverOverrides[album.id]}
					{@const coverImageCandidates = buildAlbumCoverCandidates(
						album,
						featured.entry.versions,
						hasOfficialTidalSource,
						coverOverride
					)}
					{@const coverCacheKey = getCoverCacheKey({
						coverId: coverOverride || album.cover,
						size: '640',
						proxy: hasOfficialTidalSource,
						overrideKey: `artist:${artistId}:album:${album.id}`
					})}
					{@const resolvedCoverUrl = getResolvedCoverUrl(coverCacheKey)}
					{@const coverImageUrl = resolvedCoverUrl ?? coverImageCandidates[0] ?? ''}
					<EntityMediaCard
						type="album"
						href={`/album/${album.id}`}
						title={album.title}
						subtitle={formatAlbumMeta(album)}
						class="recommendation-slider__item discography-featured__item"
						data-recommendation-card="true"
					>
						{#snippet artwork()}
							{#if coverImageCandidates.length > 0 && !albumCoverFailures[album.id]}
								<img
									src={coverImageUrl}
									data-album-id={album.id}
									data-cover-use-proxy={hasOfficialTidalSource ? '1' : '0'}
									data-cover-candidates={serializeCoverCandidates(coverImageCandidates)}
									data-cover-index="0"
									data-cover-generation={coverHydrationGeneration}
									data-cover-recovery-tried="0"
									data-cover-cache-key={coverCacheKey}
									onerror={onAlbumCoverError}
									onload={onAlbumCoverLoad}
									alt={album.title}
									class="h-full w-full object-cover"
									loading="lazy"
									decoding="async"
								/>
							{:else}
								<div class="flex h-full w-full items-center justify-center text-sm text-gray-500">
									No artwork
								</div>
							{/if}
						{/snippet}
					</EntityMediaCard>
				{/each}
			</div>
		</div>
	</ToolPanel>
{/if}

<style>
	.artist-rail-group {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.artist-rail-group__header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
	}

	.artist-rail-group__title {
		margin: 0;
		font-size: 0.96rem;
		font-weight: 700;
		line-height: 1.3;
		color: rgba(238, 238, 238, 0.96);
	}

	.recommendation-slider__controls {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.recommendation-slider__control {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(255, 255, 255, 0.16);
		background: rgba(255, 255, 255, 0.04);
		border-radius: var(--ui-radius-sm, 9px);
		padding: 0.28rem 0.36rem;
		min-width: 2rem;
		min-height: 2rem;
		color: rgba(234, 234, 234, 0.95);
		transition:
			background-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.recommendation-slider__control:hover {
		border-color: rgba(255, 255, 255, 0.3);
		background: rgba(255, 255, 255, 0.11);
		color: rgba(246, 246, 246, 0.98);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.recommendation-slider {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(180px, 220px);
		gap: 0.65rem;
		overflow-x: auto;
		padding: 0.1rem 0.1rem 0.5rem;
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
		padding: 0.62rem;
		gap: 0.46rem;
		border-radius: var(--ui-radius-sm, 9px);
	}

	:global(.recommendation-slider__item .ui-media-card__title) {
		font-size: 0.92rem;
	}

	:global(.recommendation-slider__item .ui-media-card__subtitle) {
		font-size: 0.82rem;
	}

	:global(.recommendation-slider__item .ui-media-card__meta) {
		font-size: 0.76rem;
	}

	.discography-featured__slider {
		padding-top: 0.1rem;
	}

	:global(.discography-featured__item) {
		border-color: rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.02);
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
