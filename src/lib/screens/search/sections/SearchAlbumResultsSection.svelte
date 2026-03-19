<script lang="ts">
	import { Download, LoaderCircle, RotateCcw, X } from 'lucide-svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import WindowedList from '$lib/components/ui/WindowedList.svelte';
	import EntityRow from '$lib/components/ui/EntityRow.svelte';
	import type { SearchAlbumRowVM } from '$lib/screens/search/searchViewModel';

	interface Props {
		rows: SearchAlbumRowVM[];
		onAction: (row: SearchAlbumRowVM, event: MouseEvent) => Promise<void> | void;
		isMusicBrainzLoading: boolean;
	}

	let { rows, onAction, isMusicBrainzLoading }: Props = $props();
</script>

<SectionBlock
	id="search-section-albums"
	title="Albums"
	count={rows.length}
	status={isMusicBrainzLoading ? 'Matching MusicBrainz…' : null}
	className="ui-perf-block"
>
	<WindowedList
		items={rows}
		itemHeight={120}
		itemHeightMobile={188}
		overscan={6}
		threshold={30}
		className="ui-list-surface"
	>
		{#snippet row(item)}
			{@const rowVm = item as SearchAlbumRowVM}
			<EntityRow item={rowVm.item} windowItem={true}>
				{#snippet action()}
					<button
						onclick={(event) => onAction(rowVm, event)}
						type="button"
						class="ui-list-row__action ui-list-row__action--labeled"
						disabled={rowVm.action.disabled}
						aria-label={rowVm.action.ariaLabel}
						title={rowVm.action.title ?? rowVm.action.ariaLabel}
						aria-busy={rowVm.action.busy ? 'true' : undefined}
					>
						{#if rowVm.canCancel}
							<X size={16} />
						{:else if rowVm.action.busy}
							<LoaderCircle size={16} class="animate-spin" />
						{:else if rowVm.action.icon === 'resume'}
							<RotateCcw size={16} />
						{:else}
							<Download size={16} />
						{/if}
						<span class="ui-list-row__action-label">{rowVm.action.label}</span>
					</button>
				{/snippet}
			</EntityRow>
		{/snippet}
	</WindowedList>
</SectionBlock>
