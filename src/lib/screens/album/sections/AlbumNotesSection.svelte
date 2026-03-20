<script lang="ts">
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';

	type Props = {
		copyright: string;
	};

	let { copyright }: Props = $props();
</script>

<SectionBlock title="Notes" subtitle="Rights and release notes.">
	<p class="ui-detail-note">{copyright}</p>
</SectionBlock>
