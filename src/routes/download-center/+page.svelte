<script lang="ts">
	import DownloadManager from '$lib/components/DownloadManager.svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';

	const meta = getRouteMeta('/download-center');
</script>

<svelte:head>
	<title>{meta?.title ?? 'Download Center'} | BiniLossless</title>
</svelte:head>

<section class="ui-page" data-ui-archetype="tool" data-ui-route="download-center">
	<header class="ui-page__header" data-ui-block="page-header">
		<div class="ui-page__title-group">
			<p class="ui-page__eyebrow">Tools</p>
			<h1 class="ui-page__title">{meta?.title ?? 'Download Center'}</h1>
			<p class="ui-page__subtitle">{meta?.subtitle ?? 'Live queue monitoring, controls, and failure recovery tools.'}</p>
		</div>
	</header>
	<DownloadManager pageMode={true} />
</section>
