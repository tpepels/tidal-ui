<script lang="ts">
	import DataGrid from '$lib/components/ui/DataGrid.svelte';
	import type { DetailFactVM } from '$lib/presentation/viewModels';

	type Props = {
		facts: DetailFactVM[];
	};

	let { facts }: Props = $props();
</script>

{#if facts.length > 0}
	<DataGrid className="ui-data-grid--detail" gridRole="detail-facts">
		{#each facts as fact (fact.label)}
			<div class="ui-data-point">
				<p class="ui-data-point__label">{fact.label}</p>
				<p class="ui-data-point__value">{fact.value}</p>
			</div>
		{/each}
	</DataGrid>
{/if}
