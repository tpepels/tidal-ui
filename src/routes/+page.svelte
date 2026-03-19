<script lang="ts">
	import SearchScreenContainer from '$lib/screens/search/SearchScreenContainer.svelte';

	let { data } = $props();
</script>

<SearchScreenContainer pageTitle={data.title} />
