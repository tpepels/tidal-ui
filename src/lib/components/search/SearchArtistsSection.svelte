<script lang="ts">
	import { losslessAPI } from '$lib/api';
	import type { Artist } from '$lib/types';

	interface Props {
		artists: Artist[];
	}

	let { artists }: Props = $props();

	function getArtistPortraitSrc(artist: Artist): string | null {
		if (typeof artist.picture !== 'string' || artist.picture.trim().length === 0) {
			return null;
		}
		const resolved = losslessAPI.getArtistPictureUrl(artist.picture);
		return resolved.trim().length > 0 ? resolved : null;
	}
</script>

<section
	id="search-section-artists"
	class="search-section search-section--artists ui-perf-block"
	data-tone="secondary"
>
	<header class="search-section__header">
		<h2 class="search-section__title">Artists</h2>
		<span class="search-section__count" data-tone="secondary">{artists.length}</span>
	</header>
	<div class="search-list" data-tone="secondary">
		{#each artists as artist (artist.id)}
			{@const artistPortraitSrc = getArtistPortraitSrc(artist)}
			<a
				href={`/artist/${artist.id}`}
				class="search-row search-row--link ui-perf-row"
				data-tone="secondary"
				aria-label={`Open artist ${artist.name}`}
				data-sveltekit-preload-data
			>
				<div class="search-row__media search-row__media--artist" data-tone="secondary" aria-hidden="true">
					{#if artistPortraitSrc}
						<img src={artistPortraitSrc} alt="" loading="lazy" decoding="async" />
					{:else}
						<span class="search-row__media-fallback">
							{(artist.name?.slice(0, 1) ?? 'A').toUpperCase()}
						</span>
					{/if}
				</div>
				<div class="search-row__content">
					<p class="search-row__title">{artist.name}</p>
					<p class="search-row__meta">
						{artist.type && artist.type.trim().length > 0 ? artist.type : 'Artist'}
					</p>
				</div>
			</a>
		{/each}
	</div>
</section>

<style>
	.search-section {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		min-width: 0;
	}

	.search-section--artists {
		order: 2;
	}

	.search-section__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.search-section__title {
		margin: 0;
		font-size: 1.06rem;
		line-height: 1.28;
		color: var(--ui-tone-secondary-text, rgba(224, 234, 255, 0.96));
	}

	.search-section__count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.75rem;
		height: 1.4rem;
		padding: 0 0.4rem;
		border: 1px solid var(--ui-tone-secondary-border, rgba(159, 185, 246, 0.42));
		border-radius: 999px;
		background: var(--ui-tone-secondary-surface, rgba(104, 136, 210, 0.16));
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--ui-tone-secondary-text, rgba(224, 234, 255, 0.96));
	}

	.search-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--ui-tone-secondary-border, rgba(159, 185, 246, 0.42));
		border-radius: var(--ui-radius-md, 12px);
		background: linear-gradient(
			180deg,
			var(--ui-tone-secondary-surface, rgba(104, 136, 210, 0.16)) 0%,
			var(--ui-surface-raised, #121212) 100%
		);
		overflow: hidden;
	}

	.search-row {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.66rem 0.78rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.07);
		color: inherit;
		text-decoration: none;
	}

	.search-list > :last-child {
		border-bottom: 0;
	}

	.search-row:hover {
		background: var(--ui-tone-secondary-surface-hover, rgba(104, 136, 210, 0.24));
	}

	.search-row__media {
		flex-shrink: 0;
		width: 2.8rem;
		height: 2.8rem;
		border-radius: 999px;
		border: 1px solid var(--ui-tone-secondary-border, rgba(159, 185, 246, 0.42));
		background: rgba(159, 185, 246, 0.12);
		overflow: hidden;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.search-row__media img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.search-row__media-fallback {
		font-size: 0.9rem;
		font-weight: 700;
		color: rgba(216, 216, 216, 0.84);
	}

	.search-row__content {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.search-row__title {
		margin: 0;
		font-size: 1rem;
		line-height: 1.3;
		font-weight: 650;
		color: rgba(243, 243, 243, 0.98);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.search-row__meta {
		margin: 0;
		font-size: 0.87rem;
		line-height: 1.34;
		color: rgba(196, 196, 196, 0.86);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
