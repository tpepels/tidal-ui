<script lang="ts">
	import type { Track } from '$lib/types';
	import { losslessAPI } from '$lib/api';
	import { onMount } from 'svelte';
	import { playerStore } from '$lib/stores/player';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { createTrackDownloadUi } from '$lib/controllers/trackDownloadUi';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import ArtistLinks from '$lib/components/ArtistLinks.svelte';
	import AlbumLink from '$lib/components/AlbumLink.svelte';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import TrackDownloadButton from '$lib/components/TrackDownloadButton.svelte';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { Play, Pause, Clock, ListPlus, ListVideo, MoreVertical } from 'lucide-svelte';

	interface Props {
		tracks: Track[];
		showAlbum?: boolean;
		showArtist?: boolean;
		showCover?: boolean;
	}

	let { tracks, showAlbum = true, showArtist = true, showCover = true }: Props = $props();
	let activeMenuId = $state<number | null>(null);
	const IGNORED_TAGS = new Set(['HI_RES_LOSSLESS']);
	const trackDownloadUi = createTrackDownloadUi<Track>({
		resolveSubtitle: (track) =>
			showAlbum ? (track.album?.title ?? track.artist?.name) : track.artist?.name,
		notificationMode: 'alert',
		skipFfmpegCountdown: true
	});
	const { downloadingIds, cancelledIds, handleCancelDownload, handleDownload } = trackDownloadUi;
	const downloadActionLabel = $derived(
		$downloadPreferencesStore.storage === 'server' ? 'Save to server' : 'Download'
	);

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

	function formatTrackNumber(track: Track): string {
		const volumeNumber = Number(track.volumeNumber);
		const trackNumber = Number(track.trackNumber);
		
		// Check if this is a multi-volume album by checking:
		// 1. numberOfVolumes > 1, or
		// 2. volumeNumber is set and finite (indicating multi-volume structure)
		const isMultiVolume = (track.album?.numberOfVolumes && track.album.numberOfVolumes > 1) || 
		                      Number.isFinite(volumeNumber);
		
		if (isMultiVolume) {
			const volumePadded = Number.isFinite(volumeNumber) && volumeNumber > 0 ? volumeNumber.toString() : '1';
			const trackPadded = Number.isFinite(trackNumber) && trackNumber > 0 ? trackNumber.toString() : '0';
			return `${volumePadded}-${trackPadded}`;
		} else {
			const trackPadded = Number.isFinite(trackNumber) && trackNumber > 0 ? trackNumber.toString() : '0';
			return trackPadded;
		}
	}

	function handlePlayTrack(track: Track, index: number) {
		console.info('[TrackList] handlePlayTrack', { trackId: track.id, index });
		playbackFacade.loadQueue(tracks, index);
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

	function isCurrentTrack(track: Track): boolean {
		return $playerStore.currentTrack?.id === track.id;
	}

	function isPlaying(track: Track): boolean {
		return isCurrentTrack(track) && $playerStore.isPlaying;
	}

	function handleRowActivation(event: Event, track: Track, index: number) {
		const target = event.target as Element | null;
		if (target?.closest('a') || target?.closest('button')) return;
		handlePlayTrack(track, index);
	}
</script>

<div class="w-full">
	{#if tracks.length === 0}
		<div class="py-12 text-center text-gray-400">
			<p>No tracks available</p>
		</div>
	{:else}
		<div class="space-y-1">
			{#each tracks as track, index (track.id)}
				<div
					role="button"
					tabindex="0"
					onclick={(event) => handleRowActivation(event, track, index)}
					onkeydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							handleRowActivation(event, track, index);
						}
					}}
					class="track-glass group flex w-full items-center gap-2 sm:gap-3 rounded-lg p-2 sm:p-3 text-left transition-colors overflow-hidden cursor-pointer focus:ring-2 focus:ring-blue-500 focus:outline-none {activeMenuId === track.id ? 'relative z-20' : ''} {isCurrentTrack(
						track
					)
						? 'bg-blue-900/20 border-blue-500/30'
						: 'hover:brightness-110'}"
				>
					<!-- Track Number / Play Button -->
					<button
						onclick={() => isPlaying(track) ? playbackFacade.pause() : handlePlayTrack(track, index)}
						class="group flex w-6 sm:w-8 flex-shrink-0 items-center justify-center transition-transform hover:scale-110"
						aria-label={isPlaying(track) ? 'Pause' : 'Play'}
					>
						{#if isPlaying(track)}
							<Pause size={14} class="sm:w-4 sm:h-4 text-blue-500" />
						{:else}
							<span class="text-xs sm:text-sm text-gray-400 group-hover:hidden">{formatTrackNumber(track)}</span>
							<Play size={14} class="sm:w-4 sm:h-4 hidden text-white group-hover:block" />
						{/if}
					</button>

					<!-- Cover -->
					{#if showCover && track.album.cover}
						<LazyImage
							src={losslessAPI.getCoverUrl(track.album.cover, '320')}
							alt={track.title}
							class="h-12 w-12 sm:h-16 sm:w-16 flex-shrink-0 rounded object-cover"
						/>
					{/if}

					<!-- Track Info -->
					<div class="min-w-0 flex-1">
						<button
							onclick={() => handlePlayTrack(track, index)}
							class="truncate font-medium text-left w-full text-sm sm:text-base {isCurrentTrack(track)
								? 'text-blue-500'
								: 'text-white hover:text-blue-400'}"
							title="Play track"
						>
							{track.title}
							{#if track.explicit}
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
						</button>
						<div class="flex flex-wrap items-center gap-1 sm:gap-2 text-xs sm:text-sm text-gray-400">
							{#if showArtist && track.artists?.length}
								<ArtistLinks artists={track.artists} />
							{/if}
							{#if showAlbum && showArtist && track.album?.title}
								<span>•</span>
							{/if}
							{#if showAlbum && track.album?.title}
								<AlbumLink album={track.album} />
							{/if}
						</div>
						<div class="mt-0.5 text-xs text-gray-500">
							{#if getDisplayTags(track.mediaMetadata?.tags).length > 0}
								• {getDisplayTags(track.mediaMetadata?.tags).join(', ')}
							{/if}
						</div>
					</div>

					<!-- Actions -->
					<div class="flex flex-shrink-0 items-center gap-1 sm:gap-2">
						<div class="relative">
							<button
								onclick={(event) => {
									event.stopPropagation();
									activeMenuId = activeMenuId === track.id ? null : track.id;
								}}
								class="p-2 text-gray-400 transition-colors hover:text-white"
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

						<div class="text-gray-400 hover:text-white">
							<ShareButton type="track" id={track.id} iconOnly size={18} title="Share track" />
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
						/>

						<!-- Duration -->
						<div class="flex w-16 items-center justify-end gap-1 text-sm text-gray-400">
							<Clock size={14} />
							{losslessAPI.formatDuration(track.duration)}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.track-glass {
		background: var(--surface-color, rgba(15, 23, 42, 0.55));
		border: 1px solid var(--surface-border, rgba(148, 163, 184, 0.12));
		backdrop-filter: blur(24px) saturate(150%);
		-webkit-backdrop-filter: blur(24px) saturate(150%);
		box-shadow: 
			0 4px 12px rgba(2, 6, 23, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.03);
		transition: 
			background 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease,
			filter 0.2s ease;
	}
</style>
