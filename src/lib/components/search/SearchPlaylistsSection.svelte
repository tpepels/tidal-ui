<script lang="ts">
	import { losslessAPI } from '$lib/api';
	import WindowedList from '$lib/components/ui/WindowedList.svelte';
	import type { Playlist } from '$lib/types';

	interface Props {
		playlists: Playlist[];
	}

	let { playlists }: Props = $props();

	function displayTrackTotal(total?: number | null): number {
		if (!Number.isFinite(total)) return 0;
		return total && total > 0 ? total : (total ?? 0);
	}
</script>

<section
	id="search-section-playlists"
	class="search-section search-section--playlists ui-perf-block"
	data-tone="secondary"
>
	<header class="search-section__header">
		<h2 class="search-section__title">Playlists</h2>
		<span class="search-section__count">{playlists.length}</span>
	</header>
	<WindowedList
		items={playlists}
		itemHeight={70}
		overscan={6}
		threshold={28}
		className="search-list"
		dataTone="secondary"
	>
		{#snippet row(item)}
			{@const playlist = item as Playlist}
			<a
				href={`/playlist/${playlist.uuid}`}
				class="search-row search-row--link ui-perf-row"
				data-window-item
				aria-label={`Open playlist ${playlist.title}`}
				data-sveltekit-preload-data
			>
				<div class="search-row__content">
					<p class="search-row__title">{playlist.title}</p>
					<p class="search-row__meta">
						{playlist.creator.name} • {displayTrackTotal(playlist.numberOfTracks)} track{displayTrackTotal(
							playlist.numberOfTracks
						) === 1
							? ''
							: 's'}
						{#if playlist.duration}
							• {losslessAPI.formatDuration(playlist.duration)}
						{/if}
					</p>
				</div>
			</a>
		{/snippet}
	</WindowedList>
</section>

<style>
	.search-section {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		min-width: 0;
	}

	.search-section--playlists {
		order: 4;
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

	.search-section :global(.search-list) {
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

	.search-section :global(.search-list > :last-child) {
		border-bottom: 0;
	}

	.search-row:hover {
		background: var(--ui-tone-secondary-surface-hover, rgba(104, 136, 210, 0.24));
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
