<script lang="ts">
	import SearchInterface from '$lib/components/SearchInterface.svelte';
	import type { PlayableTrack } from '$lib/types';
	import { playerStore } from '$lib/stores/player';
	import { onMount } from 'svelte';
	import { APP_VERSION } from '$lib/version';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';

	let { data } = $props();

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
			playerStore.setQueue([track], 0);
			playerStore.play();
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

<div class="space-y-8">
	<!-- Search Interface -->
	<SearchInterface onTrackSelect={handleTrackSelect} />
</div>
