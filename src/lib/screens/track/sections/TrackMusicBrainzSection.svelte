<script lang="ts">
	import DetailFactsGrid from '$lib/components/ui/DetailFactsGrid.svelte';
	import DetailLinkChips from '$lib/components/ui/DetailLinkChips.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import StateNotice from '$lib/components/ui/StateNotice.svelte';
	import type { TrackMusicBrainzSectionVM } from '$lib/screens/track/trackViewModel';

	type Props = {
		viewModel: TrackMusicBrainzSectionVM;
		isLoading: boolean;
		onRefresh: () => void;
	};

	let { viewModel, isLoading, onRefresh }: Props = $props();
</script>

<SectionBlock
	title="MusicBrainz"
	subtitle="Resolved track metadata."
	tone="tertiary"
>
	<svelte:fragment slot="actions">
		<button
			type="button"
			onclick={onRefresh}
			class="ui-chip-button ui-chip-button--compact"
			disabled={isLoading}
		>
			{#if isLoading}
				Refreshing…
			{:else}
				Refresh Metadata
			{/if}
		</button>
	</svelte:fragment>

	{#if viewModel.facts.length > 0}
		<DetailFactsGrid facts={viewModel.facts} />
	{/if}

	{#if viewModel.artistLinks.length > 0}
		<p class="ui-section-block__eyebrow">Recording Artists</p>
		<DetailLinkChips links={viewModel.artistLinks} />
	{/if}

	{#if viewModel.albumArtistLinks.length > 0}
		<p class="ui-section-block__eyebrow">Album Artists</p>
		<DetailLinkChips links={viewModel.albumArtistLinks} />
	{/if}

	<DetailLinkChips links={viewModel.links} />

	{#if viewModel.identifierFacts.length > 0}
		<details class="track-metadata__details">
			<summary>Show MusicBrainz IDs</summary>
			<DetailFactsGrid facts={viewModel.identifierFacts} />
		</details>
	{/if}

	{#each viewModel.notices as notice, index (`${notice.tone}:${index}`)}
		<StateNotice
			tone={notice.tone}
			title={notice.title}
			message={notice.message}
			busy={notice.busy}
			compact={true}
			liveRegion={notice.liveRegion}
		/>
	{/each}
</SectionBlock>

<style>
	.track-metadata__details {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-top: 0.35rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
	}

	.track-metadata__details summary {
		font-size: 0.9rem;
		font-weight: 600;
		color: rgba(220, 220, 220, 0.84);
	}
</style>
