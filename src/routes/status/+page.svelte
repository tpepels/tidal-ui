<script lang="ts">
	import StatusPageContent from '$lib/components/pages/StatusPageContent.svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';

	const meta = getRouteMeta('/status');
</script>

<svelte:head>
	<title>{meta?.title ?? 'Status'} | BiniLossless</title>
</svelte:head>

<StatusPageContent />
