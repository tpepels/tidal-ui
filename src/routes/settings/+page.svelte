<script lang="ts">
	import SettingsPageContent from '$lib/components/pages/SettingsPageContent.svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';

	const meta = getRouteMeta('/settings');
</script>

<svelte:head>
	<title>{meta?.title ?? 'Settings'} | BiniLossless</title>
</svelte:head>

<section class="settings-page">
	<header class="settings-page__header">
		<h1>{meta?.title ?? 'Settings'}</h1>
		<p>{meta?.subtitle ?? 'Streaming, download, and maintenance controls.'}</p>
	</header>
	<SettingsPageContent />
</section>

<style>
	.settings-page {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.settings-page__header h1 {
		margin: 0;
		font-size: 1.2rem;
	}

	.settings-page__header p {
		margin: 0.2rem 0 0;
		font-size: 0.82rem;
		opacity: 0.78;
	}
</style>
