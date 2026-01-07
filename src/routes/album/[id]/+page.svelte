<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { losslessAPI } from '$lib/api';
	import TrackList from '$lib/components/TrackList.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import type { Album, Track } from '$lib/types';
	import { onMount } from 'svelte';
	import ArtistLinks from '$lib/components/ArtistLinks.svelte';
	import {
		ArrowLeft,
		Play,
		Pause,
		Calendar,
		Disc,
		Clock,
		Download,
		Shuffle,
		LoaderCircle,

	} from 'lucide-svelte';
	import { playerStore } from '$lib/stores/player';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';

	import { downloadAlbum } from '$lib/downloads';

	let album = $state<Album | null>(null);
	let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isDownloadingAll = $state(false);
	let downloadedCount = $state(0);

	let isPlayingThisAlbum = $derived($playerStore.queue.length === tracks.length && $playerStore.queue.every((t, i) => t?.id === tracks[i]?.id));
	let downloadError = $state<string | null>(null);
	const albumDownloadMode = $derived($downloadPreferencesStore.mode);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const downloadStoragePreference = $derived($downloadPreferencesStore.storage);

	const albumId = $derived($page.params.id);

	onMount(async () => {
		if (albumId) {
			await loadAlbum(parseInt(albumId));
		}
	});

	async function loadAlbum(id: number) {
		try {
			isLoading = true;
			error = null;
			const { album: albumData, tracks: albumTracks } = await losslessAPI.getAlbum(id);
			album = albumData;
			tracks = albumTracks;

			// Set breadcrumbs
			if (albumData.artist) {
				breadcrumbStore.setBreadcrumbs([
					{ label: albumData.artist.name, href: `/artist/${albumData.artist.id}` },
					{ label: albumData.title, href: `/album/${albumData.id}` }
				]);
			} else {
				breadcrumbStore.setBreadcrumbs([
					{ label: albumData.title, href: `/album/${albumData.id}` }
				]);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load album';
			console.error('Failed to load album:', err);
		} finally {
			isLoading = false;
		}
	}

	function handlePlayAll() {
		// Validate tracks array
		if (!Array.isArray(tracks) || tracks.length === 0) {
			console.warn('No tracks available to play');
			return;
		}

			try {
				playbackFacade.loadQueue(tracks, 0);
				playbackFacade.play();
			} catch (error) {
			console.error('Failed to play album:', error);
			// Could show error toast here
		}
	}

	function shuffleTracks(list: Track[]): Track[] {
		const items = list.slice();
		for (let i = items.length - 1; i > 0; i -= 1) {
			const j = Math.floor(Math.random() * (i + 1));
			[items[i], items[j]] = [items[j]!, items[i]!];
		}
		return items;
	}

	function handleBackNavigation() {
		// Try to determine the most appropriate destination based on context

		// 1. If we came from an artist page and this album belongs to that artist, go back to artist
		if (album?.artist?.id && document.referrer?.includes(`/artist/${album.artist.id}`)) {
			goto(`/artist/${album.artist.id}`);
			return;
		}

		// 2. If we came from search results, go back to search
		if (document.referrer?.includes('#') || $page.url.searchParams.has('q')) {
			goto('/');
			return;
		}

		// 3. Check browser history (current implementation as fallback)
		if (window.history.state && window.history.state.idx > 0) {
			window.history.back();
			return;
		}

		// 4. Default fallback to home
		goto('/');
	}

		function handleShufflePlay() {
			if (tracks.length === 0) return;
			const shuffled = shuffleTracks(tracks);
			playbackFacade.loadQueue(shuffled, 0);
			playbackFacade.play();
		}

	async function handleDownloadAll() {
		if (!album || tracks.length === 0 || isDownloadingAll) {
			return;
		}

		isDownloadingAll = true;
		downloadedCount = 0;
		downloadError = null;
		const quality = $downloadPreferencesStore.downloadQuality;
		const mode = albumDownloadMode;

		try {
			let failedCount = 0;
			await downloadAlbum(
				album,
				quality,
				{
					onTotalResolved: () => {
						downloadedCount = 0;
					},
					onTrackDownloaded: (completed) => {
						downloadedCount = completed;
					},
					onTrackFailed: (track, error, attempt) => {
						if (attempt >= 3) {
							failedCount++;
						}
					}
				},
				album.artist?.name,
				{ mode, convertAacToMp3: convertAacToMp3Preference, storage: downloadStoragePreference }
			);

			if (failedCount > 0) {
				downloadError = `Download completed. ${failedCount} track${failedCount > 1 ? 's' : ''} failed after 3 attempts.`;
			}
		} catch (err) {
			console.error('Failed to download album:', err);
			downloadError =
				err instanceof Error && err.message
					? err.message
					: 'Failed to download one or more tracks.';
		} finally {
			isDownloadingAll = false;
		}
	}

	const totalDuration = $derived(tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0));
</script>

