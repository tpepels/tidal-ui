<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { losslessAPI } from '$lib/api';
	import type { Track } from '$lib/types';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { createTrackDownloadUi } from '$lib/controllers/trackDownloadUi';
	import { browseState } from '$lib/stores/browseState';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { artistCacheStore } from '$lib/stores/artistCache';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import { LoaderCircle, Play, ArrowLeft, Disc, User, Clock, Download, X } from 'lucide-svelte';
	import { formatArtists } from '$lib/utils/formatters';

	let track = $state<Track | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let activeRequestToken = 0;

	const trackId = $derived($page.params.id);
	const downloadActionLabel = $derived(
		$downloadPreferencesStore.storage === 'server' ? 'Save to server' : 'Download'
	);
	const trackDownloadUi = createTrackDownloadUi<Track>({
		resolveSubtitle: (candidate) => candidate.album?.title ?? candidate.artist?.name,
		notificationMode: 'toast',
		skipFfmpegCountdown: true
	});
	const { downloadingIds, cancelledIds, handleCancelDownload, handleDownload } = trackDownloadUi;
	const isDownloading = $derived(track ? $downloadingIds.has(track.id) : false);
	const isCancelled = $derived(track ? $cancelledIds.has(track.id) : false);

	$effect(() => {
		const parsedTrackId = Number.parseInt(trackId ?? '', 10);
		if (!Number.isFinite(parsedTrackId) || parsedTrackId <= 0) {
			track = null;
			error = 'Invalid track id';
			isLoading = false;
			return;
		}
		const requestToken = ++activeRequestToken;
		void loadTrack(parsedTrackId, requestToken);
	});

	async function loadTrack(id: number, requestToken: number) {
		try {
			isLoading = true;
			error = null;
			const data = await losslessAPI.getTrack(id);
			if (requestToken !== activeRequestToken) {
				return;
			}
			track = data.track;

			if (data.track.album?.artist) {
				breadcrumbStore.setLabel(
					`/artist/${data.track.album.artist.id}`,
					data.track.album.artist.name
				);
			}
			if (data.track.album?.id) {
				breadcrumbStore.setLabel(`/album/${data.track.album.id}`, data.track.album.title);
			}
			breadcrumbStore.setCurrentLabel(data.track.title, `/track/${data.track.id}`);

			if (data.track.album?.cover) {
				const albumArtistId = data.track.album.artist?.id;
				if (typeof albumArtistId === 'number' && Number.isFinite(albumArtistId)) {
					artistCacheStore.upsertAlbumCover(albumArtistId, data.track.album.id, data.track.album.cover);
				}
				artistCacheStore.upsertAlbumCoverGlobally(data.track.album.id, data.track.album.cover);
			}

			// Update browse state to track what we're viewing
			// This does NOT affect playback - only UI display context
			if (track) {
				browseState.setViewingTrack(track);
			}
		} catch (err) {
			if (requestToken === activeRequestToken) {
				error = err instanceof Error ? err.message : 'Failed to load track';
				console.error('Failed to load track:', err);
			}
		} finally {
			if (requestToken === activeRequestToken) {
				isLoading = false;
			}
		}
	}

	function formatDuration(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function handleBackNavigation() {
		const target = breadcrumbStore.goBack($page.url.pathname, '/');
		void goto(target);
	}
</script>

<svelte:head>
	<title>{track ? `${track.title} - ${formatArtists(track.artists)}` : 'Track'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-24">
		<LoaderCircle class="h-16 w-16 animate-spin text-blue-500" />
	</div>
{:else if error}
	<div class="mx-auto max-w-2xl py-12">
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-400">Error Loading Track</h2>
			<p class="text-red-300">{error}</p>
			<a
				href="/"
				class="mt-4 inline-flex rounded-lg bg-red-600 px-4 py-2 transition-colors hover:bg-red-700"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if track}
	<div class="mx-auto max-w-4xl space-y-8 py-8">
		<!-- Back Button -->
		<button
			onclick={handleBackNavigation}
			class="flex items-center gap-2 text-gray-400 transition-colors hover:text-white"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<div class="flex flex-col gap-8 md:flex-row">
			<!-- Album Art -->
			<div class="aspect-square w-full flex-shrink-0 overflow-hidden rounded-lg shadow-2xl md:w-96">
				{#if track.album.cover}
					<img
						src={losslessAPI.getCoverUrl(track.album.cover, '1280')}
						alt={track.album.title}
						class="h-full w-full object-cover"
					/>
				{:else}
					<div class="flex h-full w-full items-center justify-center bg-gray-800">
						<Disc size={64} class="text-gray-600" />
					</div>
				{/if}
			</div>

			<!-- Track Info -->
			<div class="flex flex-1 flex-col justify-end">
				<h1 class="mb-2 text-4xl font-bold md:text-5xl">{track.title}</h1>
				{#if track.version}
					<span class="mb-4 inline-block rounded bg-gray-800 px-2 py-1 text-sm text-gray-300">
						{track.version}
					</span>
				{/if}

				<div class="mb-6 space-y-2">
					<div class="flex items-center gap-2 text-xl text-gray-300">
						<User size={20} />
						<a href={`/artist/${track.artist.id}`} class="hover:text-blue-400 hover:underline">
							{formatArtists(track.artists)}
						</a>
					</div>
					<div class="flex items-center gap-2 text-lg text-gray-400">
						<Disc size={20} />
						<a href={`/album/${track.album.id}`} class="hover:text-blue-400 hover:underline">
							{track.album.title}
						</a>
					</div>
					<div class="flex items-center gap-2 text-gray-500">
						<Clock size={18} />
						<span>{formatDuration(track.duration)}</span>
					</div>
				</div>

				<div class="flex gap-4">
						<button
							onclick={() => {
								if (track) {
									playbackFacade.loadQueue([track], 0, { autoPlay: true });
								}
							}}
						class="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-3 font-semibold transition-colors hover:bg-blue-700"
					>
						<Play size={20} fill="currentColor" />
						Play
					</button>

					{#if isDownloading}
						<button
							onclick={(event) => handleCancelDownload(track!.id, event)}
							class="flex items-center gap-2 rounded-full bg-red-600 px-8 py-3 font-semibold transition-colors hover:bg-red-700"
						>
							<X size={20} />
							Cancel
						</button>
					{:else if isCancelled}
						<button
							disabled
							class="flex items-center gap-2 rounded-full bg-gray-600 px-8 py-3 font-semibold text-gray-300"
						>
							<X size={20} />
							Cancelled
						</button>
					{:else}
						<button
							onclick={(event) => handleDownload(track!, event)}
							class="flex items-center gap-2 rounded-full bg-gray-800 px-8 py-3 font-semibold transition-colors hover:bg-gray-700"
						>
							<Download size={20} />
							{downloadActionLabel}
						</button>
					{/if}

					<ShareButton type="track" id={track.id} variant="secondary" />
				</div>
			</div>
		</div>
	</div>
{/if}
