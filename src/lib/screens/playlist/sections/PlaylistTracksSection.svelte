<script lang="ts">
	import TrackList from '$lib/components/TrackList.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import type { Track } from '$lib/types';

	type Props = {
		tracks: Track[];
	};

	let { tracks }: Props = $props();
</script>

<SectionBlock title="Tracks" count={tracks.length}>
	{#if tracks.length > 0}
		<TrackList {tracks} />
	{:else}
		<StateBlock
			kind="empty"
			title="No tracks in this playlist"
			message="The playlist currently has no playable tracks."
		/>
	{/if}
</SectionBlock>
