<script lang="ts">
	import type { Track } from '$lib/types';
	import { losslessAPI } from '$lib/api';
	import { onMount } from 'svelte';
	import { machineCurrentTrack, machineIsPlaying } from '$lib/stores/playerDerived';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { createTrackDownloadUi } from '$lib/controllers/trackDownloadUi';
	import TrackDownloadButton from '$lib/components/TrackDownloadButton.svelte';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { Play, Pause, ListPlus, ListVideo, MoreVertical, Clock } from 'lucide-svelte';
	import ArtistLinks from '$lib/components/ArtistLinks.svelte';
	import AlbumLink from '$lib/components/AlbumLink.svelte';
	import LazyImage from '$lib/components/LazyImage.svelte';

	interface Props {
		tracks: Track[];
		maxTracks?: number;
		columns?: number;
	}

	function getColumnClass(columns: number): string {
		if (columns >= 3) {
			return 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3';
		}
		if (columns === 2) {
			return 'grid-cols-1 sm:grid-cols-2';
		}
		return 'grid-cols-1';
	}

	let { tracks, maxTracks = 6, columns = 3 }: Props = $props();

	const columnClass = $derived(getColumnClass(columns));
	const displayedTracks = $derived(maxTracks ? tracks.slice(0, maxTracks) : tracks);

	const trackDownloadUi = createTrackDownloadUi<Track>({
		resolveSubtitle: (track) => track.album?.title ?? track.artist?.name,
		notificationMode: 'alert',
		skipFfmpegCountdown: true
	});
	const { downloadingIds, cancelledIds, handleCancelDownload, handleDownload } = trackDownloadUi;
	const downloadActionLabel = $derived(
		$downloadPreferencesStore.storage === 'server' ? 'Save to server' : 'Download'
	);
	let activeMenuId = $state<number | null>(null);

	const IGNORED_TAGS = new Set(['HI_RES_LOSSLESS']);

	onMount(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				!target?.closest('.track-menu-container') &&
				!target?.closest('button[title="Queue actions"]')
			) {
				activeMenuId = null;
			}
		};

		document.addEventListener('click', handleClickOutside);

		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});

	function getDisplayTags(tags?: string[] | null): string[] {
		if (!tags) return [];
		return tags.filter((tag) => tag && !IGNORED_TAGS.has(tag));
	}

	function handlePlayTrack(track: Track, index: number) {
		console.info('[TopTracksGrid] handlePlayTrack', { trackId: track.id, index });
		playbackFacade.loadQueue(displayedTracks, index);
		playbackFacade.play();
	}

	function handleAddToQueue(track: Track, event: MouseEvent) {
		event.stopPropagation();
		playbackFacade.enqueue(track);
	}

	function handlePlayNext(track: Track, event: MouseEvent) {
		event.stopPropagation();
		playbackFacade.enqueueNext(track);
	}

	function handleCardKeydown(event: KeyboardEvent, track: Track, index: number) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handlePlayTrack(track, index);
		}
	}

	function isCurrentTrack(track: Track): boolean {
		return $machineCurrentTrack?.id === track.id;
	}

	function isPlaying(track: Track): boolean {
		return isCurrentTrack(track) && $machineIsPlaying;
	}

</script>

