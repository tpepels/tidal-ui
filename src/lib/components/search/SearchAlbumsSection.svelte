<script lang="ts">
	import { Download, LoaderCircle, RotateCcw, X } from 'lucide-svelte';
	import { losslessAPI } from '$lib/api';
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

<section id="search-section-albums" class="search-section search-section--albums" data-tone="album">
	<header class="search-section__header">
		<div class="search-section__title-group">
			<h2 class="search-section__title">Albums</h2>
			{#if isMusicBrainzLoading}
				<p class="search-section__status" aria-live="polite">
					<LoaderCircle size={13} class="animate-spin" />
					Matching MusicBrainz…
				</p>
			{/if}
		</div>
		<span class="search-section__count">{albums.length}</span>
	</header>
	<div class="search-list">
		{#each albums as album (album.id)}
			{@const albumDownloadState =
				albumDownloadStates[album.id] ?? createDefaultAlbumDownloadState(album.numberOfTracks ?? 0)}
			{@const canCancelAlbumDownload = isAlbumQueueDownloadCancellable(albumDownloadState)}
			{@const albumCoverSrc = getAlbumCoverSrc(album)}
			<div class="search-row search-row--album">
				<a
					href={`/album/${album.id}`}
					class="search-row__content search-row__content--link search-row__content--with-media"
					aria-label={`Open album ${album.title}`}
					data-sveltekit-preload-data
				>
					<div class="search-row__media" aria-hidden="true">
						{#if albumCoverSrc}
							<img src={albumCoverSrc} alt="" loading="lazy" />
						{:else}
							<span class="search-row__media-fallback">
								{(album.title?.slice(0, 1) ?? 'A').toUpperCase()}
							</span>
						{/if}
					</div>
					<div class="search-row__text">
						<p class="search-row__title search-row__title--with-indicator">
							<span class="search-row__title-text">{album.title}</span>
							{#if albumMusicBrainzReleaseMatches[album.id]}
								<span
									class="search-row__musicbrainz-indicator"
									aria-label="Matched with MusicBrainz release"
									title="Matched with MusicBrainz release"
								>
									<img src="/icons/musicbrainz-32.png" alt="" aria-hidden="true" />
								</span>
							{/if}
						</p>
						<p class="search-row__meta">
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
					class="search-row__action"
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
		{/each}
	</div>
</section>

<style>
	.search-section {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		min-width: 0;
	}

	.search-section--albums {
		order: 1;
	}

	.search-section__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.search-section__title-group {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.12rem;
	}

	.search-section__title {
		margin: 0;
		font-size: 1.06rem;
		line-height: 1.28;
		color: rgba(255, 235, 212, 0.96);
	}

	.search-section__count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.75rem;
		height: 1.4rem;
		padding: 0 0.4rem;
		border: 1px solid rgba(236, 187, 136, 0.52);
		border-radius: 999px;
		background: rgba(176, 122, 66, 0.18);
		font-size: 0.8rem;
		font-weight: 700;
		color: rgba(255, 235, 212, 0.96);
	}

	.search-section__status {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.03em;
		color: rgba(255, 213, 165, 0.86);
	}

	.search-list {
		display: flex;
		flex-direction: column;
		border: 1px solid rgba(236, 187, 136, 0.42);
		border-radius: var(--ui-radius-md, 12px);
		background: linear-gradient(
			180deg,
			rgba(176, 122, 66, 0.16) 0%,
			var(--ui-surface-raised, #121212) 100%
		);
		overflow: hidden;
	}

	.search-row {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.66rem 0.78rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.07);
		color: inherit;
		text-decoration: none;
	}

	.search-list > :last-child {
		border-bottom: 0;
	}

	.search-row:hover {
		background: rgba(176, 122, 66, 0.24);
	}

	.search-row__content {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.search-row__content--with-media {
		flex-direction: row;
		align-items: center;
		gap: 0.68rem;
	}

	.search-row__text {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.search-row__media {
		flex-shrink: 0;
		width: 2.8rem;
		height: 2.8rem;
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(236, 187, 136, 0.44);
		background: rgba(176, 122, 66, 0.15);
		overflow: hidden;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.search-row__media img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.search-row__media-fallback {
		font-size: 0.9rem;
		font-weight: 700;
		color: rgba(216, 216, 216, 0.84);
	}

	.search-row__content--link {
		color: inherit;
		text-decoration: none;
	}

	.search-row__title {
		margin: 0;
		font-size: 1rem;
		line-height: 1.3;
		font-weight: 650;
		color: rgba(243, 243, 243, 0.98);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.search-row__title--with-indicator {
		display: flex;
		align-items: center;
		gap: 0.34rem;
	}

	.search-row__title-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.search-row__musicbrainz-indicator {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1rem;
		height: 1rem;
		border-radius: 999px;
		border: 1px solid rgba(247, 165, 76, 0.62);
		background: rgba(247, 165, 76, 0.12);
	}

	.search-row__musicbrainz-indicator img {
		width: 0.72rem;
		height: 0.72rem;
		display: block;
	}

	.search-row__meta {
		margin: 0;
		font-size: 0.87rem;
		line-height: 1.34;
		color: rgba(196, 196, 196, 0.86);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.search-row__action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.05rem;
		height: 2.05rem;
		border-radius: 999px;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-0, #0d0d0d);
		color: rgba(235, 235, 235, 0.93);
		flex-shrink: 0;
	}

	.search-row__action:hover:not(:disabled) {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		background: var(--ui-surface-interactive, #171717);
	}

	.search-row__action:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
