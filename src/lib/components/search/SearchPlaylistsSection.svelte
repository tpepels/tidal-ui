<script lang="ts">
	import { losslessAPI } from '$lib/api';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
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

<SectionBlock
	id="search-section-playlists"
	title="Playlists"
	count={playlists.length}
	tone="secondary"
	className="ui-perf-block"
>
	<WindowedList
		items={playlists}
		itemHeight={100}
		overscan={6}
		threshold={28}
		className="ui-list-surface"
		dataTone="secondary"
	>
		{#snippet row(item)}
			{@const playlist = item as Playlist}
			<a
				href={`/playlist/${playlist.uuid}`}
				class="ui-list-row ui-list-row--single ui-perf-row"
				data-tone="secondary"
				data-window-item
				aria-label={`Open playlist ${playlist.title}`}
				data-sveltekit-preload-data
			>
				<div class="ui-list-row__text">
					<p class="ui-list-row__title">
						<span class="ui-list-row__title-text">{playlist.title}</span>
					</p>
					<p class="ui-list-row__meta ui-list-row__meta--wrap">
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
</SectionBlock>
