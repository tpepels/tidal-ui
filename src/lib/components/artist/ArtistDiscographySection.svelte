<script lang="ts">
	import { Download, LoaderCircle, RotateCcw, X } from 'lucide-svelte';
	import ActionPanel from '$lib/components/ui/ActionPanel.svelte';
	import EntityMediaCard from '$lib/components/ui/EntityMediaCard.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import {
		buildArtistAlbumCoverCandidates as buildAlbumCoverCandidates,
		serializeCoverCandidates
	} from '$lib/features/artist/artistCoverHydrationController';
	import type { DiscographyFilterState } from '$lib/features/artist/artistDiscographyModel';
	import {
		createDefaultArtistAlbumDownloadState as createDefaultAlbumDownloadState,
		isArtistAlbumQueueDownloadCancellable as isAlbumQueueDownloadCancellable,
		type ArtistAlbumDownloadState as AlbumDownloadState
	} from '$lib/features/artist/artistAlbumQueueController';
	import type { Album, ArtistDetails, AudioQuality } from '$lib/types';
	import type { DiscographyBestEditionRule, DiscographyGroup } from '$lib/utils/discography';
	import { getCoverCacheKey, getResolvedCoverUrl } from '$lib/utils/coverPipeline';

	interface Props {
		artistId: number;
		artistName: string;
		discography: Album[];
		visibleDiscography: Album[];
		discographyAlbums: DiscographyGroup[];
		discographyEps: DiscographyGroup[];
		discographySingles: DiscographyGroup[];
		discographyInfo: ArtistDetails['discographyInfo'] | null;
		downloadQuality: AudioQuality;
		bestEditionRule: DiscographyBestEditionRule;
		discographyFilterState: DiscographyFilterState;
		filtersHideAllDiscography: boolean;
		isDownloadingDiscography: boolean;
		discographyProgress: { completed: number; total: number };
		discographyError: string | null;
		discographyMissingCoverCount: number;
		albumCoverOverrides: Record<number, string>;
		albumCoverFailures: Record<number, boolean>;
		coverHydrationGeneration: number;
		albumDownloadStates: Record<number, AlbumDownloadState>;
		albumLibraryPresence: Record<number, { exists: boolean; matchedTracks: number }>;
		albumMusicBrainzReleaseMatches: Record<number, string>;
		isDiscographyMusicBrainzLoading: boolean;
		pendingDiscographyMusicBrainzAlbumIds: Set<number>;
		displayTrackTotal: (total?: number | null) => number;
		formatAlbumMeta: (album: Album) => string | null;
		formatQualityLabel: (quality: AudioQuality) => string;
		onDownloadDiscography: () => Promise<void> | void;
		onBestEditionRuleChange: (rule: DiscographyBestEditionRule) => void;
		onToggleDiscographyFilter: (
			key: 'album' | 'ep' | 'single' | 'live' | 'remaster' | 'explicit' | 'clean'
		) => void;
		onResetDiscographyFilters: () => void;
		onCancelAlbumQueueDownload: (albumId: number, event?: MouseEvent) => Promise<void> | void;
		onAlbumDownload: (album: Album, event?: MouseEvent) => Promise<void> | void;
		onAlbumCoverError: (event: Event) => void;
		onAlbumCoverLoad: (event: Event) => void;
	}

	let {
		artistId,
		artistName,
		discography,
		visibleDiscography,
		discographyAlbums,
		discographyEps,
		discographySingles,
		discographyInfo,
		downloadQuality,
		bestEditionRule,
		discographyFilterState,
		filtersHideAllDiscography,
		isDownloadingDiscography,
		discographyProgress,
		discographyError,
		discographyMissingCoverCount,
		albumCoverOverrides,
		albumCoverFailures,
		coverHydrationGeneration,
		albumDownloadStates,
		albumLibraryPresence,
		albumMusicBrainzReleaseMatches,
		isDiscographyMusicBrainzLoading,
		pendingDiscographyMusicBrainzAlbumIds,
		displayTrackTotal,
		formatAlbumMeta,
		formatQualityLabel,
		onDownloadDiscography,
		onBestEditionRuleChange,
		onToggleDiscographyFilter,
		onResetDiscographyFilters,
		onCancelAlbumQueueDownload,
		onAlbumDownload,
		onAlbumCoverError,
		onAlbumCoverLoad
	}: Props = $props();
</script>

