<script lang="ts">
	import type { Track } from '$lib/types';
	import { losslessAPI } from '$lib/api';
	import { onMount } from 'svelte';
	import { machineCurrentTrack, machineIsPaused, machineIsPlaying } from '$lib/stores/playerDerived';
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
		if ($machineCurrentTrack?.id === track.id && $machineIsPaused) {
			playbackFacade.play();
			return;
		}
		playbackFacade.loadQueue(displayedTracks, index, { autoPlay: true });
	}

	function handleAddToQueue(track: Track, event: MouseEvent) {
		event.stopPropagation();
		playbackFacade.enqueue(track);
	}

	function handlePlayNext(track: Track, event: MouseEvent) {
		event.stopPropagation();
		playbackFacade.enqueueNext(track);
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
		<div class="col-span-full py-12 text-center text-gray-500">
			<p>No tracks available</p>
		</div>
	{:else}
		{#each displayedTracks as track, index (track.id)}
			<div
				class="top-tracks-card group flex h-full flex-col gap-5 rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-[background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:-translate-y-px hover:border-white/25 hover:bg-white/[0.06] {activeMenuId === track.id ? 'relative z-20' : ''}"
			>
				<div class="flex items-start gap-4">
					<button
						type="button"
						onclick={(event) => {
							event.stopPropagation();
							handlePlayTrack(track, index);
						}}
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-gray-300 transition-[color,background-color,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:-translate-y-px hover:bg-white/12 hover:text-white"
						aria-label={isPlaying(track) ? 'Pause' : 'Play'}
					>
						{#if isPlaying(track)}
							<Pause size={18} class="text-white" />
						{:else if isCurrentTrack(track)}
							<Play size={18} class="text-white" />
						{:else}
							<span class="text-sm font-semibold text-gray-300">{index + 1}</span>
						{/if}
					</button>

					<button
						type="button"
						class="top-tracks-card__primary min-w-0 flex-1 text-left"
						onclick={() => handlePlayTrack(track, index)}
						aria-label={`Play ${track.title}`}
					>
						<div class="flex items-start gap-4">
							{#if track.album?.cover}
								<LazyImage
									src={losslessAPI.getCoverUrl(track.album.cover, '320')}
									alt={track.title}
									class="h-24 w-24 flex-shrink-0 rounded-lg border border-white/12 object-cover"
								/>
							{/if}

							<div class="min-w-0 flex-1">
								<h3
									class="text-lg font-semibold leading-tight break-words whitespace-normal sm:text-xl sm:truncate {isCurrentTrack(track)
										? 'text-white'
										: 'text-gray-100 group-hover:text-white'}"
								>
									{track.title}
									{#if track.explicit}
										<span class="ml-1 text-sm text-gray-500">[E]</span>
									{/if}
								</h3>
								{#if getDisplayTags(track.mediaMetadata?.tags).length > 0}
									<p class="mt-2 text-sm text-gray-500">
										{getDisplayTags(track.mediaMetadata?.tags).join(', ')}
									</p>
								{/if}
							</div>
						</div>
					</button>
				</div>

				<div class="space-y-1 text-base text-gray-400">
					<p class="truncate">
						<ArtistLinks artists={track.artists} />
					</p>
					{#if track.album}
						<p class="truncate text-sm text-gray-500">
							<AlbumLink album={track.album} />
						</p>
					{/if}
				</div>

				<div
					class="mt-auto flex flex-wrap items-center justify-between gap-3 text-sm text-gray-400"
				>
					<div class="flex items-center gap-2">
						<div class="relative">
							<button
								type="button"
								onclick={(event) => {
									event.stopPropagation();
									activeMenuId = activeMenuId === track.id ? null : track.id;
								}}
								class="rounded-full border border-transparent p-2 text-gray-400 transition-[color,background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:-translate-y-px hover:border-white/15 hover:bg-white/10 hover:text-white"
								title="Queue actions"
								aria-label={`Queue actions for ${track.title}`}
							>
								<MoreVertical size={18} />
							</button>
							{#if activeMenuId === track.id}
								<div
									class="track-menu-container absolute top-full right-0 z-10 mt-1 w-48 rounded-lg border border-white/15 bg-black/95 shadow-none"
								>
									<button
										type="button"
										onclick={(event) => {
											handlePlayNext(track, event);
											activeMenuId = null;
										}}
										class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
									>
										<ListVideo size={16} />
										Play Next
									</button>
									<button
										type="button"
										onclick={(event) => {
											handleAddToQueue(track, event);
											activeMenuId = null;
										}}
										class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
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
					<div class="flex items-center gap-1 text-sm text-gray-400">
						<Clock size={14} />
						<span>{losslessAPI.formatDuration(track.duration)}</span>
					</div>
				</div>
			</div>
		{/each}
	{/if}
</div>

<style>
	@media (prefers-reduced-motion: reduce) {
		.top-tracks-card,
		.top-tracks-card *,
		.track-menu-container {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
