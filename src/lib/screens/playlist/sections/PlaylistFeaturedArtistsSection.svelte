<script lang="ts">
	import EntityRow from '$lib/components/ui/EntityRow.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import type { EntityRowVM } from '$lib/presentation/viewModels';

	type Props = {
		rows: EntityRowVM[];
	};

	let { rows }: Props = $props();
</script>

<SectionBlock
	title="Featured Artists"
	subtitle="Artists promoted in this playlist."
	tone="tertiary"
>
	<div class="ui-list-surface ui-link-row-list">
		{#each rows as row (row.id)}
			<EntityRow item={row} />
		{/each}
	</div>
</SectionBlock>
