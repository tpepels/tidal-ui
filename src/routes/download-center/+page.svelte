<script lang="ts">
	import DownloadManager from '$lib/components/DownloadManager.svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';

	const meta = getRouteMeta('/download-center');
</script>

<svelte:head>
	<title>{meta?.title ?? 'Download Center'} | BiniLossless</title>
</svelte:head>

<section class="ui-page">
	<header class="ui-page__header">
		<div class="ui-page__title-group">
			<p class="ui-page__eyebrow">Tools</p>
			<h1 class="ui-page__title">{meta?.title ?? 'Download Center'}</h1>
			<p class="ui-page__subtitle">{meta?.subtitle ?? 'Live queue monitoring, controls, and failure recovery tools.'}</p>
		</div>
		<div class="ui-page__actions">
			<a href="/status" class="ui-chip-link">Status</a>
			<a href="/download-log" class="ui-chip-link">Download Log</a>
			<a href="/settings" class="ui-chip-link">Settings</a>
		</div>
	</header>
	<DownloadManager pageMode={true} />
</section>
