<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { losslessAPI } from '$lib/api';
	import TrackList from '$lib/components/TrackList.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import type { Album, Track } from '$lib/types';
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
		X
	} from 'lucide-svelte';
	import {
		machineCurrentTrack,
		machineIsPlaying,
		machineIsLoading,
		machineQueue
	} from '$lib/stores/playerDerived';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { browseState } from '$lib/stores/browseState';
	import { artistCacheStore } from '$lib/stores/artistCache';

	import { downloadAlbum } from '$lib/downloads';

	let album = $state<Album | null>(null);
	let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isDownloadingAll = $state(false);
	let downloadedCount = $state(0);
	let activeRequestToken = 0;

	const isAlbumQueue = $derived(
		tracks.length > 0 &&
			$machineQueue.length === tracks.length &&
			$machineQueue.every((t, i) => t?.id === tracks[i]?.id)
	);
	const isAlbumPlaying = $derived(isAlbumQueue && ($machineIsPlaying || $machineIsLoading));
	let downloadError = $state<string | null>(null);
	const albumDownloadMode = $derived($downloadPreferencesStore.mode);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const downloadStoragePreference = $derived($downloadPreferencesStore.storage);
	type AlbumQueueStatus = 'idle' | 'submitting' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
	let queueStatus = $state<AlbumQueueStatus>('idle');
	let queueJobId = $state<string | null>(null);
	let queueCompletedTracks = $state(0);
	let queueTotalTracks = $state(0);
	let queuePollInterval: ReturnType<typeof setInterval> | null = null;
	let queuePollToken = 0;
	let trackedDownloadAlbumId = $state<number | null>(null);

	const hasActiveQueueDownload = $derived(
		queueStatus === 'submitting' || queueStatus === 'queued' || queueStatus === 'processing'
	);
	const isQueueDownloadCancellable = $derived(
		queueStatus === 'queued' || queueStatus === 'processing'
	);

	const albumId = $derived($page.params.id);

	$effect(() => {
		const parsedAlbumId = Number.parseInt(albumId ?? '', 10);
		if (!Number.isFinite(parsedAlbumId) || parsedAlbumId <= 0) {
			stopQueuePolling();
			album = null;
			tracks = [];
			error = 'Invalid album id';
			isLoading = false;
			return;
		}
		if (trackedDownloadAlbumId !== parsedAlbumId) {
			trackedDownloadAlbumId = parsedAlbumId;
			stopQueuePolling();
			queueStatus = 'idle';
			queueJobId = null;
			queueCompletedTracks = 0;
			queueTotalTracks = 0;
			isDownloadingAll = false;
			downloadedCount = 0;
			downloadError = null;
		}
		const requestToken = ++activeRequestToken;
		void loadAlbum(parsedAlbumId, requestToken);
	});

	onDestroy(() => {
		stopQueuePolling();
	});

	async function loadAlbum(id: number, requestToken: number) {
		try {
			isLoading = true;
			error = null;
			const { album: albumData, tracks: albumTracks } = await losslessAPI.getAlbum(id);
			if (requestToken !== activeRequestToken) {
				return;
			}
			album = albumData;
			tracks = albumTracks;

			// Update browse state to track what we're viewing
			// This does NOT affect playback - only UI display context
			browseState.setViewingAlbum(albumData);

			// Set breadcrumbs
			if (albumData.artist) {
				breadcrumbStore.setLabel(`/artist/${albumData.artist.id}`, albumData.artist.name);
			}
			breadcrumbStore.setCurrentLabel(albumData.title, `/album/${albumData.id}`);

			if (albumData.cover) {
				const artistId = albumData.artist?.id;
				if (typeof artistId === 'number' && Number.isFinite(artistId)) {
					artistCacheStore.upsertAlbumCover(artistId, albumData.id, albumData.cover);
				}
				artistCacheStore.upsertAlbumCoverGlobally(albumData.id, albumData.cover);
			}
		} catch (err) {
			if (requestToken === activeRequestToken) {
				error = err instanceof Error ? err.message : 'Failed to load album';
				console.error('Failed to load album:', err);
			}
		} finally {
			if (requestToken === activeRequestToken) {
				isLoading = false;
			}
		}
	}

	function handlePlayAll() {
		// Validate tracks array
		if (!Array.isArray(tracks) || tracks.length === 0) {
			console.warn('No tracks available to play');
			return;
		}

		try {
			playbackFacade.loadQueue(tracks, 0, { autoPlay: true });
		} catch (error) {
			console.error('Failed to play album:', error);
			// Could show error toast here
		}
	}

	function handleAlbumPlaybackToggle() {
		if (!Array.isArray(tracks) || tracks.length === 0) {
			console.warn('No tracks available to play');
			return;
		}

		if (isAlbumPlaying) {
			playbackFacade.pause();
			return;
		}

		if (isAlbumQueue) {
			const firstTrackId = tracks[0]?.id;
			if ($machineCurrentTrack?.id !== firstTrackId) {
				playbackFacade.loadQueue(tracks, 0, { autoPlay: true });
			} else {
				playbackFacade.play();
			}
			return;
		}

		handlePlayAll();
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
		const target = breadcrumbStore.goBack($page.url.pathname, '/');
		void goto(target);
	}

	function handleShufflePlay() {
		if (tracks.length === 0) return;
		const shuffled = shuffleTracks(tracks);
		playbackFacade.loadQueue(shuffled, 0, { autoPlay: true });
	}

	function stopQueuePolling(): void {
		queuePollToken += 1;
		if (queuePollInterval) {
			clearInterval(queuePollInterval);
			queuePollInterval = null;
		}
	}

	function resolveQueueProgress(total: number, completed: number): { total: number; completed: number } {
		const safeTotal = Number.isFinite(total) && total > 0 ? total : Math.max(0, tracks.length);
		const safeCompleted = Number.isFinite(completed) && completed > 0 ? completed : 0;
		if (safeTotal > 0) {
			return { total: safeTotal, completed: Math.min(safeTotal, safeCompleted) };
		}
		return { total: safeTotal, completed: safeCompleted };
	}

	async function pollQueueJob(jobId: string, pollToken: number): Promise<void> {
		if (!jobId || pollToken !== queuePollToken) {
			return;
		}
		try {
			const response = await fetch(`/api/download-queue/${jobId}`);
			if (!response.ok) {
				return;
			}
			const payload = (await response.json()) as {
				success?: boolean;
				job?: {
					status?: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
					trackCount?: number;
					completedTracks?: number;
					progress?: number;
					error?: string;
				};
			};
			if (!payload.success || !payload.job || pollToken !== queuePollToken) {
				return;
			}

			const total = Number(payload.job.trackCount);
			const completed = Number(payload.job.completedTracks);
			const fallbackCompleted = Number(payload.job.progress) * (queueTotalTracks || tracks.length || 0);
			const progress = resolveQueueProgress(total, Number.isFinite(completed) ? completed : fallbackCompleted);
			queueTotalTracks = progress.total;
			queueCompletedTracks = progress.completed;

			switch (payload.job.status) {
				case 'queued':
					queueStatus = 'queued';
					downloadError = null;
					break;
				case 'processing':
					queueStatus = 'processing';
					downloadError = null;
					break;
				case 'completed':
					queueStatus = 'completed';
					queueCompletedTracks = progress.total || progress.completed;
					downloadError = null;
					stopQueuePolling();
					break;
				case 'cancelled':
					queueStatus = 'cancelled';
					downloadError = null;
					stopQueuePolling();
					break;
				case 'failed':
					queueStatus = 'failed';
					downloadError = payload.job.error ?? 'Album download failed.';
					stopQueuePolling();
					break;
				default:
					break;
			}
		} catch {
			// Keep showing optimistic queue state until next poll succeeds.
		}
	}

	function startQueuePolling(jobId: string): void {
		stopQueuePolling();
		const token = queuePollToken;
		void pollQueueJob(jobId, token);
		queuePollInterval = setInterval(() => {
			void pollQueueJob(jobId, token);
		}, 1000);
	}

	async function cancelQueueDownload(): Promise<void> {
		if (!queueJobId) {
			return;
		}
		try {
			const response = await fetch(`/api/download-queue/${queueJobId}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ action: 'cancel' })
			});
			if (!response.ok) {
				const body = await response.text();
				throw new Error(body || 'Failed to cancel download');
			}
			queueStatus = 'cancelled';
			downloadError = null;
			stopQueuePolling();
		} catch (cancelError) {
			downloadError =
				cancelError instanceof Error && cancelError.message
					? cancelError.message
					: 'Unable to stop this download right now.';
		}
	}

	async function handleDownloadAll() {
		if (!album || tracks.length === 0) {
			return;
		}

		if (isQueueDownloadCancellable) {
			await cancelQueueDownload();
			return;
		}

		if (isDownloadingAll || hasActiveQueueDownload) {
			return;
		}

		queueStatus = 'submitting';
		queueJobId = null;
		queueCompletedTracks = 0;
		queueTotalTracks = 0;
		isDownloadingAll = true;
		downloadedCount = 0;
		downloadError = null;
		const quality = $downloadPreferencesStore.downloadQuality;
		const mode = albumDownloadMode;

		try {
			let failedCount = 0;
			const result = await downloadAlbum(
				album,
				quality,
				{
					onTotalResolved: (total) => {
						queueTotalTracks = total;
						downloadedCount = 0;
					},
					onTrackDownloaded: (completed) => {
						queueStatus = 'processing';
						downloadedCount = completed;
						queueCompletedTracks = completed;
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

			if (result.storage === 'server' && result.jobId) {
				queueStatus = 'queued';
				queueJobId = result.jobId;
				queueTotalTracks = result.totalTracks;
				queueCompletedTracks = 0;
				isDownloadingAll = false;
				startQueuePolling(result.jobId);
				return;
			}

			queueJobId = null;
			queueTotalTracks = result.totalTracks;
			queueCompletedTracks = result.completedTracks;

			if (failedCount > 0) {
				queueStatus = 'failed';
				downloadError = `Download completed. ${failedCount} track${failedCount > 1 ? 's' : ''} failed after 3 attempts.`;
			} else {
				queueStatus = 'completed';
			}
		} catch (err) {
			console.error('Failed to download album:', err);
			queueStatus = 'failed';
			downloadError =
				err instanceof Error && err.message
					? err.message
					: 'Failed to download one or more tracks.';
		} finally {
			if (!queueJobId) {
				isDownloadingAll = false;
			}
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
							onclick={handleAlbumPlaybackToggle}
							class="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-3 font-semibold transition-colors hover:bg-blue-700"
							aria-label={isAlbumPlaying ? 'Pause album' : 'Play album'}
						>
							{#if isAlbumPlaying}
								<Pause size={20} fill="currentColor" />
								Pause
							{:else}
								<Play size={20} fill="currentColor" />
								Play Album
							{/if}
						</button>
						<button
							onclick={handleShufflePlay}
							class="flex items-center gap-2 rounded-full border border-purple-400/50 px-6 py-3 text-sm font-semibold text-purple-200 transition-colors hover:border-purple-300 hover:text-purple-100"
						>
							<Shuffle size={18} />
							Shuffle Album
						</button>
						<button
							onclick={handleDownloadAll}
							class="flex items-center gap-2 rounded-full border border-blue-400/40 px-6 py-3 text-sm font-semibold text-blue-300 transition-colors hover:border-blue-400 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={queueStatus === 'submitting'}
							aria-label={isQueueDownloadCancellable ? 'Stop album download' : 'Download album'}
							aria-busy={hasActiveQueueDownload || isDownloadingAll}
						>
							{#if isQueueDownloadCancellable}
								<X size={18} />
								Stop Download
							{:else if queueStatus === 'submitting'}
								<LoaderCircle size={18} class="animate-spin" />
								Queueing…
							{:else if isDownloadingAll}
								<LoaderCircle size={18} class="animate-spin" />
								Downloading {downloadedCount}/{tracks.length}
							{:else}
								<Download size={18} />
								{queueStatus === 'failed'
									? 'Retry Download'
									: queueStatus === 'cancelled'
										? 'Resume Download'
										: queueStatus === 'completed'
											? 'Download Again'
											: 'Download Album'}
							{/if}
						</button>

						<ShareButton type="album" id={album.id} variant="secondary" />
					</div>
					{#if queueStatus === 'queued'}
						<p class="mt-2 text-sm text-blue-300">
							Queued on server. Open Download Manager for live progress.
						</p>
					{:else if queueStatus === 'processing'}
						<p class="mt-2 text-sm text-blue-300">
							Downloading on server
							{#if queueTotalTracks > 0}
								({queueCompletedTracks}/{queueTotalTracks} tracks)
							{/if}
							…
						</p>
					{:else if queueStatus === 'completed'}
						<p class="mt-2 text-sm text-emerald-300">Album download completed.</p>
					{:else if queueStatus === 'cancelled'}
						<p class="mt-2 text-sm text-amber-300">Album download stopped.</p>
					{/if}
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
