<script lang="ts">
	import DetailFactsGrid from '$lib/components/ui/DetailFactsGrid.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import type { DetailFactVM } from '$lib/presentation/viewModels';

	type Props = {
		facts: DetailFactVM[];
	};

	let { facts }: Props = $props();
</script>

<SectionBlock title="Metadata" subtitle="Created and updated timestamps.">
	<DetailFactsGrid {facts} />
</SectionBlock>
