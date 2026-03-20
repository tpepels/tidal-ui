<script lang="ts">
	import StatusScreenContainer from '$lib/screens/status/StatusScreenContainer.svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';

	const meta = getRouteMeta('/status');
</script>

<svelte:head>
	<title>{meta?.title ?? 'Status'} | BiniLossless</title>
</svelte:head>

<StatusScreenContainer />
