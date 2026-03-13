<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { losslessAPI } from '$lib/api';
	import { hasRegionTargets } from '$lib/config';
	import { downloadAlbum } from '$lib/downloads';
	import { isAlbumDownloadQueueActive, type AlbumDownloadStatus } from '$lib/controllers/albumDownloadUi';
	import { formatArtists } from '$lib/utils/formatters';
	import { createTrackDownloadUi } from '$lib/controllers/trackDownloadUi';
	import TrackDownloadButton from '$lib/components/TrackDownloadButton.svelte';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { regionStore, type RegionOption } from '$lib/stores/region';
	import { isTidalUrl } from '$lib/utils/urlParser';
	import { areTestHooksEnabled } from '$lib/utils/testHooks';
	import {
		isSupportedStreamingUrl,
		isSpotifyPlaylistUrl as isSpotifyPlaylistUrlUtil,
		getPlatformName
	} from '$lib/utils/songlink';
	import { searchOrchestrator } from '$lib/orchestrators';
	import type { Track, Album, AudioQuality, PlayableTrack } from '$lib/types';
	import { isSonglinkTrack } from '$lib/types';
	import { Download, RotateCcw, X, LoaderCircle, Search } from 'lucide-svelte';
	import { searchStore, searchStoreActions, type SearchTab } from '$lib/stores/searchStoreAdapter';

	const SEARCH_TABS: SearchTab[] = ['tracks', 'albums', 'artists', 'playlists'];

	function isSearchTab(value: string | null): value is SearchTab {
		return !!value && SEARCH_TABS.includes(value as SearchTab);
	}

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

	$effect(() => {
		const queryParam = ($page.url.searchParams.get('q') ?? '').trim();
		const tabParam = $page.url.searchParams.get('tab');
		const artistParam = ($page.url.searchParams.get('artist') ?? '').trim();
		const strictArtistParam = ($page.url.searchParams.get('strictArtist') ?? '').trim().toLowerCase();
		const strictFromUrl =
			strictArtistParam === '1' ||
			strictArtistParam === 'true' ||
			strictArtistParam === 'yes' ||
			strictArtistParam === 'on';
		const resolvedTab = isSearchTab(tabParam) ? tabParam : null;
		const lookupKey = `${queryParam}::${resolvedTab ?? ''}::${artistParam}::${strictFromUrl ? 'strict' : 'relaxed'}`;
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
		if ($searchStore.query !== queryParam) {
			searchStoreActions.setQuery(queryParam);
		}

		const targetTab = resolvedTab ?? $searchStore.activeTab;
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
		void searchOrchestrator.search(queryParam, targetTab, {
			region: selectedRegion,
			showErrorToasts: false,
			albumArtistQuery: targetTab === 'albums' ? albumArtistFilter.trim() : undefined,
			strictAlbumArtistMatch: targetTab === 'albums' ? strictAlbumArtistMatch : undefined,
			aggregateAllTabs: !isUrlQuery
		});
	});

	type AlbumDownloadState = {
		status: AlbumDownloadStatus;
		downloading: boolean;
		completed: number;
		total: number;
		error: string | null;
		queueJobId: string | null;
	};

	type DownloadQueuePayload = {
		success?: boolean;
		job?: {
			status?: 'queued' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
			trackCount?: number;
			completedTracks?: number;
			progress?: number;
			error?: string;
		};
	};

	const ALBUM_QUEUE_POLL_INTERVAL_MS = 1000;
	let albumDownloadStates = $state<Record<number, AlbumDownloadState>>({});
	const albumQueuePollTimers = new Map<number, ReturnType<typeof setInterval>>();
	const albumQueuePollTokens = new Map<number, number>();

	const trackResults = $derived($searchStore.results?.tracks ?? []);
	const albumResults = $derived($searchStore.results?.albums ?? []);
	const artistResults = $derived($searchStore.results?.artists ?? []);
	const playlistResults = $derived($searchStore.results?.playlists ?? []);
	const hasAnySearchResults = $derived(
		trackResults.length > 0 ||
			albumResults.length > 0 ||
			artistResults.length > 0 ||
			playlistResults.length > 0
	);

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

	function createDefaultAlbumDownloadState(total = 0): AlbumDownloadState {
		return {
			status: 'idle',
			downloading: false,
			completed: 0,
			total,
			error: null,
			queueJobId: null
		};
	}

	function getAlbumDownloadState(albumId: number): AlbumDownloadState {
		return albumDownloadStates[albumId] ?? createDefaultAlbumDownloadState();
	}

	function isAlbumQueueDownloadCancellable(state: AlbumDownloadState | undefined): boolean {
		if (!state) return false;
		return isAlbumDownloadQueueActive(state.status);
	}

	function stopAlbumQueuePolling(albumId: number): void {
		const timer = albumQueuePollTimers.get(albumId);
		if (timer) {
			clearInterval(timer);
			albumQueuePollTimers.delete(albumId);
		}
	}

	function stopAllAlbumQueuePolling(): void {
		for (const timer of albumQueuePollTimers.values()) {
			clearInterval(timer);
		}
		albumQueuePollTimers.clear();
		albumQueuePollTokens.clear();
	}

	function resolveAlbumQueueProgress(
		state: AlbumDownloadState,
		job: {
			trackCount?: number;
			completedTracks?: number;
			progress?: number;
		}
	): { total: number; completed: number } {
		const totalCandidate = Number(job.trackCount);
		const completedCandidate = Number(job.completedTracks);
		const progressCandidate = Number(job.progress);

		const total =
			Number.isFinite(totalCandidate) && totalCandidate > 0
				? totalCandidate
				: state.total > 0
					? state.total
					: 0;
		const progressCompleted =
			Number.isFinite(progressCandidate) && total > 0 ? Math.round(progressCandidate * total) : state.completed;
		const completed =
			Number.isFinite(completedCandidate) && completedCandidate >= 0
				? completedCandidate
				: progressCompleted;

		if (total > 0) {
			return { total, completed: Math.min(total, Math.max(0, completed)) };
		}
		return { total, completed: Math.max(0, completed) };
	}

	async function pollAlbumQueueJob(albumId: number, jobId: string, pollToken: number): Promise<void> {
		if (!jobId || albumQueuePollTokens.get(albumId) !== pollToken) {
			return;
		}

		try {
			const response = await fetch(`/api/download-queue/${jobId}`);
			if (!response.ok) {
				return;
			}
			const payload = (await response.json()) as DownloadQueuePayload;
			if (!payload.success || !payload.job || albumQueuePollTokens.get(albumId) !== pollToken) {
				return;
			}

			const current = getAlbumDownloadState(albumId);
			const progress = resolveAlbumQueueProgress(current, payload.job);

			switch (payload.job.status) {
				case 'queued':
					patchAlbumDownloadState(albumId, {
						status: 'queued',
						downloading: false,
						total: progress.total,
						completed: progress.completed,
						error: null
					});
					break;
				case 'processing':
					patchAlbumDownloadState(albumId, {
						status: 'processing',
						downloading: true,
						total: progress.total,
						completed: progress.completed,
						error: null
					});
					break;
				case 'paused':
					patchAlbumDownloadState(albumId, {
						status: 'paused',
						downloading: false,
						total: progress.total,
						completed: progress.completed,
						error: null
					});
					stopAlbumQueuePolling(albumId);
					albumQueuePollTokens.delete(albumId);
					break;
				case 'completed':
					patchAlbumDownloadState(albumId, {
						status: 'completed',
						downloading: false,
						total: progress.total,
						completed: progress.total || progress.completed,
						error: null,
						queueJobId: null
					});
					stopAlbumQueuePolling(albumId);
					albumQueuePollTokens.delete(albumId);
					break;
				case 'cancelled':
					patchAlbumDownloadState(albumId, {
						status: 'cancelled',
						downloading: false,
						error: null,
						queueJobId: null
					});
					stopAlbumQueuePolling(albumId);
					albumQueuePollTokens.delete(albumId);
					break;
				case 'failed':
					patchAlbumDownloadState(albumId, {
						status: 'failed',
						downloading: false,
						error: payload.job.error ?? 'Album download failed.',
						queueJobId: null
					});
					stopAlbumQueuePolling(albumId);
					albumQueuePollTokens.delete(albumId);
					break;
				default:
					break;
			}
		} catch {
			// Keep optimistic state and let the next poll reconcile.
		}
	}

	function startAlbumQueuePolling(albumId: number, jobId: string): void {
		stopAlbumQueuePolling(albumId);
		const currentToken = (albumQueuePollTokens.get(albumId) ?? 0) + 1;
		albumQueuePollTokens.set(albumId, currentToken);
		void pollAlbumQueueJob(albumId, jobId, currentToken);
		const timer = setInterval(() => {
			void pollAlbumQueueJob(albumId, jobId, currentToken);
		}, ALBUM_QUEUE_POLL_INTERVAL_MS);
		albumQueuePollTimers.set(albumId, timer);
	}

	async function cancelAlbumQueueDownload(albumId: number, event?: MouseEvent): Promise<void> {
		event?.preventDefault();
		event?.stopPropagation();

		const state = getAlbumDownloadState(albumId);
		if (!isAlbumQueueDownloadCancellable(state) || !state.queueJobId) {
			return;
		}

		try {
			const response = await fetch(`/api/download-queue/${state.queueJobId}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ action: 'cancel' })
			});
			if (!response.ok) {
				const body = await response.text();
				throw new Error(body || 'Failed to cancel album download');
			}
			patchAlbumDownloadState(albumId, {
				status: 'cancelled',
				downloading: false,
				error: null,
				queueJobId: null
			});
			stopAlbumQueuePolling(albumId);
			albumQueuePollTokens.delete(albumId);
		} catch (cancelError) {
			patchAlbumDownloadState(albumId, {
				error:
					cancelError instanceof Error && cancelError.message
						? cancelError.message
						: 'Unable to stop this album download right now.'
			});
		}
	}

	async function resumeAlbumQueueDownload(albumId: number, event?: MouseEvent): Promise<void> {
		event?.preventDefault();
		event?.stopPropagation();

		const state = getAlbumDownloadState(albumId);
		if (state.status !== 'paused' || !state.queueJobId) {
			return;
		}

		try {
			const response = await fetch(`/api/download-queue/${state.queueJobId}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ action: 'resume' })
			});
			if (!response.ok) {
				const body = await response.text();
				throw new Error(body || 'Failed to resume album download');
			}
			patchAlbumDownloadState(albumId, {
				status: 'queued',
				downloading: false,
				error: null
			});
			startAlbumQueuePolling(albumId, state.queueJobId);
		} catch (resumeError) {
			patchAlbumDownloadState(albumId, {
				error:
					resumeError instanceof Error && resumeError.message
						? resumeError.message
						: 'Unable to resume this album download right now.'
			});
		}
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
				startAlbumQueuePolling(album.id, result.jobId);
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

	function handleTrackActivation(track: PlayableTrack) {
		onTrackSelect?.(track);
	}

	function handleTrackKeydown(event: KeyboardEvent, track: PlayableTrack) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleTrackActivation(track);
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
				stopAlbumQueuePolling(numericId);
				albumQueuePollTokens.delete(numericId);
			}
		}
		if (mutated) {
			albumDownloadStates = nextState;
		}
	});

	async function handleSearch() {
		const trimmedQuery = $searchStore.query.trim();
		if (!trimmedQuery) return;
		if ($searchStore.isLoading || $searchStore.tabLoading[$searchStore.activeTab]) return;
		const artistFilter = albumArtistFilter.trim();

		await searchOrchestrator.search(trimmedQuery, $searchStore.activeTab as SearchTab, {
			region: selectedRegion,
			showErrorToasts: true,
			albumArtistQuery: $searchStore.activeTab === 'albums' ? artistFilter : undefined,
			strictAlbumArtistMatch:
				$searchStore.activeTab === 'albums' ? strictAlbumArtistMatch : undefined,
			aggregateAllTabs: !isQueryAUrl
		});
	}

	function displayTrackTotal(total?: number | null): number {
		if (!Number.isFinite(total)) return 0;
		return total && total > 0 ? total : (total ?? 0);
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

	function asTrack(track: PlayableTrack): Track {
		return track as Track;
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

	onDestroy(unsubscribeRegion);
	onDestroy(() => {
		stopAllAlbumQueuePolling();
	});
</script>

<div class="search-root" data-ui-block="main-sections">
	<section class="ui-tool-panel search-panel" aria-label="Catalog search">
		<p class="search-panel__label">Search</p>
		<form
			class="search-panel__form"
			onsubmit={(event) => {
				event.preventDefault();
				void handleSearch();
			}}
		>
			<div class="search-panel__row">
				<input
					id="catalog-search-input"
					type="text"
					value={$searchStore.query}
					oninput={(event) => {
						const target = event.currentTarget as HTMLInputElement | null;
						if (target) {
							searchStoreActions.setQuery(target.value);
						}
					}}
					placeholder={isQueryATidalUrl
						? 'TIDAL URL detected'
						: isQueryASpotifyPlaylist
							? 'Spotify playlist detected'
							: isQueryAStreamingUrl
								? `${getPlatformName($searchStore.query)} URL detected`
								: 'Album, song, artist, or URL'}
					class="search-panel__input"
				/>
				<button
					type="submit"
					class="ui-action-button ui-action-button--primary search-panel__submit"
					disabled={
						!$searchStore.query.trim() ||
						$searchStore.isLoading ||
						$searchStore.tabLoading[$searchStore.activeTab]
					}
					aria-busy={$searchStore.isLoading || $searchStore.tabLoading[$searchStore.activeTab]}
				>
					{#if $searchStore.isLoading || $searchStore.tabLoading[$searchStore.activeTab]}
						<LoaderCircle size={16} class="animate-spin" />
						Searching
					{:else}
						<Search size={16} />
						Search
					{/if}
				</button>
			</div>

			{#if !isQueryAUrl && $searchStore.activeTab === 'albums'}
				<div class="search-panel__row search-panel__row--secondary">
					<input
						id="album-artist-filter"
						type="text"
						value={albumArtistFilter}
						oninput={(event) => {
							const target = event.currentTarget as HTMLInputElement | null;
							if (target) {
								albumArtistFilter = target.value;
							}
						}}
						placeholder="Optional artist filter (supports * and ?)"
						class="search-panel__input"
					/>
					<label class="search-panel__strict">
						<input
							type="checkbox"
							checked={strictAlbumArtistMatch}
							onchange={(event) => {
								const target = event.currentTarget as HTMLInputElement | null;
								if (target) {
									strictAlbumArtistMatch = target.checked;
								}
							}}
							disabled={!albumArtistFilter.trim()}
						/>
						<span>Strict full-name match</span>
					</label>
				</div>
			{/if}
		</form>
	</section>

	{#if $searchStore.error}
		<StateBlock kind="error" title="Search failed" message={$searchStore.error} />
	{/if}

	{#if $searchStore.playlistLoadingMessage}
		<div class="search-status" aria-live="polite">
			<LoaderCircle class="animate-spin" size={18} />
			<span>{$searchStore.playlistLoadingMessage}</span>
		</div>
	{/if}

	{#if !$searchStore.error}
		{#if hasAnySearchResults}
			<div class="search-sections">
				{#if trackResults.length > 0}
					<section id="search-section-tracks" class="search-section">
						<header class="search-section__header">
							<h2 class="search-section__title">Songs</h2>
							<span class="search-section__count">{trackResults.length}</span>
						</header>
						<div class="search-list">
							{#each trackResults as track (track.id)}
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
										isDownloading={$downloadingIds.has(track.id)}
										isCancelled={$cancelledIds.has(track.id)}
										onCancel={(event) => handleCancelDownload(track.id, event)}
										onDownload={(event) => handleDownloadWithFallback(track, event)}
										title={$downloadingIds.has(track.id) ? 'Cancel download' : `${downloadActionLabel} track`}
										ariaLabel={$downloadingIds.has(track.id)
											? `Cancel download for ${track.title}`
											: `${downloadActionLabel} ${track.title}`}
									/>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				{#if albumResults.length > 0}
					<section id="search-section-albums" class="search-section">
						<header class="search-section__header">
							<h2 class="search-section__title">Albums</h2>
							<span class="search-section__count">{albumResults.length}</span>
						</header>
						<div class="search-list">
							{#each albumResults as album (album.id)}
								{@const albumDownloadState =
									albumDownloadStates[album.id] ??
									createDefaultAlbumDownloadState(album.numberOfTracks ?? 0)}
								{@const canCancelAlbumDownload = isAlbumQueueDownloadCancellable(albumDownloadState)}
								<div class="search-row search-row--album">
									<a
										href={`/album/${album.id}`}
										class="search-row__content search-row__content--link"
										aria-label={`Open album ${album.title}`}
										data-sveltekit-preload-data
									>
										<p class="search-row__title">{album.title}</p>
										<p class="search-row__meta">
											{album.artist?.name ?? 'Unknown artist'}
											{#if album.releaseDate}
												• {album.releaseDate.split('-')[0]}
											{/if}
											• {displayTrackTotal(album.numberOfTracks)} track{displayTrackTotal(
												album.numberOfTracks
											) === 1
												? ''
												: 's'}
											{#if albumStatusText(albumDownloadState)}
												• {albumStatusText(albumDownloadState)}
											{/if}
										</p>
									</a>
									<button
										onclick={(event) =>
											canCancelAlbumDownload
												? cancelAlbumQueueDownload(album.id, event)
												: handleAlbumDownloadClick(album, event)}
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
										aria-busy={albumDownloadState.status === 'submitting' || albumDownloadState.status === 'queued' || albumDownloadState.downloading}
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
				{/if}

				{#if artistResults.length > 0}
					<section id="search-section-artists" class="search-section">
						<header class="search-section__header">
							<h2 class="search-section__title">Artists</h2>
							<span class="search-section__count">{artistResults.length}</span>
						</header>
						<div class="search-list">
							{#each artistResults as artist (artist.id)}
								<a
									href={`/artist/${artist.id}`}
									class="search-row search-row--link"
									aria-label={`Open artist ${artist.name}`}
									data-sveltekit-preload-data
								>
									<div class="search-row__content">
										<p class="search-row__title">{artist.name}</p>
										<p class="search-row__meta">
											{artist.type && artist.type.trim().length > 0 ? artist.type : 'Artist'}
										</p>
									</div>
								</a>
							{/each}
						</div>
					</section>
				{/if}

				{#if playlistResults.length > 0}
					<section id="search-section-playlists" class="search-section">
						<header class="search-section__header">
							<h2 class="search-section__title">Playlists</h2>
							<span class="search-section__count">{playlistResults.length}</span>
						</header>
						<div class="search-list">
							{#each playlistResults as playlist (playlist.uuid)}
								<a
									href={`/playlist/${playlist.uuid}`}
									class="search-row search-row--link"
									aria-label={`Open playlist ${playlist.title}`}
									data-sveltekit-preload-data
								>
									<div class="search-row__content">
										<p class="search-row__title">{playlist.title}</p>
										<p class="search-row__meta">
											{playlist.creator.name} • {displayTrackTotal(playlist.numberOfTracks)} track{displayTrackTotal(
												playlist.numberOfTracks
											) === 1
												? ''
												: 's'}
											{#if playlist.duration}
												• {losslessAPI.formatDuration(playlist.duration)}
											{/if}
										</p>
									</div>
								</a>
							{/each}
						</div>
					</section>
				{/if}
			</div>

			{#if $searchStore.isLoading}
				<div class="search-status" aria-live="polite">
					<LoaderCircle class="animate-spin" size={18} />
					<span>Refining results…</span>
				</div>
			{/if}
		{:else if !$searchStore.query.trim()}
			<section class="ui-surface-card search-empty">
				<h2 class="search-empty__title">Minimal Search</h2>
				<p class="search-empty__text">
					Enter a query, optionally add an artist filter for albums, then run search.
				</p>
			</section>
		{:else if isQueryATidalUrl}
			<section class="ui-surface-card search-empty">
				<p class="search-empty__text">TIDAL URL detected. Press Search to load it.</p>
			</section>
		{:else if isQueryASpotifyPlaylist}
			<section class="ui-surface-card search-empty">
				<p class="search-empty__text">Spotify playlist detected. Press Search to convert it.</p>
			</section>
		{:else if isQueryAStreamingUrl}
			<section class="ui-surface-card search-empty">
				<p class="search-empty__text">Streaming URL detected. Press Search to convert it.</p>
			</section>
		{:else if $searchStore.isLoading}
			<div class="search-status" aria-live="polite">
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
		gap: 1rem;
	}

	.search-panel {
		gap: 0.6rem;
	}

	.search-panel__form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0;
	}

	.search-panel__label {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: rgba(214, 214, 214, 0.72);
	}

	.search-panel__row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.search-panel__row--secondary {
		align-items: stretch;
	}

	.search-panel__input {
		width: 100%;
		min-width: 0;
		min-height: 2.7rem;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		border-radius: var(--ui-radius-sm, 9px);
		background: var(--ui-surface-0, #0d0d0d);
		padding: 0.58rem 0.75rem;
		font-size: 1rem;
		color: rgba(245, 245, 245, 0.96);
		outline: none;
	}

	.search-panel__input:focus-visible {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
	}

	.search-panel__submit {
		flex-shrink: 0;
		min-width: 8.2rem;
	}

	.search-panel__strict {
		display: inline-flex;
		align-items: center;
		gap: 0.42rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		border-radius: var(--ui-radius-sm, 9px);
		background: var(--ui-surface-0, #0d0d0d);
		font-size: 0.88rem;
		color: rgba(212, 212, 212, 0.86);
		white-space: nowrap;
	}

	.search-panel__strict input[type='checkbox'] {
		accent-color: #f2f2f2;
	}

	.search-panel__strict input[type='checkbox']:disabled {
		opacity: 0.5;
	}

	.search-status {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		border-radius: var(--ui-radius-sm, 9px);
		background: var(--ui-surface-0, #0d0d0d);
		color: rgba(228, 228, 228, 0.9);
		font-size: 0.9rem;
	}

	.search-sections {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.search-section {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
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
		color: rgba(245, 245, 245, 0.97);
	}

	.search-section__count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.75rem;
		height: 1.4rem;
		padding: 0 0.4rem;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		border-radius: 999px;
		background: var(--ui-surface-0, #0d0d0d);
		font-size: 0.8rem;
		font-weight: 700;
		color: rgba(226, 226, 226, 0.9);
	}

	.search-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		border-radius: var(--ui-radius-md, 12px);
		background: var(--ui-surface-raised, #121212);
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

	.search-row[role='button'] {
		cursor: pointer;
	}

	.search-row[role='button']:hover,
	.search-row--link:hover,
	.search-row--album:hover {
		background: var(--ui-surface-interactive, #171717);
	}

	.search-row__content {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
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

	.search-empty {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 1rem;
	}

	.search-empty__title {
		margin: 0;
		font-size: 1.05rem;
		color: rgba(243, 243, 243, 0.97);
	}

	.search-empty__text {
		margin: 0;
		font-size: 0.92rem;
		color: rgba(204, 204, 204, 0.84);
	}

	@media (max-width: 780px) {
		.search-panel__row--secondary {
			flex-direction: column;
		}

		.search-panel__strict {
			width: 100%;
			justify-content: center;
		}
	}

	@media (max-width: 640px) {
		.search-panel__row {
			flex-direction: column;
			align-items: stretch;
		}

		.search-panel__submit {
			width: 100%;
		}

		.search-row {
			flex-wrap: wrap;
		}

		.search-row__duration {
			order: 3;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.search-row,
		.search-row__action {
			transition: none;
		}
	}
</style>
