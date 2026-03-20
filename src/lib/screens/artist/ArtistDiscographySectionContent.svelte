<script lang="ts">
	import { ChevronDown, Download, LoaderCircle, RotateCcw, SlidersHorizontal, X } from 'lucide-svelte';
	import MediaRow from '$lib/components/ui/MediaRow.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import StateNotice from '$lib/components/ui/StateNotice.svelte';
	import {
		buildArtistAlbumCoverCandidates as buildAlbumCoverCandidates,
		serializeCoverCandidates
	} from '$lib/presentation/artistCoverPresentation';
	import { describeDiscographyEntrySource } from '$lib/features/artist/artistDiscographyPresentation';
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

	const bestEditionLabels: Record<DiscographyBestEditionRule, string> = {
		balanced: 'Balanced',
		quality_first: 'Quality first',
		completeness_first: 'Most complete',
		original_release: 'Original release'
	};

	const releaseTypeFilters = [
		{ key: 'album' as const, label: 'Albums' },
		{ key: 'ep' as const, label: 'EPs' },
		{ key: 'single' as const, label: 'Singles' }
	];

	const variantFilters = [
		{ key: 'live' as const, label: 'Live' },
		{ key: 'remaster' as const, label: 'Remaster/Deluxe' },
		{ key: 'explicit' as const, label: 'Explicit' },
		{ key: 'clean' as const, label: 'Non-explicit' }
	];

	function hasDefaultDiscographyFilters(state: DiscographyFilterState): boolean {
		return (
			state.album &&
			state.ep &&
			state.single &&
			state.live &&
			state.remaster &&
			state.explicit &&
			state.clean
		);
	}

	const hasFilterOverrides = $derived.by(
		() => !hasDefaultDiscographyFilters(discographyFilterState)
	);

	const controlsSummary = $derived.by(() => {
		const parts = [
			`${bestEditionLabels[bestEditionRule] ?? 'Balanced'} edition`,
			`${formatQualityLabel(downloadQuality)} preferred`,
			`${visibleDiscography.length} of ${discography.length} shown`
		];
		if (hasFilterOverrides) {
			parts.push('filters applied');
		}
		return parts.join(' · ');
	});

	function getSectionSubtitle(sectionId: 'album' | 'ep' | 'single'): string {
		switch (sectionId) {
			case 'album':
				return 'Primary releases, newest first';
			case 'ep':
				return 'EPs and shorter releases, newest first';
			case 'single':
				return 'Singles and stand-alone tracks, newest first';
		}
	}
</script>

