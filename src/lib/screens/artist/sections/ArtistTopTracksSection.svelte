<script lang="ts">
	import TopTracksGrid from '$lib/components/TopTracksGrid.svelte';
	import type { Track } from '$lib/types';

	type Props = {
		topTracks: Track[];
		artistName: string;
	};

	let { topTracks, artistName }: Props = $props();
</script>

<section data-ui-block="main-content">
	<div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
		<div>
			<h2 class="text-2xl font-semibold text-white">Top Tracks</h2>
			<p class="text-sm text-gray-400">Best songs from {artistName}.</p>
		</div>
	</div>
	{#if topTracks.length > 0}
		<div class="ui-surface-card mt-6 overflow-hidden p-4">
			<TopTracksGrid tracks={topTracks} />
		</div>
	{:else}
		<div class="ui-surface-card mt-6 p-6 text-sm text-gray-400">
			<p>No top tracks available for this artist yet.</p>
		</div>
	{/if}
</section>
