<script lang="ts">
	import DetailFactsGrid from '$lib/components/ui/DetailFactsGrid.svelte';
	import DetailLinkChips from '$lib/components/ui/DetailLinkChips.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import StateNotice from '$lib/components/ui/StateNotice.svelte';
	import type { ArtistMusicBrainzSectionVM } from '$lib/screens/artist/artistViewModel';

	type Props = {
		viewModel: ArtistMusicBrainzSectionVM;
		isLoading: boolean;
		onRefresh: () => void;
		onSelectionChange: (value: string) => void;
	};

	let { viewModel, isLoading, onRefresh, onSelectionChange }: Props = $props();
</script>

<SectionBlock
	title="MusicBrainz"
	subtitle="Resolved artist identity and facts."
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
				Refresh Match
			{/if}
		</button>
	</svelte:fragment>

	{#if viewModel.options.length > 0}
		<label class="ui-section-block__eyebrow" for="musicbrainz-artist-select">
			Selected Artist
		</label>
		<select
			id="musicbrainz-artist-select"
			class="ui-select w-full"
			value={viewModel.selectedArtistId}
			onchange={(event) => onSelectionChange((event.currentTarget as HTMLSelectElement).value)}
		>
			{#each viewModel.options as option (option.id)}
				<option value={option.id}>{option.label}</option>
			{/each}
		</select>
		{#if viewModel.hasSelection}
			<DetailFactsGrid facts={viewModel.facts} />
			<DetailLinkChips links={viewModel.links} />
		{/if}
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
