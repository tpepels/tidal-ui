<script lang="ts">
	import TrackDownloadButton from '$lib/components/TrackDownloadButton.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import WindowedList from '$lib/components/ui/WindowedList.svelte';
	import EntityRow from '$lib/components/ui/EntityRow.svelte';
	import type { SearchTrackRowVM } from '$lib/screens/search/searchViewModel';
	import type { PlayableTrack } from '$lib/types';

	type TrackId = number | string;

	interface Props {
		rows: SearchTrackRowVM[];
		onTrackSelect?: (track: PlayableTrack) => void;
		onDownload: (track: PlayableTrack, event?: MouseEvent) => Promise<void> | void;
		onCancel: (trackId: TrackId, event?: MouseEvent) => Promise<void> | void;
	}

	let { rows, onTrackSelect, onDownload, onCancel }: Props = $props();
</script>

<SectionBlock
	id="search-section-tracks"
	title="Songs"
	count={rows.length}
	tone="tertiary"
	className="ui-perf-block"
>
	<WindowedList
		items={rows}
		itemHeight={110}
		itemHeightMobile={152}
		overscan={6}
		threshold={30}
		className="ui-list-surface"
		dataTone="tertiary"
	>
		{#snippet row(item)}
			{@const rowVm = item as SearchTrackRowVM}
			<EntityRow
				item={rowVm.item}
				windowItem={true}
				onPrimaryAction={() => onTrackSelect?.(rowVm.track)}
			>
				{#snippet action()}
					<TrackDownloadButton
						isDownloading={rowVm.isDownloading}
						isCancelled={rowVm.isCancelled}
						onCancel={(event) => onCancel(rowVm.track.id, event)}
						onDownload={(event) => onDownload(rowVm.track, event)}
						title={rowVm.isDownloading ? 'Cancel download' : `${rowVm.downloadActionLabel} track`}
						ariaLabel={rowVm.isDownloading
							? `Cancel download for ${rowVm.track.title}`
							: `${rowVm.downloadActionLabel} ${rowVm.track.title}`}
						class="ui-list-row__action"
					/>
				{/snippet}
			</EntityRow>
		{/snippet}
	</WindowedList>
</SectionBlock>
