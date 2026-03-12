<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { losslessAPI } from '$lib/api';
	import TrackList from '$lib/components/TrackList.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import EntityMediaCard from '$lib/components/ui/EntityMediaCard.svelte';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import type { Playlist, Track } from '$lib/types';
	import { ArrowLeft, Play, User, Clock, LoaderCircle } from 'lucide-svelte';
	import { playbackFacade } from '$lib/controllers/playbackFacade';

	let playlist = $state<Playlist | null>(null);
	let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let activeRequestToken = 0;

	const playlistId = $derived($page.params.id);

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

	function formatDuration(seconds: number): string {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		if (hours > 0) {
			return `${hours} hr ${minutes} min`;
		}
		return `${minutes} min`;
	}

	function handleBackNavigation() {
		const target = breadcrumbStore.goBack($page.url.pathname, '/');
		void goto(target);
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
		<LoaderCircle class="h-16 w-16 animate-spin text-white/80" />
	</div>
{:else if error}
	<div class="ui-page py-12" data-ui-archetype="detail" data-ui-route="playlist">
		<div class="ui-surface-card border-red-500/40 bg-red-950/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-200">Error Loading Playlist</h2>
			<p class="text-red-100/85">{error}</p>
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

		<!-- Playlist Header -->
		<div class="ui-surface-card flex flex-col gap-8 p-5 md:flex-row" data-ui-block="entity-hero">
			<!-- Playlist Cover -->
			{#if playlist.squareImage || playlist.image}
				<div
					class="aspect-square w-full flex-shrink-0 overflow-hidden rounded-xl border border-white/12 bg-white/5 md:w-80"
				>
					<img
						src={losslessAPI.getCoverUrl(playlist.squareImage || playlist.image, '640')}
						alt={playlist.title}
						class="h-full w-full object-cover"
					/>
				</div>
			{/if}

			<!-- Playlist Info -->
			<div class="flex flex-1 flex-col justify-end">
				<p class="mb-2 text-base text-gray-400">PLAYLIST</p>
				<h1 class="mb-4 text-4xl font-bold md:text-6xl">{playlist.title}</h1>

				{#if playlist.description}
					<p class="mb-4 text-gray-300">{playlist.description}</p>
				{/if}

				<div class="mb-4 flex items-center gap-2">
					{#if playlist.creator.picture}
						<img
							src={losslessAPI.getCoverUrl(playlist.creator.picture, '80')}
							alt={playlist.creator.name}
							class="h-8 w-8 rounded-full"
						/>
					{:else}
						<div class="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700">
							<User size={16} class="text-gray-400" />
						</div>
					{/if}
					<span class="text-base text-gray-300">{playlist.creator.name}</span>
				</div>

				<div class="mb-6 flex flex-wrap items-center gap-4 text-base text-gray-400">
					<div>{playlist.numberOfTracks} tracks</div>
					{#if playlist.duration}
						<div class="flex items-center gap-1">
							<Clock size={16} />
							{formatDuration(playlist.duration)}
						</div>
					{/if}
					{#if playlist.type}
						<div class="ui-meta-pill">
							{playlist.type}
						</div>
					{/if}
				</div>

				{#if tracks.length > 0}
					<div class="ui-action-row ui-action-row--progressive" data-ui-block="primary-actions">
						<button
							onclick={handlePlayAll}
							class="ui-action-button ui-action-button--primary"
							aria-label="Play playlist"
						>
							<Play size={16} fill="currentColor" />
							Play Playlist
						</button>
						<ShareButton type="playlist" id={playlist.uuid} variant="secondary" />
					</div>
				{/if}
			</div>
		</div>

		<!-- Promoted Artists -->
		{#if playlist.promotedArtists && playlist.promotedArtists.length > 0}
			<div data-ui-block="secondary-content">
				<h3 class="mb-3 text-base font-semibold text-gray-400">Featured Artists</h3>
				<div class="ui-media-grid ui-media-grid--artists">
					{#each playlist.promotedArtists as artist (artist.id)}
						<EntityMediaCard
							type="artist"
							href={`/artist/${artist.id}`}
							title={artist.name}
							subtitle={artist.type || 'Artist'}
							imageSrc={artist.picture ? losslessAPI.getArtistPictureUrl(artist.picture) : null}
							imageAlt={`Portrait of ${artist.name}`}
							links={[{ href: `/artist/${artist.id}`, label: 'Artist Page' }]}
						/>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Tracks -->
		{#if tracks.length > 0}
			<div class="mt-8" data-ui-block="main-content">
				<h2 class="mb-4 text-2xl font-bold">Tracks</h2>
				<TrackList {tracks} />
			</div>
		{:else}
			<div class="ui-surface-card p-6 text-gray-400" data-ui-block="main-content">
				<p>No tracks in this playlist.</p>
			</div>
		{/if}

		<!-- Metadata -->
		<div class="ui-surface-card space-y-1 p-3 text-sm text-gray-500" data-ui-block="context-metadata">
			{#if playlist.created}
				<p>Created: {new Date(playlist.created).toLocaleDateString()}</p>
			{/if}
			{#if playlist.lastUpdated}
				<p>Last updated: {new Date(playlist.lastUpdated).toLocaleDateString()}</p>
			{/if}
		</div>
	</div>
{/if}
