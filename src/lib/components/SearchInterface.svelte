<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { hasRegionTargets } from '$lib/config';
	import { downloadAlbum } from '$lib/downloads';
	import { formatArtists } from '$lib/utils/formatters';
	import { createTrackDownloadUi } from '$lib/controllers/trackDownloadUi';
	import {
		createAlbumQueueController,
		createDefaultAlbumDownloadState,
		isAlbumQueueDownloadCancellable,
		type AlbumDownloadState
	} from '$lib/features/search/albumQueueController';
	import { createAlbumMusicBrainzMatchController } from '$lib/features/search/albumMusicBrainzMatchController';
	import {
		buildSearchOrchestratorOptions,
		resolveSearchExecutionScopes,
		resolveSearchUrlState,
		toggleSearchScope
	} from '$lib/features/search/searchQueryController';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import SearchAlbumsSection from '$lib/components/search/SearchAlbumsSection.svelte';
	import SearchArtistsSection from '$lib/components/search/SearchArtistsSection.svelte';
	import SearchPlaylistsSection from '$lib/components/search/SearchPlaylistsSection.svelte';
	import SearchTracksSection from '$lib/components/search/SearchTracksSection.svelte';
	import SearchToolbar from '$lib/components/search/SearchToolbar.svelte';
	import PageSectionNav, {
		type PageSectionNavItem
	} from '$lib/components/ui/PageSectionNav.svelte';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { regionStore, type RegionOption } from '$lib/stores/region';
	import { isTidalUrl } from '$lib/utils/urlParser';
	import { areTestHooksEnabled } from '$lib/utils/testHooks';
	import {
		isSupportedStreamingUrl,
		isSpotifyPlaylistUrl as isSpotifyPlaylistUrlUtil
	} from '$lib/utils/songlink';
	import { searchOrchestrator } from '$lib/orchestrators';
	import type { Album, AudioQuality, PlayableTrack } from '$lib/types';
	import { isSonglinkTrack } from '$lib/types';
	import { LoaderCircle } from 'lucide-svelte';
	import { searchStore, searchStoreActions, type SearchTab } from '$lib/stores/searchStoreAdapter';

	type UiTone = 'default' | 'secondary' | 'tertiary';

	const SEARCH_SCOPE_OPTIONS: Array<{ tab: SearchTab; label: string; tone: UiTone }> = [
		{ tab: 'albums', label: 'Albums', tone: 'default' },
		{ tab: 'artists', label: 'Artists', tone: 'secondary' },
		{ tab: 'tracks', label: 'Tracks', tone: 'tertiary' },
		{ tab: 'playlists', label: 'Playlists', tone: 'secondary' }
	];

	const trackDownloadUi = createTrackDownloadUi({
		resolveSubtitle: (track) =>
			isSonglinkTrack(track) ? track.artistName : track.album?.title ?? formatArtists(track.artists),
		notificationMode: 'toast',
		autoConvertSonglink: true,
		skipFfmpegCountdown: true
	});
	const { downloadingIds, cancelledIds, handleDownload, handleCancelDownload } = trackDownloadUi;

	const albumDownloadQuality = $derived($downloadPreferencesStore.downloadQuality as AudioQuality);
	const albumDownloadMode = $derived($downloadPreferencesStore.mode);
	const downloadActionLabel = $derived(
		$downloadPreferencesStore.storage === 'server' ? 'Save to server' : 'Download'
	);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const downloadCoverSeperatelyPreference = $derived(
		$userPreferencesStore.downloadCoversSeperately
	);
	const experimentalMusicBrainzTaggingPreference = $derived(
		$userPreferencesStore.experimentalMusicBrainzTagging
	);
	const strictMusicBrainzMatchingPreference = $derived(
		$userPreferencesStore.strictMusicBrainzMatching
	);

	let selectedRegion = $state<RegionOption>('us');
	let lastUrlSearchKey = $state('');
	let albumArtistFilter = $state('');
	let strictAlbumArtistMatch = $state(false);
	let selectedSearchScopes = $state<SearchTab[]>(['albums', 'artists']);

	const regionAvailability: Record<RegionOption, boolean> = {
		auto: hasRegionTargets('auto'),
		us: hasRegionTargets('us'),
		eu: hasRegionTargets('eu')
	};

	const ensureSupportedRegion = (value: RegionOption): RegionOption => {
		if (areTestHooksEnabled()) {
			return value;
		}
		if (value !== 'auto' && !regionAvailability[value]) {
			return 'auto';
		}
		return value;
	};

	const unsubscribeRegion = regionStore.subscribe((value) => {
		const nextRegion = ensureSupportedRegion(value);
		if (nextRegion !== value) {
			regionStore.setRegion(nextRegion);
		}
		selectedRegion = nextRegion;
	});

	const isQueryATidalUrl = $derived(
		$searchStore.query.trim().length > 0 && isTidalUrl($searchStore.query.trim())
	);
	const isQueryASpotifyPlaylist = $derived(
		$searchStore.query.trim().length > 0 && isSpotifyPlaylistUrlUtil($searchStore.query.trim())
	);
	const isQueryAStreamingUrl = $derived(
		$searchStore.query.trim().length > 0 && isSupportedStreamingUrl($searchStore.query.trim())
	);
	const isQueryAUrl = $derived(isQueryATidalUrl || isQueryAStreamingUrl || isQueryASpotifyPlaylist);

	function toggleScope(scope: SearchTab): void {
		selectedSearchScopes = toggleSearchScope(selectedSearchScopes, scope);
	}

	$effect(() => {
		const { queryParam, resolvedTab, artistParam, strictAlbumArtistMatch: strictFromUrl, lookupKey } =
			resolveSearchUrlState($page.url);
		if (lookupKey === lastUrlSearchKey) {
			return;
		}
		lastUrlSearchKey = lookupKey;
		if (!queryParam) {
			return;
		}

		if (resolvedTab && $searchStore.activeTab !== resolvedTab) {
			searchStoreActions.commit({ activeTab: resolvedTab });
		}
		if (resolvedTab) {
			selectedSearchScopes = [resolvedTab];
		}
		if ($searchStore.query !== queryParam) {
			searchStoreActions.setQuery(queryParam);
		}

		const scopeSettings = resolvedTab
			? { primaryTab: resolvedTab, aggregateTabs: [resolvedTab] as SearchTab[] }
			: resolveSearchExecutionScopes(selectedSearchScopes);
		const targetTab = scopeSettings.primaryTab;
		if (targetTab === 'albums' && artistParam.length > 0 && artistParam !== albumArtistFilter) {
			albumArtistFilter = artistParam;
		}
		if (targetTab === 'albums') {
			strictAlbumArtistMatch = strictFromUrl;
		}
		const isUrlQuery =
			isTidalUrl(queryParam) ||
			isSupportedStreamingUrl(queryParam) ||
			isSpotifyPlaylistUrlUtil(queryParam);
		void searchOrchestrator.search(
			queryParam,
			targetTab,
			buildSearchOrchestratorOptions({
				region: selectedRegion,
				showErrorToasts: false,
				targetTab,
				artistFilter: albumArtistFilter,
				strictAlbumArtistMatch,
				aggregateTabs: scopeSettings.aggregateTabs,
				isUrlQuery
			})
		);
	});

	const ALBUM_QUEUE_POLL_INTERVAL_MS = 1000;
	const ALBUM_MUSICBRAINZ_LOOKUP_CONCURRENCY = 5;
	const ALBUM_MUSICBRAINZ_LOOKUP_LIMIT = 24;
	const MUSICBRAINZ_PENDING_DOWNLOAD_CONFIRMATION =
		'MusicBrainz matching is still running for this album. Waiting a few seconds can improve metadata. Continue download now?';
	let albumDownloadStates = $state<Record<number, AlbumDownloadState>>({});
	let albumMusicBrainzReleaseMatches = $state<Record<number, string>>({});
	let isAlbumMusicBrainzLookupLoading = $state(false);
	let pendingAlbumMusicBrainzAlbumIds = $state<Set<number>>(new Set());
	let albumMusicBrainzLookupToken = 0;

	const trackResults = $derived($searchStore.results?.tracks ?? []);
	const albumResults = $derived($searchStore.results?.albums ?? []);
	const artistResults = $derived($searchStore.results?.artists ?? []);
	const playlistResults = $derived($searchStore.results?.playlists ?? []);
	const visibleResultSectionCount = $derived(
		(trackResults.length > 0 ? 1 : 0) +
			(albumResults.length > 0 ? 1 : 0) +
			(artistResults.length > 0 ? 1 : 0) +
			(playlistResults.length > 0 ? 1 : 0)
	);
	const shouldUseSingleColumnResults = $derived(
		selectedSearchScopes.length <= 1 || visibleResultSectionCount <= 1
	);
	const hasAnySearchResults = $derived(
		trackResults.length > 0 ||
			albumResults.length > 0 ||
			artistResults.length > 0 ||
			playlistResults.length > 0
	);
	const sectionNavItems = $derived.by<PageSectionNavItem[]>(() => [
		{ id: 'search-controls', label: 'Search' },
		{ id: 'search-section-albums', label: 'Albums', hidden: albumResults.length === 0 },
		{
			id: 'search-section-artists',
			label: 'Artists',
			tone: 'secondary',
			hidden: artistResults.length === 0
		},
		{
			id: 'search-section-tracks',
			label: 'Songs',
			tone: 'tertiary',
			hidden: trackResults.length === 0
		},
		{
			id: 'search-section-playlists',
			label: 'Playlists',
			tone: 'secondary',
			hidden: playlistResults.length === 0
		}
	]);

	interface Props {
		onTrackSelect?: (track: PlayableTrack) => void;
	}

	let { onTrackSelect }: Props = $props();

	async function handleDownloadWithFallback(track: PlayableTrack, event?: MouseEvent) {
		try {
			await handleDownload(track, event);
		} catch (error) {
			console.error('Failed to download track:', error);
		}
	}

	function patchAlbumDownloadState(albumId: number, patch: Partial<AlbumDownloadState>) {
		const previous = albumDownloadStates[albumId] ?? createDefaultAlbumDownloadState();
		albumDownloadStates = {
			...albumDownloadStates,
			[albumId]: { ...previous, ...patch }
		};
	}

	function getAlbumDownloadState(albumId: number): AlbumDownloadState {
		return albumDownloadStates[albumId] ?? createDefaultAlbumDownloadState();
	}

	const albumQueueController = createAlbumQueueController({
		getState: getAlbumDownloadState,
		patchState: patchAlbumDownloadState,
		pollIntervalMs: ALBUM_QUEUE_POLL_INTERVAL_MS
	});

	const albumMusicBrainzController = createAlbumMusicBrainzMatchController({
		concurrency: ALBUM_MUSICBRAINZ_LOOKUP_CONCURRENCY,
		lookupLimit: ALBUM_MUSICBRAINZ_LOOKUP_LIMIT,
		hasMatch: (albumId) => Boolean(albumMusicBrainzReleaseMatches[albumId]),
		onMatch: (albumId, releaseId) => {
			albumMusicBrainzReleaseMatches = {
				...albumMusicBrainzReleaseMatches,
				[albumId]: releaseId
			};
			if (pendingAlbumMusicBrainzAlbumIds.has(albumId)) {
				const next = new Set(pendingAlbumMusicBrainzAlbumIds);
				next.delete(albumId);
				pendingAlbumMusicBrainzAlbumIds = next;
			}
		}
	});

	function shouldWarnMusicBrainzStillLoadingForAlbum(albumId: number): boolean {
		return (
			isAlbumMusicBrainzLookupLoading &&
			pendingAlbumMusicBrainzAlbumIds.has(albumId) &&
			!albumMusicBrainzReleaseMatches[albumId]
		);
	}

	async function cancelAlbumQueueDownload(albumId: number, event?: MouseEvent): Promise<void> {
		event?.preventDefault();
		event?.stopPropagation();

		const result = await albumQueueController.cancelQueueDownload(albumId);
		if (result.success || !result.error) {
			return;
		}

		patchAlbumDownloadState(albumId, {
			error: result.error || 'Unable to stop this album download right now.'
		});
	}

	async function resumeAlbumQueueDownload(albumId: number, event?: MouseEvent): Promise<void> {
		event?.preventDefault();
		event?.stopPropagation();

		const result = await albumQueueController.resumeQueueDownload(albumId);
		if (result.success || !result.error) {
			return;
		}

		patchAlbumDownloadState(albumId, {
			error: result.error || 'Unable to resume this album download right now.'
		});
	}

	async function handleAlbumDownloadClick(album: Album, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();

		const currentState = getAlbumDownloadState(album.id);
		if (isAlbumQueueDownloadCancellable(currentState)) {
			await cancelAlbumQueueDownload(album.id);
			return;
		}
		if (currentState.status === 'paused') {
			await resumeAlbumQueueDownload(album.id);
			return;
		}
		if (currentState.downloading || currentState.status === 'submitting') {
			return;
		}
		if (shouldWarnMusicBrainzStillLoadingForAlbum(album.id)) {
			const proceedWithoutWaiting = window.confirm(MUSICBRAINZ_PENDING_DOWNLOAD_CONFIRMATION);
			if (!proceedWithoutWaiting) {
				return;
			}
		}

		patchAlbumDownloadState(album.id, {
			status: 'submitting',
			downloading: true,
			completed: 0,
			total: album.numberOfTracks ?? 0,
			error: null,
			queueJobId: null
		});

		try {
			const result = await downloadAlbum(
				album,
				albumDownloadQuality,
				{
					onTotalResolved: (total) => {
						patchAlbumDownloadState(album.id, { total });
					},
					onTrackDownloaded: (completed, total) => {
						patchAlbumDownloadState(album.id, {
							status: 'processing',
							downloading: true,
							completed,
							total
						});
					}
				},
				album.artist?.name,
				{
					mode: albumDownloadMode,
					convertAacToMp3: convertAacToMp3Preference,
					downloadCoverSeperately: downloadCoverSeperatelyPreference,
					experimentalMusicBrainzTagging: experimentalMusicBrainzTaggingPreference,
					strictMusicBrainzMatching: strictMusicBrainzMatchingPreference,
					storage: $downloadPreferencesStore.storage
				}
			);

			if (result.storage === 'server' && result.jobId) {
				patchAlbumDownloadState(album.id, {
					status: 'queued',
					downloading: false,
					completed: 0,
					total: result.totalTracks,
					error: null,
					queueJobId: result.jobId
				});
				albumQueueController.startPolling(album.id, result.jobId);
				return;
			}

			const finalState = getAlbumDownloadState(album.id);
			const failedTracks = result.failedTracks ?? 0;
			patchAlbumDownloadState(album.id, {
				status: failedTracks > 0 ? 'failed' : 'completed',
				downloading: false,
				completed: finalState.total ?? result.completedTracks ?? finalState.completed ?? 0,
				error:
					failedTracks > 0
						? `${failedTracks} track${failedTracks > 1 ? 's' : ''} failed after 3 attempts`
						: null,
				queueJobId: null
			});
		} catch (err) {
			console.error('Failed to download album:', err);
			const message =
				err instanceof Error && err.message
					? err.message
					: 'Failed to download album. Please try again.';
			patchAlbumDownloadState(album.id, {
				status: 'failed',
				downloading: false,
				error: message,
				queueJobId: null
			});
		}
	}

	$effect(() => {
		const activeIds = new Set(($searchStore.results?.albums ?? []).map((album) => album.id));
		let mutated = false;
		const nextState: Record<number, AlbumDownloadState> = {};
		for (const [albumId, state] of Object.entries(albumDownloadStates)) {
			const numericId = Number(albumId);
			if (activeIds.has(numericId)) {
				nextState[numericId] = state;
			} else {
				mutated = true;
				albumQueueController.stopPolling(numericId);
			}
		}
		if (mutated) {
			albumDownloadStates = nextState;
		}

		const nextMusicBrainzMatches: Record<number, string> = {};
		let mutatedMatches = false;
		for (const [albumId, releaseId] of Object.entries(albumMusicBrainzReleaseMatches)) {
			const numericId = Number(albumId);
			if (activeIds.has(numericId)) {
				nextMusicBrainzMatches[numericId] = releaseId;
			} else {
				mutatedMatches = true;
			}
		}
		if (mutatedMatches) {
			albumMusicBrainzReleaseMatches = nextMusicBrainzMatches;
		}
	});

	$effect(() => {
		if (albumResults.length === 0) {
			albumMusicBrainzLookupToken += 1;
			isAlbumMusicBrainzLookupLoading = false;
			pendingAlbumMusicBrainzAlbumIds = new Set();
			albumMusicBrainzController.invalidate();
			return;
		}
		const token = ++albumMusicBrainzLookupToken;
		const pendingIds = albumResults
			.slice(0, ALBUM_MUSICBRAINZ_LOOKUP_LIMIT)
			.map((album) => album.id);
		if (pendingIds.length === 0) {
			isAlbumMusicBrainzLookupLoading = false;
			pendingAlbumMusicBrainzAlbumIds = new Set();
			return;
		}

		isAlbumMusicBrainzLookupLoading = true;
		pendingAlbumMusicBrainzAlbumIds = new Set(pendingIds);
		void (async () => {
			try {
				await albumMusicBrainzController.hydrate(albumResults);
			} finally {
				if (token !== albumMusicBrainzLookupToken) {
					return;
				}
				isAlbumMusicBrainzLookupLoading = false;
				pendingAlbumMusicBrainzAlbumIds = new Set();
			}
		})();
	});

	function isSearchBusy(): boolean {
		return $searchStore.isLoading || $searchStore.tabLoading[$searchStore.activeTab];
	}

	async function runSearch() {
		const trimmedQuery = $searchStore.query.trim();
		if (!trimmedQuery) return;
		const scopeSettings = resolveSearchExecutionScopes(selectedSearchScopes);

		await searchOrchestrator.search(
			trimmedQuery,
			scopeSettings.primaryTab,
			buildSearchOrchestratorOptions({
				region: selectedRegion,
				showErrorToasts: true,
				targetTab: scopeSettings.primaryTab,
				artistFilter: albumArtistFilter,
				strictAlbumArtistMatch,
				aggregateTabs: scopeSettings.aggregateTabs,
				isUrlQuery: isQueryAUrl
			})
		);
	}

	async function handleSearchSubmit(): Promise<void> {
		if (isSearchBusy()) {
			searchOrchestrator.cancelActiveSearch();
			return;
		}
		await runSearch();
	}

	onDestroy(unsubscribeRegion);
	onDestroy(() => {
		albumMusicBrainzController.invalidate();
		albumQueueController.stopAllPolling();
	});
