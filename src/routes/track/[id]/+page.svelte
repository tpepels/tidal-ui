<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
	import type { Track } from '$lib/types';
	import { onMount } from 'svelte';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { browseState } from '$lib/stores/browseState';
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { buildTrackFilename } from '$lib/downloads';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import { LoaderCircle, Play, ArrowLeft, Disc, User, Clock, Download, X } from 'lucide-svelte';
	import { formatArtists } from '$lib/utils/formatters';

	let track = $state<Track | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isDownloading = $state(false);
	let downloadTaskId = $state<string | null>(null);
	let isCancelled = $state(false);

	const trackId = $derived($page.params.id);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const downloadCoverSeperatelyPreference = $derived($userPreferencesStore.downloadCoversSeperately);

	onMount(async () => {
		if (trackId) {
			await loadTrack(parseInt(trackId));
		}
	});

	async function loadTrack(id: number) {
		try {
			isLoading = true;
			error = null;
			const data = await losslessAPI.getTrack(id);
			track = data.track;

			// Set breadcrumbs
			if (data.track.album?.artist) {
				breadcrumbStore.setBreadcrumbs([
					{ label: data.track.album.artist.name, href: `/artist/${data.track.album.artist.id}` },
					{ label: data.track.album.title, href: `/album/${data.track.album.id}` },
					{ label: data.track.title, href: `/track/${data.track.id}` }
				]);
			} else if (data.track.album) {
				breadcrumbStore.setBreadcrumbs([
					{ label: data.track.album.title, href: `/album/${data.track.album.id}` },
					{ label: data.track.title, href: `/track/${data.track.id}` }
				]);
			} else {
				breadcrumbStore.setBreadcrumbs([
					{ label: data.track.title, href: `/track/${data.track.id}` }
				]);
			}

			// Update browse state to track what we're viewing
			// This does NOT affect playback - only UI display context
			if (track) {
				browseState.setViewingTrack(track);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load track';
			console.error('Failed to load track:', err);
		} finally {
			isLoading = false;
		}
	}

	function formatDuration(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function handleBackNavigation() {
		// Try to determine the most appropriate destination based on context

		// 1. If we came from an album page and this track belongs to an album, go back to album
		if (track?.album?.id && document.referrer?.includes(`/album/${track.album.id}`)) {
			goto(`/album/${track.album.id}`);
			return;
		}

		// 2. If we came from an artist page and this track has artists, go back to the first artist
		if (track?.artists?.length && document.referrer?.includes('/artist/')) {
			// Try to find the artist ID in the referrer
			const artistMatch = document.referrer.match(/\/artist\/(\d+)/);
			if (artistMatch) {
				goto(`/artist/${artistMatch[1]}`);
				return;
			}
		}

		// 3. If we came from a playlist page, try to go back there
		if (document.referrer?.includes('/playlist/')) {
			const playlistMatch = document.referrer.match(/\/playlist\/([^/?]+)/);
			if (playlistMatch) {
				goto(`/playlist/${playlistMatch[1]}`);
				return;
			}
		}

		// 4. If we came from search results, go back to search
		if (document.referrer?.includes('#') || $page.url.searchParams.has('q')) {
			goto('/');
			return;
		}

		// 5. Check browser history (current implementation as fallback)
		if (window.history.state && window.history.state.idx > 0) {
			window.history.back();
			return;
		}

		// 6. Default fallback to home
		goto('/');
	}

	function markCancelled() {
		isCancelled = true;
		setTimeout(() => {
			isCancelled = false;
		}, 1500);
	}

	function handleCancelDownload() {
		if (downloadTaskId) {
			downloadUiStore.cancelTrackDownload(downloadTaskId);
		}
		isDownloading = false;
		downloadTaskId = null;
		markCancelled();
	}

	async function handleDownload() {
		if (!track) return;
		
		isDownloading = true;
		const quality = $downloadPreferencesStore.downloadQuality;
		const filename = buildTrackFilename(
			track.album,
			track,
			quality,
			formatArtists(track.artists),
			convertAacToMp3Preference
		);

		const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename, {
			subtitle: track.album?.title ?? track.artist?.name
		});
		downloadTaskId = taskId;
		downloadUiStore.skipFfmpegCountdown();

		try {
			await losslessAPI.downloadTrack(track.id, quality, filename, {
				signal: controller.signal,
				onProgress: (progress: TrackDownloadProgress) => {
					if (progress.stage === 'downloading') {
						downloadUiStore.updateTrackProgress(
							taskId,
							progress.receivedBytes,
							progress.totalBytes
						);
					} else {
						downloadUiStore.updateTrackStage(taskId, progress.progress);
					}
				},
				onFfmpegCountdown: ({ totalBytes }) => {
					if (typeof totalBytes === 'number') {
						downloadUiStore.startFfmpegCountdown(totalBytes, { autoTriggered: false });
					} else {
						downloadUiStore.startFfmpegCountdown(0, { autoTriggered: false });
					}
				},
				onFfmpegStart: () => downloadUiStore.startFfmpegLoading(),
				onFfmpegProgress: (value) => downloadUiStore.updateFfmpegProgress(value),
				onFfmpegComplete: () => downloadUiStore.completeFfmpeg(),
				onFfmpegError: (error) => downloadUiStore.errorFfmpeg(error),
				ffmpegAutoTriggered: false,
				convertAacToMp3: convertAacToMp3Preference,
				downloadCoverSeperately: downloadCoverSeperatelyPreference
			});
			downloadUiStore.completeTrackDownload(taskId);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				downloadUiStore.completeTrackDownload(taskId);
				markCancelled();
			} else {
				console.error('Failed to download track:', error);
				downloadUiStore.cancelTrackDownload(taskId);
			}
		} finally {
			isDownloading = false;
			downloadTaskId = null;
		}
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
									playbackFacade.loadQueue([track], 0);
									playbackFacade.play();
								}
							}}
						class="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-3 font-semibold transition-colors hover:bg-blue-700"
					>
						<Play size={20} fill="currentColor" />
						Play
					</button>

					{#if isDownloading}
						<button
							onclick={handleCancelDownload}
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
							onclick={handleDownload}
							class="flex items-center gap-2 rounded-full bg-gray-800 px-8 py-3 font-semibold transition-colors hover:bg-gray-700"
						>
							<Download size={20} />
							Download
						</button>
					{/if}

					<ShareButton type="track" id={track.id} variant="secondary" />
				</div>
			</div>
		</div>
	</div>
{/if}
