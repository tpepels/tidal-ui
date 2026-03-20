<script lang="ts">
	import DetailHeroSection from '$lib/components/ui/DetailHeroSection.svelte';
	import type { DetailHeroVM } from '$lib/presentation/viewModels';

	type Props = {
		hero: DetailHeroVM;
	};

	let { hero }: Props = $props();
</script>

<DetailHeroSection {hero} />
