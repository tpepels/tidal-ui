<script lang="ts">
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import WindowedList from '$lib/components/ui/WindowedList.svelte';
	import EntityRow from '$lib/components/ui/EntityRow.svelte';
	import type { SearchPlaylistRowVM } from '$lib/screens/search/searchViewModel';

	interface Props {
		rows: SearchPlaylistRowVM[];
	}

	let { rows }: Props = $props();
</script>

<SectionBlock
	id="search-section-playlists"
	title="Playlists"
	count={rows.length}
	tone="secondary"
	className="ui-perf-block"
>
	<WindowedList
		items={rows}
		itemHeight={100}
		itemHeightMobile={132}
		overscan={6}
		threshold={28}
		className="ui-list-surface"
		dataTone="secondary"
	>
		{#snippet row(item)}
			<EntityRow item={(item as SearchPlaylistRowVM).item} windowItem={true} />
		{/snippet}
	</WindowedList>
</SectionBlock>
