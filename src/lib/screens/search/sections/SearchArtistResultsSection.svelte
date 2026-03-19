<script lang="ts">
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import WindowedList from '$lib/components/ui/WindowedList.svelte';
	import EntityRow from '$lib/components/ui/EntityRow.svelte';
	import type { SearchArtistRowVM } from '$lib/screens/search/searchViewModel';

	interface Props {
		rows: SearchArtistRowVM[];
	}

	let { rows }: Props = $props();
</script>

<SectionBlock
	id="search-section-artists"
	title="Artists"
	count={rows.length}
	tone="secondary"
	className="ui-perf-block"
>
	<WindowedList
		items={rows}
		itemHeight={104}
		itemHeightMobile={132}
		overscan={6}
		threshold={28}
		className="ui-list-surface"
		dataTone="secondary"
	>
		{#snippet row(item)}
			<EntityRow item={(item as SearchArtistRowVM).item} windowItem={true} />
		{/snippet}
	</WindowedList>
</SectionBlock>