<section class="artist-discography-primary" data-ui-block="main-content">
	<div class="artist-discography-primary__header">
		<div class="artist-discography-primary__heading">
			<h2 class="artist-discography-primary__title">Discography</h2>
			<p class="artist-discography-primary__subtitle">
				Grouped by Albums, EPs, and Singles for {artistName}. Newest releases stay first within
				each section.
			</p>
		</div>
		<div class="ui-action-row ui-action-row--progressive" data-ui-block="primary-actions">
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
	<div class="artist-discography-toolbar">
		<div class="artist-discography-toolbar__summary">
			<span class="artist-discography-toolbar__pill">{bestEditionLabels[bestEditionRule]}</span>
			<span class="artist-discography-toolbar__pill">{formatQualityLabel(downloadQuality)} preferred</span>
			<span class="artist-discography-toolbar__summary-text">
				{visibleDiscography.length} of {discography.length} shown
			</span>
			{#if hasFilterOverrides}
				<span class="artist-discography-toolbar__summary-text">Filters applied</span>
			{/if}
		</div>
		<details class="artist-discography-controls">
			<summary class="artist-discography-controls__summary">
				<span class="artist-discography-controls__summary-label">
					<SlidersHorizontal size={14} />
					<span>Refine discography</span>
				</span>
				<span class="artist-discography-controls__summary-meta">{controlsSummary}</span>
				<span class="artist-discography-controls__summary-icon" aria-hidden="true">
					<ChevronDown size={16} />
				</span>
			</summary>
			<div class="artist-discography-controls__content">
				<div class="artist-discography-controls__grid">
					<label class="artist-discography-controls__field">
						<span class="artist-discography-controls__label">Preferred edition</span>
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
					<div class="artist-discography-controls__field">
						<span class="artist-discography-controls__label">Release types</span>
						<div class="ui-action-row ui-action-row--progressive">
							{#each releaseTypeFilters as release (release.key)}
								<button
									type="button"
									onclick={() => onToggleDiscographyFilter(release.key)}
									class="ui-filter-chip"
									class:is-active={discographyFilterState[release.key]}
								>
									{release.label}
								</button>
							{/each}
						</div>
					</div>
					<div class="artist-discography-controls__field">
						<span class="artist-discography-controls__label">Content filters</span>
						<div class="ui-action-row ui-action-row--progressive">
							{#each variantFilters as filter (filter.key)}
								<button
									type="button"
									onclick={() => onToggleDiscographyFilter(filter.key)}
									class="ui-filter-chip ui-filter-chip--soft"
									class:is-active={discographyFilterState[filter.key]}
								>
									{filter.label}
								</button>
							{/each}
						</div>
					</div>
				</div>
				<div class="artist-discography-controls__footer">
					<p class="ui-action-status">
						Each row opens the preferred catalog release when available. Artist page only
						entries stay labeled in the list.
					</p>
					{#if hasFilterOverrides}
						<button
							type="button"
							onclick={onResetDiscographyFilters}
							class="ui-chip-button ui-chip-button--compact"
						>
							Reset filters
						</button>
					{/if}
				</div>
			</div>
		</details>
	</div>
	{#if discographyInfo?.mayBeIncomplete}
		<StateNotice
			tone="warning"
			title="Discography may be incomplete"
			message={discographyInfo.reason
				? `${discographyInfo.reason}.`
				: 'The upstream source can return partial release lists for some artists.'}
			compact={true}
			liveRegion="off"
		/>
	{/if}
	{#if discographyError}
		<StateNotice tone="error" message={discographyError} compact={true} />
	{/if}
	{#if visibleDiscography.length > 0}
		<div class="mt-6 space-y-6">
			{#if discographyMissingCoverCount > 0}
				<StateNotice
					tone="neutral"
					message={`Resolving cover art for ${discographyMissingCoverCount} release${discographyMissingCoverCount === 1 ? '' : 's'} in the background.`}
					compact={true}
					liveRegion="off"
				/>
			{/if}
			{#each [
				{ id: 'album', title: 'Albums', entries: discographyAlbums },
				{ id: 'ep', title: 'EPs', entries: discographyEps },
				{ id: 'single', title: 'Singles', entries: discographySingles }
			] as section (section.id)}
				{#if section.entries.length > 0}
					<SectionBlock
						title={section.title}
						subtitle={getSectionSubtitle(section.id as 'album' | 'ep' | 'single')}
						count={section.entries.length}
						className="artist-discography-group"
					>
						<div class="ui-list-surface artist-discography-list">
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
								<MediaRow
									href={`/album/${album.id}`}
									title={album.title}
									subtitle={formatAlbumMeta(album)}
									meta={describeDiscographyEntrySource(entry)}
									coverCacheKey={coverCacheKey}
									coverCandidates={coverImageCandidates}
									imageAlt={album.title}
									tone={section.id === 'album' ? 'secondary' : 'tertiary'}
								>
									{#snippet action()}
								<button
											onclick={(event) =>
												canCancelAlbumDownload
													? onCancelAlbumQueueDownload(album.id, event)
													: onAlbumDownload(album, event)}
											type="button"
											class="ui-list-row__action ui-list-row__action--labeled"
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
												<span class="ui-list-row__action-label">Stop</span>
											{:else if albumDownloadState.status === 'submitting' || albumDownloadState.downloading}
												<LoaderCircle size={16} class="animate-spin" />
												<span class="ui-list-row__action-label">Working</span>
											{:else if albumDownloadState.status === 'paused'}
												<RotateCcw size={16} />
												<span class="ui-list-row__action-label">Resume</span>
											{:else}
												<Download size={16} />
												<span class="ui-list-row__action-label">Download</span>
											{/if}
										</button>
									{/snippet}
									{#snippet artwork()}
										{#if coverImageCandidates.length > 0 && !albumCoverFailures[album.id] && coverImageUrl}
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
									{/snippet}
									{#snippet badge()}
										{#if albumMusicBrainzReleaseMatches[album.id]}
											<span
												class="discography-mb-inline"
												aria-label="Matched with MusicBrainz release"
												title="Matched with MusicBrainz release"
											>
												<img src="/icons/musicbrainz-32.png" alt="" aria-hidden="true" width="12" height="12" />
												<span>MusicBrainz</span>
											</span>
										{:else if isDiscographyMusicBrainzLoading && pendingDiscographyMusicBrainzAlbumIds.has(album.id)}
											<span class="discography-mb-inline discography-mb-inline--searching" aria-label="Searching MusicBrainz…" title="Searching MusicBrainz…">
												<LoaderCircle size={12} class="animate-spin" />
												<span>Matching</span>
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
								</MediaRow>
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
		padding-top: 1rem;
	}

	.artist-discography-primary__header {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.artist-discography-primary__heading {
		display: flex;
		flex-direction: column;
		gap: 0.18rem;
	}

	.artist-discography-primary__title {
		margin: 0;
		font-size: clamp(1.45rem, 1.2rem + 0.8vw, 1.9rem);
		line-height: 1.15;
		font-weight: 700;
		color: rgba(248, 248, 248, 0.98);
	}

	.artist-discography-primary__subtitle {
		margin: 0;
		font-size: 0.98rem;
		line-height: 1.45;
		color: rgba(205, 205, 205, 0.82);
	}

	.artist-discography-toolbar {
		display: grid;
		gap: 0.85rem;
		margin-top: 1rem;
	}

	.artist-discography-toolbar__summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.55rem;
	}

	.artist-discography-toolbar__pill {
		display: inline-flex;
		align-items: center;
		padding: 0.24rem 0.58rem;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.06);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		color: rgba(238, 238, 238, 0.92);
	}

	.artist-discography-toolbar__summary-text {
		font-size: 0.82rem;
		color: rgba(200, 200, 200, 0.76);
	}

	.artist-discography-controls {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.04);
		overflow: hidden;
	}

	.artist-discography-controls__summary {
		list-style: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.9rem 1rem;
		cursor: pointer;
	}

	.artist-discography-controls__summary::-webkit-details-marker {
		display: none;
	}

	.artist-discography-controls__summary-label {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.9rem;
		font-weight: 700;
		color: rgba(244, 244, 244, 0.95);
	}

	.artist-discography-controls__summary-meta {
		flex: 1;
		min-width: 0;
		font-size: 0.78rem;
		color: rgba(198, 198, 198, 0.72);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.artist-discography-controls__summary-icon {
		color: rgba(218, 218, 218, 0.72);
		transition: transform 140ms ease;
	}

	.artist-discography-controls[open] .artist-discography-controls__summary-icon {
		transform: rotate(180deg);
	}

	.artist-discography-controls__content {
		display: grid;
		gap: 0.85rem;
		padding: 0 1rem 1rem;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	.artist-discography-controls__grid {
		display: grid;
		gap: 0.9rem;
		padding-top: 0.85rem;
	}

	.artist-discography-controls__field {
		display: grid;
		gap: 0.45rem;
	}

	.artist-discography-controls__label {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: rgba(194, 194, 194, 0.74);
	}

	.artist-discography-controls__footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.artist-discography-list {
		padding-inline: 0.1rem;
	}

	.discography-mb-inline {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
		padding: 0.14rem 0.42rem;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(255, 255, 255, 0.06);
		font-size: 0.72rem;
		font-weight: 700;
		line-height: 1;
		color: rgba(236, 236, 236, 0.9);
	}

	.discography-mb-inline--searching {
		color: rgba(210, 210, 210, 0.82);
	}

	@media (min-width: 768px) {
		.artist-discography-primary__header {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
		}

		.artist-discography-controls__grid {
			grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
		}

		.artist-discography-controls__field:last-child {
			grid-column: 1 / -1;
		}
	}
</style>
