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
	{#if tracks.length === 0}
		<StateBlock
			kind="empty"
			title="No tracks available"
			message="Try refreshing this album or search for individual songs."
		/>
	{:else}
		<TrackList {tracks} showAlbum={false} />
	{/if}
</SectionBlock>