<svelte:head>
	<title>{album?.title || 'Album'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-24">
		<LoaderCircle size={16} class="h-16 w-16 animate-spin text-blue-500" />
	</div>
{:else if error}
	<div class="mx-auto max-w-2xl py-12">
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-400">Error Loading Album</h2>
			<p class="text-red-300">{error}</p>
			<a
				href="/"
				class="mt-4 inline-flex rounded-lg bg-red-600 px-4 py-2 transition-colors hover:bg-red-700"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if album}
	<div class="space-y-6 pb-32 lg:pb-40">
		<!-- Back Button -->
		<button
			onclick={handleBackNavigation}
			class="flex items-center gap-2 text-gray-400 transition-colors hover:text-white"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<!-- Album Header -->
		<div class="flex flex-col gap-8 md:flex-row">
			<!-- Album Cover -->
			{#if album.videoCover || album.cover}
				<div
					class="aspect-square w-full flex-shrink-0 overflow-hidden rounded-lg shadow-2xl md:w-80"
				>
					{#if album.videoCover}
						<video
							src={losslessAPI.getVideoCoverUrl(album.videoCover, '640')}
							poster={album.cover ? losslessAPI.getCoverUrl(album.cover, '640') : undefined}
							aria-label={album.title}
							class="h-full w-full object-cover"
							autoplay
							loop
							muted
							playsinline
							preload="metadata"
						></video>
					{:else}
						<img
							src={losslessAPI.getCoverUrl(album.cover!, '640')}
							alt={album.title}
							class="h-full w-full object-cover"
						/>
					{/if}
				</div>
			{/if}

			<!-- Album Info -->
			<div class="flex flex-1 flex-col justify-end">
				<p class="mb-2 text-sm text-gray-400">ALBUM</p>
				<h1 class="mb-4 text-4xl font-bold md:text-6xl">{album.title}</h1>
				<div class="mb-4 flex items-center gap-1">
					{#if album.explicit}
						<svg
							class="inline h-4 w-4 flex-shrink-0 align-middle"
							xmlns="http://www.w3.org/2000/svg"
							fill="currentColor"
							height="24"
							viewBox="0 0 24 24"
							width="24"
							focusable="false"
							aria-hidden="true"
							><path
								d="M20 2H4a2 2 0 00-2 2v16a2 2 0 002 2h16a2 2 0 002-2V4a2 2 0 00-2-2ZM8 6h8a1 1 0 110 2H9v3h5a1 1 0 010 2H9v3h7a1 1 0 010 2H8a1 1 0 01-1-1V7a1 1 0 011-1Z"
							></path></svg
						>
					{/if}
					{#if album.artist}
						<div class="text-left text-xl text-gray-300">
							<ArtistLinks artists={[album.artist]} />
						</div>
					{/if}
				</div>

				<div class="mb-6 flex flex-wrap items-center gap-4 text-sm text-gray-400">
					{#if album.releaseDate}
						<div class="flex items-center gap-1">
							<Calendar size={16} />
							{new Date(album.releaseDate).getFullYear()}
						</div>
					{/if}
					{#if tracks.length > 0 || album.numberOfTracks}
						<div class="flex items-center gap-1">
							<Disc size={16} />
							{tracks.length || album.numberOfTracks} tracks
						</div>
					{/if}
					{#if totalDuration > 0}
						<div class="flex items-center gap-1">
							<Clock size={16} />
							{losslessAPI.formatDuration(totalDuration)} total
						</div>
					{/if}
					{#if album.mediaMetadata?.tags}
						{#each album.mediaMetadata.tags as tag (tag)}
							<div class="rounded bg-blue-900/30 px-2 py-1 text-xs font-semibold text-blue-400">
								{tag}
							</div>
						{/each}
					{/if}
				</div>

				{#if tracks.length > 0}
					<div class="flex flex-wrap items-center gap-3">
						<button
							onclick={isPlayingThisAlbum ? () => playbackFacade.pause() : handlePlayAll}
							class="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-3 font-semibold transition-colors hover:bg-blue-700"
						>
							{#if isPlayingThisAlbum}
								<Pause size={20} fill="currentColor" />
								Pause
							{:else}
								<Play size={20} fill="currentColor" />
								Play All
							{/if}
						</button>
						<button
							onclick={handleShufflePlay}
							class="flex items-center gap-2 rounded-full border border-purple-400/50 px-6 py-3 text-sm font-semibold text-purple-200 transition-colors hover:border-purple-300 hover:text-purple-100"
						>
							<Shuffle size={18} />
							Shuffle Play
						</button>
						<button
							onclick={handleDownloadAll}
							class="flex items-center gap-2 rounded-full border border-blue-400/40 px-6 py-3 text-sm font-semibold text-blue-300 transition-colors hover:border-blue-400 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={isDownloadingAll}
						>
							<Download size={18} />
							{isDownloadingAll
								? `Downloading ${downloadedCount}/${tracks.length}`
								: 'Download All'}
						</button>

						<ShareButton type="album" id={album.id} variant="secondary" />
					</div>
					{#if downloadError}
						<p class="mt-2 text-sm text-red-400">{downloadError}</p>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Tracks -->
		<div class="mt-8 space-y-4">
			<h2 class="text-2xl font-bold">Tracks</h2>
			<TrackList {tracks} showAlbum={false} />
			{#if tracks.length === 0}
				<div class="rounded-lg border border-yellow-900 bg-yellow-900/20 p-6 text-yellow-300">
					<p>
						We couldn't find tracks for this album. Try refreshing or searching for individual
						songs.
					</p>
				</div>
			{/if}
			{#if album.copyright}
				<p class="pt-2 text-xs text-gray-500">{album.copyright}</p>
			{/if}
		</div>
	</div>
{/if}