</script>

<div class="search-root" data-ui-block="main-sections">
	<section id="search-controls" class="ui-section-anchor">
		<SearchToolbar
			query={$searchStore.query}
			isLoading={$searchStore.isLoading}
			isActiveTabLoading={$searchStore.tabLoading[$searchStore.activeTab]}
			isQueryATidalUrl={isQueryATidalUrl}
			isQueryASpotifyPlaylist={isQueryASpotifyPlaylist}
			isQueryAStreamingUrl={isQueryAStreamingUrl}
			isQueryAUrl={isQueryAUrl}
			selectedSearchScopes={selectedSearchScopes}
			searchScopeOptions={SEARCH_SCOPE_OPTIONS}
			albumArtistFilter={albumArtistFilter}
			strictAlbumArtistMatch={strictAlbumArtistMatch}
			onSubmit={() => void handleSearchSubmit()}
			onQueryInput={(value) => {
				searchStoreActions.setQuery(value);
			}}
			onToggleScope={toggleScope}
			onAlbumArtistFilterInput={(value) => {
				albumArtistFilter = value;
			}}
			onStrictAlbumArtistMatchChange={(strict) => {
				strictAlbumArtistMatch = strict;
			}}
		/>
	</section>

	<PageSectionNav items={sectionNavItems} sticky={true} />

	{#if $searchStore.error}
		<StateBlock kind="error" title="Search failed" message={$searchStore.error} />
	{/if}

	{#if $searchStore.playlistLoadingMessage}
		<div class="ui-inline-status search-status" aria-live="polite">
			<LoaderCircle class="animate-spin" size={18} />
			<span>{$searchStore.playlistLoadingMessage}</span>
		</div>
	{/if}

	{#if !$searchStore.error}
		{#if hasAnySearchResults}
			<div class={`search-sections ${shouldUseSingleColumnResults ? 'search-sections--single' : ''}`}>
				{#if trackResults.length > 0}
					<SearchTracksSection
						tracks={trackResults}
						downloadingIds={$downloadingIds}
						cancelledIds={$cancelledIds}
						downloadActionLabel={downloadActionLabel}
						onTrackSelect={onTrackSelect}
						onDownload={handleDownloadWithFallback}
						onCancel={handleCancelDownload}
					/>
				{/if}

				{#if albumResults.length > 0}
					<SearchAlbumsSection
						albums={albumResults}
						albumDownloadStates={albumDownloadStates}
						albumMusicBrainzReleaseMatches={albumMusicBrainzReleaseMatches}
						isMusicBrainzLoading={isAlbumMusicBrainzLookupLoading}
						pendingMusicBrainzAlbumIds={pendingAlbumMusicBrainzAlbumIds}
						downloadActionLabel={downloadActionLabel}
						onDownloadClick={handleAlbumDownloadClick}
						onCancelQueueDownload={cancelAlbumQueueDownload}
					/>
				{/if}

				{#if artistResults.length > 0}
					<SearchArtistsSection artists={artistResults} />
				{/if}

				{#if playlistResults.length > 0}
					<SearchPlaylistsSection playlists={playlistResults} />
				{/if}
			</div>

			{#if $searchStore.isLoading}
				<div class="ui-inline-status search-status" aria-live="polite">
					<LoaderCircle class="animate-spin" size={18} />
					<span>Refining results…</span>
				</div>
			{/if}
		{:else if !$searchStore.query.trim()}
				<section class="search-empty">
					<h2 class="search-empty__title">Minimal Search</h2>
					<p class="search-empty__text">
						Choose sections, enter a query, optionally add an album artist filter, then run search.
					</p>
				</section>
		{:else if isQueryATidalUrl}
			<section class="search-empty">
				<p class="search-empty__text">TIDAL URL detected. Press Search to load it.</p>
			</section>
		{:else if isQueryASpotifyPlaylist}
			<section class="search-empty">
				<p class="search-empty__text">Spotify playlist detected. Press Search to convert it.</p>
			</section>
		{:else if isQueryAStreamingUrl}
			<section class="search-empty">
				<p class="search-empty__text">Streaming URL detected. Press Search to convert it.</p>
			</section>
		{:else if $searchStore.isLoading}
			<div class="ui-inline-status search-status" aria-live="polite">
				<LoaderCircle class="animate-spin" size={18} />
				<span>Searching…</span>
			</div>
		{:else}
			<StateBlock
				kind="empty"
				title="No results found"
				message="Try a different query or disable strict artist match."
			/>
		{/if}
	{/if}
</div>

<style>
	.search-root {
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
	}

	.search-status {
		padding-top: 0.15rem;
	}

	.search-sections {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.4rem;
	}

	.search-empty {
		display: flex;
		flex-direction: column;
		gap: 0.32rem;
		padding: 1rem 0 0;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
	}

	.search-empty__title {
		margin: 0;
		font-size: 1.12rem;
		color: rgba(243, 243, 243, 0.97);
	}

	.search-empty__text {
		margin: 0;
		font-size: 0.94rem;
		color: rgba(204, 204, 204, 0.78);
	}

	@media (min-width: 1080px) {
		.search-sections {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			align-items: start;
			column-gap: 2rem;
			row-gap: 1.65rem;
		}

		.search-sections.search-sections--single {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
