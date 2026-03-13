<script lang="ts">
	import { losslessAPI } from '$lib/api';
	import { formatArtists } from '$lib/utils/formatters';
	import TrackDownloadButton from '$lib/components/TrackDownloadButton.svelte';
	import type { PlayableTrack, Track } from '$lib/types';
	import { isSonglinkTrack } from '$lib/types';

	type TrackId = number | string;

	interface Props {
		tracks: PlayableTrack[];
		downloadingIds: Set<TrackId>;
		cancelledIds: Set<TrackId>;
		downloadActionLabel: string;
		onTrackSelect?: (track: PlayableTrack) => void;
		onDownload: (track: PlayableTrack, event?: MouseEvent) => Promise<void> | void;
		onCancel: (trackId: TrackId, event?: MouseEvent) => Promise<void> | void;
	}

	let {
		tracks,
		downloadingIds,
		cancelledIds,
		downloadActionLabel,
		onTrackSelect,
		onDownload,
		onCancel
	}: Props = $props();

	function asTrack(track: PlayableTrack): Track {
		return track as Track;
	}

	function getTrackCoverSrc(track: PlayableTrack): string | null {
		if (isSonglinkTrack(track)) {
			return track.thumbnailUrl?.trim() || null;
		}
		const cover = asTrack(track).album?.cover;
		if (typeof cover === 'string' && cover.trim().length > 0) {
			return losslessAPI.getCoverUrl(cover, '160');
		}
		return null;
	}

	function formatQualityLabel(quality?: string | null): string {
		if (!quality) return '—';
		const normalized = quality.toUpperCase();
		if (normalized === 'LOSSLESS') {
			return 'CD';
		}
		if (normalized === 'HI_RES_LOSSLESS') {
			return 'Hi-Res';
		}
		return quality;
	}

	function handleTrackActivation(track: PlayableTrack) {
		onTrackSelect?.(track);
	}

	function handleTrackKeydown(event: KeyboardEvent, track: PlayableTrack) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleTrackActivation(track);
		}
	}
</script>

<section id="search-section-tracks" class="search-section search-section--tracks" data-tone="tertiary">
	<header class="search-section__header">
		<h2 class="search-section__title">Songs</h2>
		<span class="search-section__count">{tracks.length}</span>
	</header>
	<div class="search-list">
		{#each tracks as track (track.id)}
			{@const trackCoverSrc = getTrackCoverSrc(track)}
			<div
				role="button"
				tabindex="0"
				onclick={(event) => {
					if (
						event.target instanceof Element &&
						(event.target.closest('a') || event.target.closest('button'))
					)
						return;
					handleTrackActivation(track);
				}}
				onkeydown={(event) => handleTrackKeydown(event, track)}
				class="search-row"
			>
				<div class="search-row__media" aria-hidden="true">
					{#if trackCoverSrc}
						<img src={trackCoverSrc} alt="" loading="lazy" />
					{:else}
						<span class="search-row__media-fallback">
							{(track.title?.slice(0, 1) ?? '♪').toUpperCase()}
						</span>
					{/if}
				</div>
				<div class="search-row__content">
					<p class="search-row__title">
						{track.title}
						{#if !isSonglinkTrack(track) && asTrack(track).version}
							<span class="search-row__muted">({asTrack(track).version})</span>
						{/if}
					</p>
					<p class="search-row__meta">
						{#if isSonglinkTrack(track)}
							{track.artistName}
						{:else}
							{formatArtists(asTrack(track).artists)} • {asTrack(track).album.title}
						{/if}
						• {formatQualityLabel(track.audioQuality)}
					</p>
				</div>
				{#if !isSonglinkTrack(track)}
					<span class="search-row__duration">{losslessAPI.formatDuration(track.duration)}</span>
				{/if}
				<TrackDownloadButton
					isDownloading={downloadingIds.has(track.id)}
					isCancelled={cancelledIds.has(track.id)}
					onCancel={(event) => onCancel(track.id, event)}
					onDownload={(event) => onDownload(track, event)}
					title={downloadingIds.has(track.id) ? 'Cancel download' : `${downloadActionLabel} track`}
					ariaLabel={downloadingIds.has(track.id)
						? `Cancel download for ${track.title}`
						: `${downloadActionLabel} ${track.title}`}
				/>
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

	.search-section--tracks {
		order: 3;
	}

	.search-section__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.search-section__title {
		margin: 0;
		font-size: 1.06rem;
		line-height: 1.28;
		color: var(--ui-tone-tertiary-text, rgba(220, 244, 233, 0.96));
	}

	.search-section__count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.75rem;
		height: 1.4rem;
		padding: 0 0.4rem;
		border: 1px solid var(--ui-tone-tertiary-border, rgba(159, 215, 190, 0.42));
		border-radius: 999px;
		background: var(--ui-tone-tertiary-surface, rgba(96, 156, 130, 0.16));
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--ui-tone-tertiary-text, rgba(220, 244, 233, 0.96));
	}

	.search-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--ui-tone-tertiary-border, rgba(159, 215, 190, 0.42));
		border-radius: var(--ui-radius-md, 12px);
		background: linear-gradient(
			180deg,
			var(--ui-tone-tertiary-surface, rgba(96, 156, 130, 0.16)) 0%,
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
		cursor: pointer;
	}

	.search-list > :last-child {
		border-bottom: 0;
	}

	.search-row:hover {
		background: var(--ui-tone-tertiary-surface-hover, rgba(96, 156, 130, 0.24));
	}

	.search-row__content {
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
		border: 1px solid var(--ui-tone-tertiary-border, rgba(159, 215, 190, 0.42));
		background: rgba(159, 215, 190, 0.12);
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

	.search-row__meta {
		margin: 0;
		font-size: 0.87rem;
		line-height: 1.34;
		color: rgba(196, 196, 196, 0.86);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.search-row__muted {
		font-weight: 500;
		color: rgba(188, 188, 188, 0.82);
	}

	.search-row__duration {
		flex-shrink: 0;
		font-size: 0.82rem;
		color: rgba(192, 192, 192, 0.84);
	}

	@media (max-width: 640px) {
		.search-row {
			flex-wrap: wrap;
		}

		.search-row__duration {
			order: 3;
		}
	}
</style>
