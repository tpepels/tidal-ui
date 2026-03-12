<script lang="ts">
	import SearchInterface from '$lib/components/SearchInterface.svelte';
	import type { PlayableTrack } from '$lib/types';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { onMount } from 'svelte';
	import { APP_VERSION } from '$lib/version';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { getRouteMeta } from '$lib/config/routeMeta';

	let { data } = $props();
	const meta = getRouteMeta('/');

	onMount(() => {
		// Clear breadcrumbs on home page
		breadcrumbStore.clearBreadcrumbs();

		if (APP_VERSION) {
			try {
				umami?.track('app_loaded', { version: APP_VERSION, host: window.location.hostname } );
			} catch {
				// Ignore umami tracking errors
			}
		}
	});

	function handleTrackSelect(track: PlayableTrack) {
		// Input validation
		if (!track) {
			console.error('handleTrackSelect called with null/undefined track');
			return;
		}

		try {
			playbackFacade.loadQueue([track], 0, { autoPlay: true });
		} catch (error) {
			console.error('Failed to play track:', error);
			// Could show a toast notification here
		}
	}
</script>

<svelte:head>
	<title>{data.title}</title>
	<meta name="description" content="Cool music streaming haha" />
</svelte:head>

<section class="ui-page" data-ui-archetype="collection" data-ui-route="browse-search">
	<header class="ui-page__header" data-ui-block="page-header">
		<div class="ui-page__title-group">
			<p class="ui-page__eyebrow">Navigation</p>
			<h1 class="ui-page__title">{meta?.title ?? 'Browse & Search'}</h1>
			<p class="ui-page__subtitle">{meta?.subtitle ?? 'Browse and search music'}</p>
		</div>
	</header>
	<div data-ui-block="results">
	<SearchInterface onTrackSelect={handleTrackSelect} />
	</div>
</section>
