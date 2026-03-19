<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { losslessAPI } from '$lib/api';
	import TrackList from '$lib/components/TrackList.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import DataGrid from '$lib/components/ui/DataGrid.svelte';
	import MetaStrip from '$lib/components/ui/MetaStrip.svelte';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
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
	const sectionNavItems = $derived.by(() => {
		const items: Array<{
			id: string;
			label: string;
			tone?: 'secondary' | 'tertiary';
		}> = [
			{ id: 'playlist-actions', label: 'Actions', tone: 'secondary' as const },
			{ id: 'playlist-tracks', label: 'Tracks' }
		];
		if (playlist?.promotedArtists && playlist.promotedArtists.length > 0) {
			items.push({ id: 'playlist-artists', label: 'Featured Artists', tone: 'tertiary' as const });
		}
		items.push({ id: 'playlist-metadata', label: 'Metadata' });
		return items;
	});

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

		<section class="ui-detail-hero" data-ui-block="entity-hero">
			<div class="ui-detail-hero__layout">
				{#if playlist.squareImage || playlist.image}
					<div class="ui-detail-hero__art">
						<img
							src={losslessAPI.getCoverUrl(playlist.squareImage || playlist.image, '640')}
							alt={playlist.title}
						/>
					</div>
				{/if}

				<div class="ui-detail-hero__body">
					<p class="ui-detail-hero__eyebrow">Playlist</p>
					<h1 class="ui-detail-hero__title">{playlist.title}</h1>

					{#if playlist.description}
						<p class="ui-detail-hero__description">{playlist.description}</p>
					{/if}

					<MetaStrip>
						<div class="ui-meta-strip__item">
							{#if playlist.creator.picture}
								<img
									src={losslessAPI.getCoverUrl(playlist.creator.picture, '80')}
									alt={playlist.creator.name}
									class="h-8 w-8 rounded-full"
								/>
							{:else}
								<span class="ui-link-row__media ui-link-row__media--circle h-8 w-8">
									<User size={14} class="text-gray-400" />
								</span>
							{/if}
							{playlist.creator.name}
						</div>
						<div class="ui-meta-strip__item">{playlist.numberOfTracks} tracks</div>
						{#if playlist.duration}
							<div class="ui-meta-strip__item">
								<Clock size={16} />
								{formatDuration(playlist.duration)}
							</div>
						{/if}
						{#if playlist.type}
							<span class="ui-inline-tag">{playlist.type}</span>
						{/if}
					</MetaStrip>
				</div>
			</div>
		</section>

		<PageSectionNav items={sectionNavItems} sticky={true} />

		<div class="ui-detail-columns">
			<div class="ui-detail-main">
				{#if tracks.length > 0}
					<section id="playlist-tracks" class="ui-section-anchor" data-ui-block="main-content">
						<SectionBlock title="Tracks" count={tracks.length}>
							<TrackList {tracks} />
						</SectionBlock>
					</section>
				{:else}
					<section id="playlist-tracks" class="ui-section-anchor" data-ui-block="main-content">
						<SectionBlock title="Tracks" count={0}>
							<StateBlock
								kind="empty"
								title="No tracks in this playlist"
								message="The playlist currently has no playable tracks."
							/>
						</SectionBlock>
					</section>
				{/if}
			</div>

			<div class="ui-detail-sidebar">
				{#if tracks.length > 0}
					<section id="playlist-actions" class="ui-section-anchor" data-ui-block="primary-actions">
						<SectionBlock
							title="Actions"
							subtitle="Play or share this playlist."
							tone="secondary"
						>
							<div class="ui-action-row ui-action-row--progressive">
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
						</SectionBlock>
					</section>
				{/if}

				<section id="playlist-metadata" class="ui-section-anchor" data-ui-block="context-metadata">
					<SectionBlock title="Metadata" subtitle="Creation and update dates.">
						<DataGrid>
							{#if playlist.created}
								<div class="ui-data-point">
									<p class="ui-data-point__label">Created</p>
									<p class="ui-data-point__value">{new Date(playlist.created).toLocaleDateString()}</p>
								</div>
							{/if}
							{#if playlist.lastUpdated}
								<div class="ui-data-point">
									<p class="ui-data-point__label">Last Updated</p>
									<p class="ui-data-point__value">
										{new Date(playlist.lastUpdated).toLocaleDateString()}
									</p>
								</div>
							{/if}
						</DataGrid>
					</SectionBlock>
				</section>

				{#if playlist.promotedArtists && playlist.promotedArtists.length > 0}
					<section id="playlist-artists" class="ui-section-anchor" data-ui-block="secondary-content">
						<SectionBlock
							title="Featured Artists"
							subtitle="Artists promoted in this playlist."
							tone="tertiary"
						>
							<div class="ui-list-surface ui-link-row-list">
								{#each playlist.promotedArtists as artist (artist.id)}
									<a
										href={`/artist/${artist.id}`}
										class="ui-link-row"
										data-sveltekit-preload-data
									>
										<div class="ui-link-row__media ui-link-row__media--circle">
											{#if artist.picture}
												<img
													src={losslessAPI.getArtistPictureUrl(artist.picture)}
													alt={artist.name}
												/>
											{:else}
												<span class="ui-list-row__media-fallback">
													{(artist.name?.slice(0, 1) ?? 'A').toUpperCase()}
												</span>
											{/if}
										</div>
										<div class="ui-link-row__body">
											<p class="ui-link-row__title">{artist.name}</p>
											<p class="ui-link-row__subtitle">{artist.type || 'Artist'}</p>
										</div>
									</a>
								{/each}
							</div>
						</SectionBlock>
					</section>
				{/if}
			</div>
		</div>
	</div>
{/if}