<div class={`grid gap-4 ${columnClass}`}>
	{#if displayedTracks.length === 0}
		<div class="col-span-full py-12 text-center text-gray-400">
			<p>No tracks available</p>
		</div>
	{:else}
		{#each displayedTracks as track, index (track.id)}
			<div
				role="button"
				tabindex="0"
				onclick={() => handlePlayTrack(track, index)}
				onkeydown={(event) => handleCardKeydown(event, track, index)}
				class="group flex h-full cursor-pointer flex-col gap-4 rounded-xl border border-gray-800 bg-gray-900/50 p-4 transition-colors hover:border-blue-700 hover:bg-gray-900/70 focus:ring-2 focus:ring-blue-500 focus:outline-none {activeMenuId === track.id ? 'relative z-20' : ''}"
			>
				<div class="flex items-start gap-4">
					<button
						onclick={(event) => {
							event.stopPropagation();
							handlePlayTrack(track, index);
						}}
						class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 transition-transform hover:scale-110"
						aria-label={isPlaying(track) ? 'Pause' : 'Play'}
					>
						{#if isPlaying(track)}
							<Pause size={18} class="text-blue-500" />
						{:else if isCurrentTrack(track)}
							<Play size={18} class="text-blue-500" />
						{:else}
							<span class="text-sm font-semibold text-gray-300">{index + 1}</span>
						{/if}
					</button>

					{#if track.album?.cover}
						<LazyImage
							src={losslessAPI.getCoverUrl(track.album.cover, '320')}
							alt={track.title}
							class="h-20 w-20 flex-shrink-0 rounded-lg object-cover shadow-lg"
						/>
					{/if}

					<div class="min-w-0 flex-1">
						<h3
							class="truncate text-lg font-semibold {isCurrentTrack(track)
								? 'text-blue-500'
								: 'text-white group-hover:text-blue-400'}"
						>
							{track.title}
							{#if track.explicit}
								<span class="ml-1 text-xs text-gray-500">[E]</span>
							{/if}
						</h3>
						<div class="mt-1 space-y-1 text-sm text-gray-400">
							<p class="truncate">
								<ArtistLinks artists={track.artists} />
							</p>
							{#if track.album}
								<p class="truncate text-xs text-gray-500">
									<AlbumLink album={track.album} />
								</p>
							{/if}
						</div>
						{#if getDisplayTags(track.mediaMetadata?.tags).length > 0}
							<p class="mt-2 text-xs text-gray-500">
								{getDisplayTags(track.mediaMetadata?.tags).join(', ')}
							</p>
						{/if}
					</div>
				</div>

				<div
					class="mt-auto flex flex-wrap items-center justify-between gap-3 text-sm text-gray-400"
				>
					<div class="flex items-center gap-2">
						<div class="relative">
							<button
								onclick={(event) => {
									event.stopPropagation();
									activeMenuId = activeMenuId === track.id ? null : track.id;
								}}
								class="rounded-full p-2 transition-colors hover:bg-gray-800 hover:text-white"
								title="Queue actions"
								aria-label={`Queue actions for ${track.title}`}
							>
								<MoreVertical size={18} />
							</button>
							{#if activeMenuId === track.id}
								<div
									class="track-menu-container absolute top-full right-0 z-10 mt-1 w-48 rounded-lg border border-gray-700 bg-gray-800 shadow-lg"
								>
									<button
										onclick={(event) => {
											handlePlayNext(track, event);
											activeMenuId = null;
										}}
										class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
									>
										<ListVideo size={16} />
										Play Next
									</button>
									<button
										onclick={(event) => {
											handleAddToQueue(track, event);
											activeMenuId = null;
										}}
										class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
									>
										<ListPlus size={16} />
										Add to Queue
									</button>
								</div>
							{/if}
						</div>
						<TrackDownloadButton
							isDownloading={$downloadingIds.has(track.id)}
							isCancelled={$cancelledIds.has(track.id)}
							onCancel={(event) => handleCancelDownload(track.id, event)}
							onDownload={(event) => handleDownload(track, event)}
							title={$downloadingIds.has(track.id) ? 'Cancel download' : `${downloadActionLabel} track`}
							ariaLabel={$downloadingIds.has(track.id)
								? `Cancel download for ${track.title}`
								: `${downloadActionLabel} ${track.title}`}
							class="rounded-full hover:bg-gray-800"
						/>
					</div>
					<div class="flex items-center gap-1 text-xs text-gray-400">
						<Clock size={14} />
						<span>{losslessAPI.formatDuration(track.duration)}</span>
					</div>
				</div>
			</div>
		{/each}
	{/if}
</div>