<section class="artist-discography-primary" data-ui-block="main-content">
	<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
		<div>
			<h2 class="text-2xl font-semibold text-white">Discography</h2>
			<p class="text-sm text-gray-400">Albums, EPs, and more from {artistName}.</p>
		</div>
		<div class="ui-action-row ui-action-row--progressive">
			<button
				onclick={onDownloadDiscography}
				type="button"
				class="ui-action-button ui-action-button--primary"
				disabled={isDownloadingDiscography || discography.length === 0}
				aria-live="polite"
			>
				{#if isDownloadingDiscography}
					<LoaderCircle size={16} class="animate-spin" />
					<span class="whitespace-nowrap">
						Downloading
						{#if discographyProgress.total > 0}
							{discographyProgress.completed}/{displayTrackTotal(discographyProgress.total)}
						{:else}
							{discographyProgress.completed}
						{/if}
						tracks
					</span>
				{:else}
					<Download size={16} />
					<span class="whitespace-nowrap">Download Discography</span>
				{/if}
			</button>
		</div>
	</div>
	<ActionPanel
		className="mt-4"
		intent="Discography Selection"
		summary="Refine which releases are shown and which edition is preferred."
		intentful={true}
		panelRole="discography-selection"
	>
		<div class="ui-action-row ui-action-row--progressive md:justify-between">
			<label class="flex items-center gap-2 text-xs text-gray-400">
				<span>Best edition</span>
				<select
					value={bestEditionRule}
					class="ui-select"
					aria-label="Best edition rule"
					onchange={(event) => {
						const target = event.currentTarget as HTMLSelectElement | null;
						if (!target) return;
						onBestEditionRuleChange(target.value as DiscographyBestEditionRule);
					}}
				>
					<option value="balanced">Balanced</option>
					<option value="quality_first">Quality first</option>
					<option value="completeness_first">Most complete</option>
					<option value="original_release">Original release</option>
				</select>
			</label>
		</div>
		<div class="ui-action-row ui-action-row--progressive">
			{#each [
				{ key: 'album', label: 'Albums' },
				{ key: 'ep', label: 'EPs' },
				{ key: 'single', label: 'Singles' }
			] as release (release.key)}
				<button
					type="button"
					onclick={() => onToggleDiscographyFilter(release.key as 'album' | 'ep' | 'single')}
					class="ui-filter-chip"
					class:is-active={discographyFilterState[release.key as 'album' | 'ep' | 'single']}
				>
					{release.label}
				</button>
			{/each}
		</div>
		<div class="ui-action-row ui-action-row--progressive">
			{#each [
				{ key: 'live', label: 'Live' },
				{ key: 'remaster', label: 'Remaster/Deluxe' },
				{ key: 'explicit', label: 'Explicit' },
				{ key: 'clean', label: 'Non-explicit' }
			] as filter (filter.key)}
				<button
					type="button"
					onclick={() =>
						onToggleDiscographyFilter(
							filter.key as 'live' | 'remaster' | 'explicit' | 'clean'
						)}
					class="ui-filter-chip ui-filter-chip--soft"
					class:is-active={discographyFilterState[
						filter.key as 'live' | 'remaster' | 'explicit' | 'clean'
					]}
				>
					{filter.label}
				</button>
			{/each}
		</div>
		<p class="ui-action-status">
			Content filters use release metadata. “Non-explicit” is what some catalogs label as “clean”.
		</p>
	</ActionPanel>
	{#if discographyInfo?.mayBeIncomplete}
		<StateBlock
			kind="empty"
			title="Discography may be incomplete"
			message={discographyInfo.reason
				? `${discographyInfo.reason}.`
				: 'The upstream source can return partial release lists for some artists.'}
			embedded={true}
		/>
	{/if}
	{#if discographyError}
		<p class="mt-2 ui-action-status" data-tone="error" role="alert">{discographyError}</p>
	{/if}
	{#if visibleDiscography.length > 0}
		<div class="mt-6 space-y-8">
			{#if discographyMissingCoverCount > 0}
				<p class="text-xs text-gray-500">
					Resolving cover art for {discographyMissingCoverCount} release{discographyMissingCoverCount ===
					1
						? ''
						: 's'} in the background.
				</p>
			{/if}
			{#each [
				{ id: 'album', title: 'Albums', entries: discographyAlbums },
				{ id: 'ep', title: 'EPs', entries: discographyEps },
				{ id: 'single', title: 'Singles', entries: discographySingles }
			] as section (section.id)}
				{#if section.entries.length > 0}
					<SectionBlock
						title={section.title}
						subtitle={`Showing ${formatQualityLabel(downloadQuality)} variants`}
						count={section.entries.length}
						className="artist-discography-group"
					>
						<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
							{#each section.entries as entry (`${entry.key}:${downloadQuality}`)}
								{@const album = entry.representative}
								{@const hasOfficialTidalSource = album.discographySource === 'official_tidal'}
								{@const coverOverride = albumCoverOverrides[album.id]}
								{@const coverImageCandidates = buildAlbumCoverCandidates(
									album,
									entry.versions,
									hasOfficialTidalSource,
									coverOverride
								)}
								{@const coverCacheKey = getCoverCacheKey({
									coverId: coverOverride || album.cover,
									size: '640',
									proxy: hasOfficialTidalSource,
									overrideKey: `artist:${artistId}:album:${album.id}`
								})}
								{@const resolvedCoverUrl = getResolvedCoverUrl(coverCacheKey)}
								{@const coverImageUrl = resolvedCoverUrl ?? coverImageCandidates[0] ?? ''}
								{@const albumDownloadState =
									albumDownloadStates[album.id] ??
									createDefaultAlbumDownloadState(album.numberOfTracks ?? 0)}
								{@const canCancelAlbumDownload = isAlbumQueueDownloadCancellable(
									albumDownloadState
								)}
								{@const albumInLibrary = albumLibraryPresence[album.id]?.exists === true}
								<EntityMediaCard
									type="album"
									href={`/album/${album.id}`}
									title={album.title}
									subtitle={formatAlbumMeta(album)}
									class="group"
								>
									{#snippet action()}
										<button
											onclick={(event) =>
												canCancelAlbumDownload
													? onCancelAlbumQueueDownload(album.id, event)
													: onAlbumDownload(album, event)}
											type="button"
											class="absolute top-3 right-3 z-40 flex items-center justify-center rounded-full border border-white/15 bg-black/80 p-2 text-gray-200 transition-[background-color,border-color,color,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:-translate-y-px hover:border-white/35 hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
											disabled={isDownloadingDiscography || albumDownloadState.status === 'submitting'}
											aria-label={
												canCancelAlbumDownload
													? `Stop download ${album.title}`
													: albumDownloadState.status === 'paused'
														? `Resume download ${album.title}`
														: `Download ${album.title}`
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
									{/snippet}
									{#snippet artwork()}
										{#if coverImageCandidates.length > 0 && !albumCoverFailures[album.id]}
											<img
												src={coverImageUrl}
												data-album-id={album.id}
												data-cover-use-proxy={hasOfficialTidalSource ? '1' : '0'}
												data-cover-candidates={serializeCoverCandidates(coverImageCandidates)}
												data-cover-index="0"
												data-cover-generation={coverHydrationGeneration}
												data-cover-recovery-tried="0"
												data-cover-cache-key={coverCacheKey}
												onerror={onAlbumCoverError}
												onload={onAlbumCoverLoad}
												alt={album.title}
												class="h-full w-full object-cover"
												loading="lazy"
												decoding="async"
											/>
										{:else}
											<div class="flex h-full w-full items-center justify-center text-sm text-gray-500">
												No artwork
											</div>
										{/if}
										{#if albumMusicBrainzReleaseMatches[album.id]}
											<span
												class="discography-mb-badge"
												aria-label="Matched with MusicBrainz release"
												title="Matched with MusicBrainz release"
											>
												<img src="/icons/musicbrainz-32.png" alt="" aria-hidden="true" width="14" height="14" />
											</span>
										{:else if isDiscographyMusicBrainzLoading && pendingDiscographyMusicBrainzAlbumIds.has(album.id)}
											<span class="discography-mb-badge discography-mb-badge--searching" aria-label="Searching MusicBrainz…" title="Searching MusicBrainz…">
												<LoaderCircle size={12} class="animate-spin" />
											</span>
										{/if}
									{/snippet}
									{#snippet footer()}
										{#if albumDownloadState.status === 'queued'}
											<p class="album-card-status">Queued</p>
										{:else if albumDownloadState.downloading}
											<p class="album-card-status">
												Downloading {albumDownloadState.completed ?? 0}/{displayTrackTotal(
													albumDownloadState.total ?? album.numberOfTracks ?? 0
												)}
											</p>
										{:else if albumDownloadState.status === 'completed'}
											<p class="album-card-status">Downloaded</p>
										{:else if albumDownloadState.status === 'cancelled'}
											<p class="album-card-status">Stopped</p>
										{:else if albumDownloadState.status === 'paused'}
											<p class="album-card-status">Paused</p>
										{:else if albumDownloadState.error}
											<p class="album-card-status">Download error</p>
										{:else if albumInLibrary}
											<p class="album-card-status">In library</p>
										{/if}
									{/snippet}
								</EntityMediaCard>
							{/each}
						</div>
					</SectionBlock>
				{/if}
			{/each}
		</div>
	{:else if filtersHideAllDiscography}
		<div class="mt-6 space-y-3">
			<StateBlock
				kind="empty"
				title="Current filters hide all releases"
				message="Enable both explicit and non-explicit filters to include all editions."
			/>
			<div>
				<button
					type="button"
					onclick={onResetDiscographyFilters}
					class="ui-chip-button ui-chip-button--compact"
				>
					Reset discography filters
				</button>
			</div>
		</div>
	{:else}
		<div class="ui-surface-card mt-6 p-6 text-sm text-gray-400">
			<p>Discography information isn&apos;t available right now.</p>
		</div>
	{/if}
</section>

<style>
	.artist-discography-primary {
		border-top: 1px solid rgba(255, 255, 255, 0.18);
		padding-top: 0.9rem;
	}

	.discography-mb-badge {
		position: absolute;
		top: 6px;
		right: 6px;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.72);
		border: 1px solid rgba(255, 255, 255, 0.15);
		pointer-events: none;
	}

	.discography-mb-badge--searching {
		color: rgba(180, 180, 180, 0.85);
	}

	:global(.artist-discography-group .ui-media-card__primary-link) {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.58rem;
	}

	:global(.artist-discography-group .ui-media-card__artwork) {
		width: 100%;
	}

	:global(.artist-discography-group .ui-media-card__body) {
		padding-top: 0.08rem;
	}
</style>
