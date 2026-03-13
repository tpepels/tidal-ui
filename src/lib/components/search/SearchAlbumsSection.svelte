<script lang="ts">
	import { Download, LoaderCircle, RotateCcw, X } from 'lucide-svelte';
	import { losslessAPI } from '$lib/api';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import WindowedList from '$lib/components/ui/WindowedList.svelte';
	import {
		createDefaultAlbumDownloadState,
		isAlbumQueueDownloadCancellable,
		type AlbumDownloadState
	} from '$lib/features/search/albumQueueController';
	import type { Album } from '$lib/types';

	interface Props {
		albums: Album[];
		albumDownloadStates: Record<number, AlbumDownloadState>;
		albumMusicBrainzReleaseMatches: Record<number, string>;
		isMusicBrainzLoading: boolean;
		pendingMusicBrainzAlbumIds: Set<number>;
		downloadActionLabel: string;
		onDownloadClick: (album: Album, event: MouseEvent) => Promise<void> | void;
		onCancelQueueDownload: (albumId: number, event: MouseEvent) => Promise<void> | void;
	}

	let {
		albums,
		albumDownloadStates,
		albumMusicBrainzReleaseMatches,
		isMusicBrainzLoading,
		pendingMusicBrainzAlbumIds,
		downloadActionLabel,
		onDownloadClick,
		onCancelQueueDownload
	}: Props = $props();

	function displayTrackTotal(total?: number | null): number {
		if (!Number.isFinite(total)) return 0;
		return total && total > 0 ? total : (total ?? 0);
	}

	function getAlbumCoverSrc(album: Album): string | null {
		if (typeof album.cover !== 'string' || album.cover.trim().length === 0) {
			return null;
		}
		return losslessAPI.getCoverUrl(album.cover, '160');
	}

	function albumStatusText(state: AlbumDownloadState): string | null {
		if (state.status === 'queued') {
			return 'Queued';
		}
		if (state.downloading) {
			if (state.total > 0) {
				return `${state.completed}/${state.total}`;
			}
			return `${state.completed}`;
		}
		if (state.status === 'completed') {
			return 'Done';
		}
		if (state.status === 'cancelled') {
			return 'Stopped';
		}
		if (state.status === 'paused') {
			return 'Paused';
		}
		if (state.error) {
			return state.error;
		}
		return null;
	}

	function isMusicBrainzPendingForAlbum(albumId: number): boolean {
		return (
			isMusicBrainzLoading &&
			pendingMusicBrainzAlbumIds.has(albumId) &&
			!albumMusicBrainzReleaseMatches[albumId]
		);
	}
</script>

<SectionBlock
	id="search-section-albums"
	title="Albums"
	count={albums.length}
	status={isMusicBrainzLoading ? 'Matching MusicBrainz…' : null}
	className="ui-perf-block"
>
	<WindowedList
		items={albums}
		itemHeight={82}
		overscan={6}
		threshold={30}
		className="ui-list-surface"
	>
		{#snippet row(item)}
			{@const album = item as Album}
			{@const albumDownloadState =
				albumDownloadStates[album.id] ?? createDefaultAlbumDownloadState(album.numberOfTracks ?? 0)}
			{@const canCancelAlbumDownload = isAlbumQueueDownloadCancellable(albumDownloadState)}
			{@const albumCoverSrc = getAlbumCoverSrc(album)}
			<div class="ui-list-row ui-list-row--actionable ui-perf-row" data-window-item>
				<a
					href={`/album/${album.id}`}
					class="ui-list-row__main"
					aria-label={`Open album ${album.title}`}
					data-sveltekit-preload-data
				>
					<div class="ui-list-row__media" aria-hidden="true">
						{#if albumCoverSrc}
							<img src={albumCoverSrc} alt="" loading="lazy" decoding="async" />
						{:else}
							<span class="ui-list-row__media-fallback">
								{(album.title?.slice(0, 1) ?? 'A').toUpperCase()}
							</span>
						{/if}
					</div>
					<div class="ui-list-row__text">
						<p class="ui-list-row__title">
							<span class="ui-list-row__title-text">{album.title}</span>
							{#if albumMusicBrainzReleaseMatches[album.id]}
								<span
									class="ui-list-row__musicbrainz-indicator"
									aria-label="Matched with MusicBrainz release"
									title="Matched with MusicBrainz release"
								>
									<img src="/icons/musicbrainz-32.png" alt="" aria-hidden="true" />
								</span>
							{/if}
						</p>
						<p class="ui-list-row__meta ui-list-row__meta--wrap">
							{album.artist?.name ?? 'Unknown artist'}
							{#if album.releaseDate}
								• {album.releaseDate.split('-')[0]}
							{/if}
							• {displayTrackTotal(album.numberOfTracks)} track{displayTrackTotal(album.numberOfTracks) ===
							1
								? ''
								: 's'}
							{#if isMusicBrainzPendingForAlbum(album.id)}
								• Matching MusicBrainz…
							{/if}
							{#if albumStatusText(albumDownloadState)}
								• {albumStatusText(albumDownloadState)}
							{/if}
						</p>
					</div>
				</a>
				<button
					onclick={(event) =>
						canCancelAlbumDownload
							? onCancelQueueDownload(album.id, event)
							: onDownloadClick(album, event)}
					type="button"
					class="ui-list-row__action"
					disabled={albumDownloadState.status === 'submitting'}
					aria-label={
						canCancelAlbumDownload
							? `Stop download ${album.title}`
							: albumDownloadState.status === 'paused'
								? `Resume download ${album.title}`
								: `${downloadActionLabel} ${album.title}`
					}
					aria-busy={albumDownloadState.status === 'submitting' ||
						albumDownloadState.status === 'queued' ||
						albumDownloadState.downloading}
				>
					{#if canCancelAlbumDownload}
						<X size={16} />
					{:else if albumDownloadState.status === 'submitting' || albumDownloadState.downloading}
						<LoaderCircle size={16} class="animate-spin" />
					{:else if albumDownloadState.status === 'paused'}
						<RotateCcw size={16} />
					{:else}
						<Download size={16} />
					{/if}
				</button>
			</div>
		{/snippet}
	</WindowedList>
</SectionBlock>
