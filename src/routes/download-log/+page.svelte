<script lang="ts">
	import DownloadLog from '$lib/components/DownloadLog.svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';

	const meta = getRouteMeta('/download-log');
</script>

<svelte:head>
	<title>{meta?.title ?? 'Download Log'} | BiniLossless</title>
</svelte:head>

<section class="ui-page">
	<header class="ui-page__header">
		<div class="ui-page__title-group">
			<p class="ui-page__eyebrow">Tools</p>
			<h1 class="ui-page__title">{meta?.title ?? 'Download Log'}</h1>
			<p class="ui-page__subtitle">{meta?.subtitle ?? 'Live download events, health checks, and cleanup tools.'}</p>
		</div>
	</header>
	<DownloadLog />
</section>
