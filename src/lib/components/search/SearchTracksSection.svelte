<script lang="ts">
	import { losslessAPI } from '$lib/api';
	import TrackDownloadButton from '$lib/components/TrackDownloadButton.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import WindowedList from '$lib/components/ui/WindowedList.svelte';
	import type { PlayableTrack, Track } from '$lib/types';
	import { isSonglinkTrack } from '$lib/types';
	import { formatArtists } from '$lib/utils/formatters';

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

<SectionBlock
	id="search-section-tracks"
	title="Songs"
	count={tracks.length}
	tone="tertiary"
	className="ui-perf-block"
>
	<WindowedList
		items={tracks}
		itemHeight={110}
		overscan={6}
		threshold={30}
		className="ui-list-surface"
		dataTone="tertiary"
	>
		{#snippet row(item)}
			{@const track = item as PlayableTrack}
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
				class="ui-list-row ui-list-row--actionable ui-perf-row"
				data-tone="tertiary"
				data-window-item
			>
				<div class="ui-list-row__main">
					<div class="ui-list-row__media" aria-hidden="true">
						{#if trackCoverSrc}
							<img src={trackCoverSrc} alt="" loading="lazy" decoding="async" />
						{:else}
							<span class="ui-list-row__media-fallback">
								{(track.title?.slice(0, 1) ?? '♪').toUpperCase()}
							</span>
						{/if}
					</div>
					<div class="ui-list-row__text">
						<p class="ui-list-row__title">
							<span class="ui-list-row__title-text">{track.title}</span>
							{#if !isSonglinkTrack(track) && asTrack(track).version}
								<span class="ui-list-row__muted">({asTrack(track).version})</span>
							{/if}
						</p>
						<p class="ui-list-row__meta ui-list-row__meta--wrap">
							{#if isSonglinkTrack(track)}
								{track.artistName}
							{:else}
								{formatArtists(asTrack(track).artists)} • {asTrack(track).album.title}
							{/if}
							• {formatQualityLabel(track.audioQuality)}
							{#if !isSonglinkTrack(track)}
								• {losslessAPI.formatDuration(track.duration)}
							{/if}
						</p>
					</div>
				</div>
				<TrackDownloadButton
					isDownloading={downloadingIds.has(track.id)}
					isCancelled={cancelledIds.has(track.id)}
					onCancel={(event) => onCancel(track.id, event)}
					onDownload={(event) => onDownload(track, event)}
					title={downloadingIds.has(track.id) ? 'Cancel download' : `${downloadActionLabel} track`}
					ariaLabel={downloadingIds.has(track.id)
						? `Cancel download for ${track.title}`
						: `${downloadActionLabel} ${track.title}`}
					class="ui-list-row__action"
				/>
			</div>
		{/snippet}
	</WindowedList>
</SectionBlock>
