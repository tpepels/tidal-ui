<script lang="ts">
	import SettingsScreenContainer from '$lib/screens/settings/SettingsScreenContainer.svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';

	const meta = getRouteMeta('/settings');
</script>

<svelte:head>
	<title>{meta?.title ?? 'Settings'} | BiniLossless</title>
</svelte:head>

<section class="ui-page" data-ui-archetype="tool" data-ui-route="settings">
	<header class="ui-page__header" data-ui-block="page-header">
		<div class="ui-page__title-group">
			<p class="ui-page__eyebrow">Tools</p>
			<h1 class="ui-page__title">{meta?.title ?? 'Settings'}</h1>
			<p class="ui-page__subtitle">{meta?.subtitle ?? 'Streaming, download, and maintenance controls.'}</p>
		</div>
	</header>
	<SettingsScreenContainer />
</section>
