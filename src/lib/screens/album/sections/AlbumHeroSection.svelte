<script lang="ts">
	import DetailHeroSection from '$lib/components/ui/DetailHeroSection.svelte';
	import StateNotice from '$lib/components/ui/StateNotice.svelte';
	import type { DetailHeroVM, StateNoticeVM } from '$lib/presentation/viewModels';

	type Props = {
		hero: DetailHeroVM;
		notices: StateNoticeVM[];
	};

	let { hero, notices }: Props = $props();
</script>

<DetailHeroSection {hero} />

{#each notices as notice, index (`${notice.tone}:${index}`)}
	<StateNotice
		tone={notice.tone}
		title={notice.title}
		message={notice.message}
		busy={notice.busy}
		compact={true}
		liveRegion={notice.liveRegion}
	/>
{/each}
