<script lang="ts">
	import { losslessAPI } from '$lib/api';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import WindowedList from '$lib/components/ui/WindowedList.svelte';
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

<SectionBlock
	id="search-section-artists"
	title="Artists"
	count={artists.length}
	tone="secondary"
	className="ui-perf-block"
>
	<WindowedList
		items={artists}
		itemHeight={104}
		itemHeightMobile={132}
		overscan={6}
		threshold={28}
		className="ui-list-surface"
		dataTone="secondary"
	>
		{#snippet row(item)}
			{@const artist = item as Artist}
			{@const artistPortraitSrc = getArtistPortraitSrc(artist)}
			<a
				href={`/artist/${artist.id}`}
				class="ui-list-row ui-list-row--single ui-perf-row"
				data-tone="secondary"
				data-window-item
				aria-label={`Open artist ${artist.name}`}
				data-sveltekit-preload-data
			>
				<div class="ui-list-row__media ui-list-row__media--circle" aria-hidden="true">
					{#if artistPortraitSrc}
						<img src={artistPortraitSrc} alt="" loading="lazy" decoding="async" />
					{:else}
						<span class="ui-list-row__media-fallback">
							{(artist.name?.slice(0, 1) ?? 'A').toUpperCase()}
						</span>
					{/if}
				</div>
				<div class="ui-list-row__text">
					<p class="ui-list-row__title">
						<span class="ui-list-row__title-text">{artist.name}</span>
					</p>
					<p class="ui-list-row__meta">
						{artist.type && artist.type.trim().length > 0 ? artist.type : 'Artist'}
					</p>
				</div>
			</a>
		{/snippet}
	</WindowedList>
</SectionBlock>
