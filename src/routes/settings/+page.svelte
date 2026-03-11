<script lang="ts">
	import SettingsPageContent from '$lib/components/pages/SettingsPageContent.svelte';
	import ToolNavGrid from '$lib/components/ui/ToolNavGrid.svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';

	const meta = getRouteMeta('/settings');
</script>

<svelte:head>
	<title>{meta?.title ?? 'Settings'} | BiniLossless</title>
</svelte:head>

<section class="ui-page">
	<header class="ui-page__header">
		<div class="ui-page__title-group">
			<p class="ui-page__eyebrow">Tools</p>
			<h1 class="ui-page__title">{meta?.title ?? 'Settings'}</h1>
			<p class="ui-page__subtitle">{meta?.subtitle ?? 'Streaming, download, and maintenance controls.'}</p>
		</div>
		<div class="ui-page__actions">
			<a href="/status" class="ui-chip-link">Status</a>
			<a href="/download-center" class="ui-chip-link">Download Center</a>
			<a href="/download-log" class="ui-chip-link">Download Log</a>
		</div>
	</header>
	<ToolNavGrid current="/settings" />
	<SettingsPageContent />
</section>
