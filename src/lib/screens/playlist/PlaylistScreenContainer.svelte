<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { losslessAPI } from '$lib/api';
	import StateNotice from '$lib/components/ui/StateNotice.svelte';
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import type { Playlist, Track } from '$lib/types';
	import { ArrowLeft } from 'lucide-svelte';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import PlaylistActionsSection from '$lib/screens/playlist/sections/PlaylistActionsSection.svelte';
	import PlaylistFeaturedArtistsSection from '$lib/screens/playlist/sections/PlaylistFeaturedArtistsSection.svelte';
	import PlaylistHeroSection from '$lib/screens/playlist/sections/PlaylistHeroSection.svelte';
	import PlaylistMetadataSection from '$lib/screens/playlist/sections/PlaylistMetadataSection.svelte';
	import PlaylistTracksSection from '$lib/screens/playlist/sections/PlaylistTracksSection.svelte';
	import {
		buildPlaylistActionButtons,
		buildPlaylistFeaturedArtistRows,
		buildPlaylistHeroViewModel,
		buildPlaylistMetadataFacts,
		buildPlaylistSectionNavItems
	} from '$lib/screens/playlist/playlistViewModel';

	let playlist = $state<Playlist | null>(null);
	let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let activeRequestToken = 0;

	const playlistId = $derived($page.params.id);
	const sectionNavItems = $derived.by(() =>
		buildPlaylistSectionNavItems({
			hasFeaturedArtists: Boolean(playlist?.promotedArtists?.length)
		})
	);
	const heroViewModel = $derived.by(() => (playlist ? buildPlaylistHeroViewModel(playlist) : null));
	const actionButtons = $derived.by(() => buildPlaylistActionButtons());
	const metadataFacts = $derived.by(() => (playlist ? buildPlaylistMetadataFacts(playlist) : []));
	const featuredArtistRows = $derived.by(() =>
		playlist ? buildPlaylistFeaturedArtistRows(playlist) : []
	);

	$effect(() => {
		const normalizedPlaylistId = (playlistId ?? '').trim();
		if (!normalizedPlaylistId) {
			playlist = null;
			tracks = [];
			error = 'Invalid playlist id';
			isLoading = false;
			return;
		}
		const requestToken = ++activeRequestToken;
		void loadPlaylist(normalizedPlaylistId, requestToken);
	});

	async function loadPlaylist(id: string, requestToken: number) {
		try {
			isLoading = true;
			error = null;
			const data = await losslessAPI.getPlaylist(id);
			if (requestToken !== activeRequestToken) {
				return;
			}
			playlist = data.playlist;
			tracks = data.items.map((item) => item.item);
			breadcrumbStore.setParent(`/playlist/${data.playlist.uuid}`, '/');
			breadcrumbStore.setCurrentLabel(data.playlist.title, `/playlist/${data.playlist.uuid}`);
		} catch (err) {
			if (requestToken === activeRequestToken) {
				error = err instanceof Error ? err.message : 'Failed to load playlist';
				console.error('Failed to load playlist:', err);
			}
		} finally {
			if (requestToken === activeRequestToken) {
				isLoading = false;
			}
		}
	}

	function handlePlayAll() {
		if (tracks.length > 0) {
			playbackFacade.loadQueue(tracks, 0, { autoPlay: true });
		}
	}

	function handleBackNavigation() {
		const target = breadcrumbStore.goBack($page.url.pathname, '/');
		void goto(target);
	}

	function handlePlaylistAction(actionId: string): void {
		if (actionId === 'play') {
			handlePlayAll();
		}
	}
</script>

<svelte:head>
	<title>{playlist?.title || 'Playlist'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div
		class="ui-page flex items-center justify-center py-24"
		data-ui-archetype="detail"
		data-ui-route="playlist"
	>
		<StateNotice
			tone="info"
			title="Loading playlist"
			message="Fetching playlist details and playable tracks."
			busy={true}
		/>
	</div>
{:else if error}
	<div class="ui-page py-12" data-ui-archetype="detail" data-ui-route="playlist">
		<div class="ui-surface-card border-red-500/40 bg-red-950/20 p-6">
			<StateNotice tone="error" title="Error loading playlist" message={error} />
			<a
				href="/"
				class="ui-action-button mt-4 inline-flex"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if playlist}
	<div
		class="ui-page space-y-6 pb-32 pt-4 lg:pb-40"
		data-ui-archetype="detail"
		data-ui-route="playlist"
		data-ui-block="main-content"
	>
		<!-- Back Button -->
		<button
			onclick={handleBackNavigation}
			class="ui-chip-button ui-chip-button--compact ui-detail-back"
			data-ui-block="back-nav"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		{#if heroViewModel}
			<PlaylistHeroSection hero={heroViewModel} />
		{/if}

		<PageSectionNav items={sectionNavItems} sticky={true} />

		<div class="ui-detail-columns">
			<div class="ui-detail-main">
				{#if tracks.length > 0}
					<section id="playlist-tracks" class="ui-section-anchor" data-ui-block="main-content">
						<PlaylistTracksSection {tracks} />
					</section>
				{:else}
					<section id="playlist-tracks" class="ui-section-anchor" data-ui-block="main-content">
						<PlaylistTracksSection {tracks} />
					</section>
				{/if}
			</div>

			<div class="ui-detail-sidebar">
				{#if tracks.length > 0}
					<section id="playlist-actions" class="ui-section-anchor" data-ui-block="primary-actions">
						<PlaylistActionsSection
							playlistId={playlist.uuid}
							actions={actionButtons}
							onAction={handlePlaylistAction}
						/>
					</section>
				{/if}

				<section id="playlist-metadata" class="ui-section-anchor" data-ui-block="context-metadata">
					<PlaylistMetadataSection facts={metadataFacts} />
				</section>

				{#if playlist.promotedArtists && playlist.promotedArtists.length > 0}
					<section id="playlist-artists" class="ui-section-anchor" data-ui-block="secondary-content">
						<PlaylistFeaturedArtistsSection rows={featuredArtistRows} />
					</section>
				{/if}
			</div>
		</div>
	</div>
{/if}
