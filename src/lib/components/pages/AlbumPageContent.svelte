<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { losslessAPI } from '$lib/api';
	import {
		isAlbumDownloadQueueActive,
		type AlbumDownloadStatus
	} from '$lib/controllers/albumDownloadUi';
	import CoverArt from '$lib/components/CoverArt.svelte';
	import TrackList from '$lib/components/TrackList.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import DataGrid from '$lib/components/ui/DataGrid.svelte';
	import MetaStrip from '$lib/components/ui/MetaStrip.svelte';
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import StateNotice from '$lib/components/ui/StateNotice.svelte';
	import { confirm as requestConfirmation } from '$lib/stores/dialogs';
	import type { Album, Track } from '$lib/types';
	import ArtistLinks from '$lib/components/ArtistLinks.svelte';
	import {
		ArrowLeft,
		Play,
		Pause,
		Calendar,
		Disc,
		Clock,
		Download,
		Shuffle,
		LoaderCircle,
		X
	} from 'lucide-svelte';
	import {
		machineCurrentTrack,
		machineIsPlaying,
		machineIsLoading,
		machineQueue
	} from '$lib/stores/playerDerived';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { browseState } from '$lib/stores/browseState';
	import { artistCacheStore } from '$lib/stores/artistCache';
	import { navigationHistoryStore } from '$lib/stores/navigationHistory';
	import { getCoverCacheKey, getUnifiedCoverCandidates } from '$lib/utils/coverPipeline';
	import { fetchAlbumLibraryStatus } from '$lib/utils/mediaLibraryClient';
	import {
		type MusicBrainzReleaseOption,
		formatMusicBrainzReleaseOption,
		lookupAlbumMusicBrainzReleases
	} from '$lib/features/album/albumMusicBrainzController';
	import {
		shuffleAlbumTracks,
		toggleAlbumPlayback
	} from '$lib/features/album/albumPlaybackController';
	import {
		applyLoadedAlbumContext,
		createAlbumLoadController
	} from '$lib/features/album/albumLoadController';
	import {
		CLIENT_REDOWNLOAD_CONFIRMATION,
		createAlbumDownloadController,
		FORCE_OVERWRITE_CONFIRMATION,
		type AlbumRouteDownloadPreferences,
		type AlbumRouteMaintenanceState,
		type AlbumRouteQueueState
	} from '$lib/features/album/albumDownloadController';
	import {
		findMissingTrackNumbers,
		resolveExpectedTrackCount
	} from '$lib/features/album/albumTrackListModel';

	let album = $state<Album | null>(null);
	let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isDownloadingAll = $state(false);
	let downloadedCount = $state(0);

	const isAlbumQueue = $derived(
		tracks.length > 0 &&
			$machineQueue.length === tracks.length &&
			$machineQueue.every((t, i) => t?.id === tracks[i]?.id)
	);
	const isAlbumPlaying = $derived(isAlbumQueue && ($machineIsPlaying || $machineIsLoading));
	let downloadError = $state<string | null>(null);
	const albumDownloadMode = $derived($downloadPreferencesStore.mode);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const experimentalMusicBrainzTaggingPreference = $derived(
		$userPreferencesStore.experimentalMusicBrainzTagging
	);
	const strictMusicBrainzMatchingPreference = $derived(
		$userPreferencesStore.strictMusicBrainzMatching
	);
	const downloadStoragePreference = $derived($downloadPreferencesStore.storage);
	type AlbumQueueStatus = AlbumDownloadStatus;
	let queueStatus = $state<AlbumQueueStatus>('idle');
	let queueJobId = $state<string | null>(null);
	let queueCompletedTracks = $state(0);
	let queueTotalTracks = $state(0);
	let albumInLibrary = $state(false);
	let albumLibraryTrackCount = $state(0);
	let isRepairingAlbum = $state(false);
	let repairMessage = $state<string | null>(null);
	let musicBrainzReleaseOptions = $state<MusicBrainzReleaseOption[]>([]);
	let selectedMusicBrainzReleaseId = $state<string>('');
	let isMusicBrainzReleaseLookupLoading = $state(false);
	let musicBrainzReleaseLookupError = $state<string | null>(null);
	let hasMusicBrainzReleaseLookupAttempted = $state(false);
	let musicBrainzReleaseLookupToken = 0;
	let activeMusicBrainzReleaseLookupPromise: Promise<string | undefined> | null = null;

	const hasActiveQueueDownload = $derived(
		queueStatus === 'submitting' || queueStatus === 'queued' || queueStatus === 'processing'
	);
	const isQueueDownloadCancellable = $derived(
		isAlbumDownloadQueueActive(queueStatus)
	);

	const albumId = $derived($page.params.id);

	function getQueueState(): AlbumRouteQueueState {
		return {
			queueStatus,
			queueJobId,
			queueCompletedTracks,
			queueTotalTracks,
			isDownloadingAll,
			downloadedCount,
			downloadError
		};
	}

	function patchQueueState(patch: Partial<AlbumRouteQueueState>): void {
		if (patch.queueStatus !== undefined) {
			queueStatus = patch.queueStatus;
		}
		if (patch.queueJobId !== undefined) {
			queueJobId = patch.queueJobId;
		}
		if (patch.queueCompletedTracks !== undefined) {
			queueCompletedTracks = patch.queueCompletedTracks;
		}
		if (patch.queueTotalTracks !== undefined) {
			queueTotalTracks = patch.queueTotalTracks;
		}
		if (patch.isDownloadingAll !== undefined) {
			isDownloadingAll = patch.isDownloadingAll;
		}
		if (patch.downloadedCount !== undefined) {
			downloadedCount = patch.downloadedCount;
		}
		if (patch.downloadError !== undefined) {
			downloadError = patch.downloadError;
		}
	}

	function getMaintenanceState(): AlbumRouteMaintenanceState {
		return {
			isRepairingAlbum,
			repairMessage
		};
	}

	function patchMaintenanceState(patch: Partial<AlbumRouteMaintenanceState>): void {
		if (patch.isRepairingAlbum !== undefined) {
			isRepairingAlbum = patch.isRepairingAlbum;
		}
		if (patch.repairMessage !== undefined) {
			repairMessage = patch.repairMessage;
		}
	}

	async function refreshAlbumLibraryState(options?: { force?: boolean }): Promise<void> {
		const activeAlbum = album;
		if (!activeAlbum) {
			return;
		}
		const activeAlbumId = activeAlbum.id;
		const statusMap = await fetchAlbumLibraryStatus(
			[
				{
					id: activeAlbum.id,
					artistName: activeAlbum.artist?.name,
					albumTitle: activeAlbum.title,
					expectedTrackCount: tracks.length
				}
			],
			{ force: options?.force === true }
		);
		if (album?.id !== activeAlbumId) {
			return;
		}
		const status = statusMap[activeAlbumId];
		albumInLibrary = status?.exists === true;
		albumLibraryTrackCount = status?.matchedTracks ?? 0;
	}

	function resetMusicBrainzRouteState(): void {
		musicBrainzReleaseLookupToken += 1;
		activeMusicBrainzReleaseLookupPromise = null;
		musicBrainzReleaseOptions = [];
		selectedMusicBrainzReleaseId = '';
		isMusicBrainzReleaseLookupLoading = false;
		musicBrainzReleaseLookupError = null;
		hasMusicBrainzReleaseLookupAttempted = false;
	}

	const albumDownloadController = createAlbumDownloadController({
		getAlbum: () => album,
		getTracks: () => tracks,
		getCurrentAlbumId: () => album?.id ?? null,
		getQueueState,
		patchQueueState,
		getMaintenanceState,
		patchMaintenanceState,
		isAlbumInLibrary: () => albumInLibrary,
		getSelectedMusicBrainzReleaseId: () => selectedMusicBrainzReleaseId,
		resolveDeferredMusicBrainzReleaseId: () => ensureMusicBrainzReleaseSelectionLoaded(),
		getDownloadPreferences: (): AlbumRouteDownloadPreferences => ({
			quality: $downloadPreferencesStore.downloadQuality,
			mode: albumDownloadMode,
			convertAacToMp3: convertAacToMp3Preference,
			experimentalMusicBrainzTagging: experimentalMusicBrainzTaggingPreference,
			strictMusicBrainzMatching: strictMusicBrainzMatchingPreference,
			storage: downloadStoragePreference
		}),
		confirmServerOverwrite: () =>
			requestConfirmation({
				title: 'Overwrite album files?',
				body: FORCE_OVERWRITE_CONFIRMATION,
				confirmLabel: 'Overwrite files',
				cancelLabel: 'Keep existing files',
				tone: 'danger'
			}),
		confirmClientRedownload: () =>
			requestConfirmation({
				title: 'Download album again?',
				body: CLIENT_REDOWNLOAD_CONFIRMATION,
				confirmLabel: 'Download again',
				cancelLabel: 'Cancel',
				tone: 'warning'
			}),
		refreshAlbumLibraryState
	});

	const albumLoadController = createAlbumLoadController({
		loadAlbumFn: (id, options) => losslessAPI.getAlbum(id, options),
		onAlbumChange: () => {
			albumDownloadController.reset();
			albumInLibrary = false;
			albumLibraryTrackCount = 0;
			resetMusicBrainzRouteState();
		},
		onLoadStart: () => {
			isLoading = true;
			error = null;
		},
		onLoadSuccess: (result) => {
			album = result.album;
			tracks = result.tracks;
			albumInLibrary = result.albumInLibrary;
			albumLibraryTrackCount = result.albumLibraryTrackCount;
			error = null;
			applyLoadedAlbumContext({
				album: result.album,
				setViewingAlbum: (nextAlbum) => {
					browseState.setViewingAlbum(nextAlbum);
				},
				setArtistBreadcrumbLabel: (path, label) => {
					breadcrumbStore.setLabel(path, label);
				},
				setBreadcrumbParent: (path, parentPath) => {
					breadcrumbStore.setParent(path, parentPath);
				},
				setCurrentBreadcrumbLabel: (label, path) => {
					breadcrumbStore.setCurrentLabel(label, path);
				},
				recordAlbumVisit: (entry) => {
					navigationHistoryStore.visitAlbum(entry);
				},
				upsertArtistAlbumCover: (artistId, albumId, coverId) => {
					artistCacheStore.upsertAlbumCover(artistId, albumId, coverId);
				},
				upsertAlbumCoverGlobally: (albumId, coverId) => {
					artistCacheStore.upsertAlbumCoverGlobally(albumId, coverId);
				}
			});
		},
		onLoadError: (message, cause) => {
			error = message;
			console.error('Failed to load album:', cause);
		},
		onInvalidAlbumId: () => {
			album = null;
			tracks = [];
			error = 'Invalid album id';
			isLoading = false;
			albumInLibrary = false;
			albumLibraryTrackCount = 0;
			resetMusicBrainzRouteState();
			albumDownloadController.reset();
		},
		onLoadSettled: () => {
			isLoading = false;
		}
	});

	$effect(() => {
		void albumLoadController.load(albumId);
	});

	onDestroy(() => {
		albumLoadController.destroy();
		albumDownloadController.destroy();
	});

	const selectedMusicBrainzRelease = $derived.by(() =>
		musicBrainzReleaseOptions.find((release) => release.id === selectedMusicBrainzReleaseId) ?? null
	);
	const sectionNavItems = $derived.by(() => {
		const items = [
			{ id: 'album-actions', label: 'Actions', tone: 'secondary' as const },
			{ id: 'album-metadata', label: 'MusicBrainz', tone: 'tertiary' as const },
			{ id: 'album-tracks', label: 'Tracks' }
		];
		if (album?.copyright) {
			items.push({ id: 'album-notes', label: 'Notes' });
		}
		return items;
	});

	function ensureMusicBrainzReleaseSelectionLoaded(): Promise<string | undefined> {
		const selectedReleaseId = selectedMusicBrainzReleaseId.trim();
		if (selectedReleaseId) {
			return Promise.resolve(selectedReleaseId);
		}
		if (activeMusicBrainzReleaseLookupPromise) {
			return activeMusicBrainzReleaseLookupPromise;
		}
		if (
			hasMusicBrainzReleaseLookupAttempted &&
			!isMusicBrainzReleaseLookupLoading &&
			!musicBrainzReleaseLookupError &&
			musicBrainzReleaseOptions.length === 0
		) {
			return Promise.resolve(undefined);
		}
		return lookupMusicBrainzReleases({ manual: true });
	}

	async function lookupMusicBrainzReleases(
		options?: { manual?: boolean }
	): Promise<string | undefined> {
		if (!album) {
			return undefined;
		}
		const lookupToken = ++musicBrainzReleaseLookupToken;
		const activeAlbum = album;
		isMusicBrainzReleaseLookupLoading = true;
		musicBrainzReleaseLookupError = null;
		hasMusicBrainzReleaseLookupAttempted = true;
		const lookupPromise = (async () => {
			try {
				const result = await lookupAlbumMusicBrainzReleases({
					album: activeAlbum,
					tracks,
					currentSelectionId: selectedMusicBrainzReleaseId,
					fetchImpl: fetch
				});
				if (lookupToken !== musicBrainzReleaseLookupToken || album?.id !== activeAlbum.id) {
					return undefined;
				}
				musicBrainzReleaseOptions = result.releases;
				selectedMusicBrainzReleaseId = result.selectedReleaseId;
				return result.selectedReleaseId || undefined;
			} catch (lookupError) {
				const message =
					lookupError instanceof Error
						? lookupError.message
						: 'Failed to search MusicBrainz releases';
				musicBrainzReleaseOptions = [];
				selectedMusicBrainzReleaseId = '';
				musicBrainzReleaseLookupError = message;
				if (!options?.manual) {
					console.warn('[MusicBrainz] Release lookup failed on album page:', message);
				}
				return undefined;
			} finally {
				if (lookupToken === musicBrainzReleaseLookupToken) {
					isMusicBrainzReleaseLookupLoading = false;
					activeMusicBrainzReleaseLookupPromise = null;
				}
			}
		})();
		activeMusicBrainzReleaseLookupPromise = lookupPromise;
		return lookupPromise;
	}

	$effect(() => {
		if (!album) {
			resetMusicBrainzRouteState();
			return;
		}
		void lookupMusicBrainzReleases();
	});

	function handleAlbumPlaybackToggle() {
		toggleAlbumPlayback({
			tracks,
			isAlbumPlaying,
			isAlbumQueue,
			currentTrackId:
				typeof $machineCurrentTrack?.id === 'number' && Number.isFinite($machineCurrentTrack.id)
					? $machineCurrentTrack.id
					: undefined,
			playbackFacade
		});
	}

	function handleBackNavigation() {
		const target = breadcrumbStore.goBack($page.url.pathname, '/');
		void goto(target);
	}

	function handleShufflePlay() {
		if (tracks.length === 0) return;
		const shuffled = shuffleAlbumTracks(tracks);
		playbackFacade.loadQueue(shuffled, 0, { autoPlay: true });
	}

	async function handleDownloadAll(): Promise<void> {
		await albumDownloadController.handleDownloadAll();
	}

	async function handleRepairAlbum(): Promise<void> {
		await albumDownloadController.handleRepairAlbum();
	}

	const totalDuration = $derived(tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0));
	const expectedTrackCount = $derived.by(() => resolveExpectedTrackCount(album));
	const missingTrackNumbers = $derived.by(() => findMissingTrackNumbers(tracks, expectedTrackCount));
	const hasIncompleteTrackList = $derived.by(
		() =>
			expectedTrackCount !== null &&
			(tracks.length < expectedTrackCount || missingTrackNumbers.length > 0)
	);
	const missingTrackLabel = $derived.by(() => missingTrackNumbers.map((number) => `#${number}`).join(', '));
</script>

<svelte:head>
	<title>{album?.title || 'Album'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="ui-page flex items-center justify-center py-24" data-ui-archetype="detail" data-ui-route="album">
		<StateNotice
			tone="info"
			title="Loading album"
			message="Fetching album details, artwork, and track metadata."
			busy={true}
		/>
	</div>
{:else if error}
	<div class="ui-page py-12" data-ui-archetype="detail" data-ui-route="album">
		<div class="ui-surface-card border-red-500/40 bg-red-950/20 p-6">
			<StateNotice tone="error" title="Error loading album" message={error} />
			<a
				href="/"
				class="ui-action-button mt-4 inline-flex"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if album}
	<div
		class="ui-page space-y-6 pb-32 pt-4 lg:pb-40"
		data-ui-archetype="detail"
		data-ui-route="album"
		data-ui-block="main-content"
	>
		<!-- Back Button -->
		<button
			onclick={handleBackNavigation}
			class="ui-chip-button ui-chip-button--compact ui-detail-back"
			data-ui-block="back-nav"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<section class="ui-detail-hero" data-ui-block="entity-hero">
			<div class="ui-detail-hero__layout">
				{#if album.videoCover || album.cover}
					<div class="ui-detail-hero__art">
						{#if album.videoCover}
							<video
								src={losslessAPI.getVideoCoverUrl(album.videoCover, '640')}
								poster={album.cover ? losslessAPI.getCoverUrl(album.cover, '640') : undefined}
								aria-label={album.title}
								autoplay
								loop
								muted
								playsinline
								preload="metadata"
							></video>
						{:else}
							{@const coverCacheKey = getCoverCacheKey({
								coverId: album.cover,
								size: '640',
								proxy: false,
								overrideKey: `album:${album.id}`
							})}
							{@const coverCandidates = getUnifiedCoverCandidates({
								coverId: album.cover,
								size: '640',
								proxy: false,
								includeLowerSizes: true
							})}
							<CoverArt
								cacheKey={coverCacheKey}
								candidates={coverCandidates}
								alt={album.title}
								class="h-full w-full object-cover"
								loading="eager"
							/>
						{/if}
					</div>
				{/if}

				<div class="ui-detail-hero__body">
					<p class="ui-detail-hero__eyebrow">Album</p>
					<h1 class="ui-detail-hero__title">{album.title}</h1>
					{#if album.artist}
						<div class="ui-detail-hero__support">
							<ArtistLinks artists={[album.artist]} />
						</div>
					{/if}

					<MetaStrip>
						{#if album.explicit}
							<span class="ui-inline-tag">Explicit</span>
						{/if}
						{#if album.releaseDate}
							<div class="ui-meta-strip__item">
								<Calendar size={16} />
								{new Date(album.releaseDate).getFullYear()}
							</div>
						{/if}
						{#if tracks.length > 0 || album.numberOfTracks}
							<div class="ui-meta-strip__item">
								<Disc size={16} />
								{tracks.length || album.numberOfTracks} tracks
							</div>
						{/if}
						{#if totalDuration > 0}
							<div class="ui-meta-strip__item">
								<Clock size={16} />
								{losslessAPI.formatDuration(totalDuration)} total
							</div>
						{/if}
						{#if album.mediaMetadata?.tags}
							{#each album.mediaMetadata.tags as tag (tag)}
								<span class="ui-inline-tag">{tag}</span>
							{/each}
						{/if}
					</MetaStrip>

					{#if hasIncompleteTrackList}
						<StateNotice
							tone="warning"
							message={`Tracklist may be incomplete from source metadata: showing ${tracks.length}/${expectedTrackCount} tracks${missingTrackLabel ? ` (missing ${missingTrackLabel})` : ''}.`}
							compact={true}
							liveRegion="off"
						/>
					{/if}
				</div>
			</div>
		</section>

		<PageSectionNav items={sectionNavItems} sticky={true} />

		<div class="ui-detail-columns">
			<div class="ui-detail-main">
				<section
					id="album-tracks"
					class="ui-section-anchor"
					data-ui-block="main-content"
				>
					<SectionBlock title="Tracks" count={tracks.length}>
						{#if tracks.length === 0}
							<StateBlock
								kind="empty"
								title="No tracks available"
								message="Try refreshing this album or search for individual songs."
							/>
						{:else}
							<TrackList {tracks} showAlbum={false} />
						{/if}
					</SectionBlock>
				</section>
			</div>

			<div class="ui-detail-sidebar">
				{#if tracks.length > 0}
					<section id="album-actions" class="ui-section-anchor" data-ui-block="primary-actions">
						<SectionBlock
							title="Actions"
							subtitle="Play, download, and maintain this album."
							tone="secondary"
						>
							<div class="ui-action-row ui-action-row--progressive">
								<button
									onclick={handleAlbumPlaybackToggle}
									class="ui-action-button ui-action-button--primary"
									aria-label={isAlbumPlaying ? 'Pause album' : 'Play album'}
								>
									{#if isAlbumPlaying}
										<Pause size={16} fill="currentColor" />
										Pause
									{:else}
										<Play size={16} fill="currentColor" />
										Play Album
									{/if}
								</button>
								<button onclick={handleShufflePlay} class="ui-action-button">
									<Shuffle size={16} />
									Shuffle Album
								</button>
								<button
									onclick={handleDownloadAll}
									class="ui-action-button"
									disabled={queueStatus === 'submitting'}
									aria-label={isQueueDownloadCancellable ? 'Stop album download' : 'Download album'}
									aria-busy={hasActiveQueueDownload || isDownloadingAll}
								>
									{#if isQueueDownloadCancellable}
										<X size={16} />
										Stop Download
									{:else if queueStatus === 'submitting'}
										<LoaderCircle size={16} class="animate-spin" />
										Queueing…
									{:else if isDownloadingAll}
										<LoaderCircle size={16} class="animate-spin" />
										Downloading {downloadedCount}/{tracks.length}
									{:else}
										<Download size={16} />
										{queueStatus === 'failed'
											? 'Retry Download'
											: queueStatus === 'paused'
												? 'Resume Download'
											: queueStatus === 'cancelled'
												? 'Resume Download'
												: queueStatus === 'completed'
													? 'Download Again'
													: albumInLibrary && queueStatus === 'idle'
														? 'Redownload Album'
														: 'Download Album'}
									{/if}
								</button>
								{#if albumInLibrary}
									<button
										onclick={handleRepairAlbum}
										class="ui-action-button"
										disabled={isRepairingAlbum}
										aria-busy={isRepairingAlbum}
									>
										{#if isRepairingAlbum}
											<LoaderCircle size={16} class="animate-spin" />
											Checking Integrity…
										{:else}
											Repair Corrupt Files
										{/if}
									</button>
								{/if}
								<ShareButton type="album" id={album.id} variant="secondary" />
							</div>
							{#if queueStatus === 'queued'}
								<StateNotice
									tone="info"
									message="Queued on server. Open Download Manager for live progress."
									compact={true}
								/>
							{:else if queueStatus === 'processing'}
								<StateNotice
									tone="info"
									message={`Downloading on server${queueTotalTracks > 0 ? ` (${queueCompletedTracks}/${queueTotalTracks} tracks)` : ''}…`}
									compact={true}
									busy={true}
								/>
							{:else if queueStatus === 'completed'}
								<StateNotice tone="success" message="Album download completed." compact={true} />
							{:else if queueStatus === 'cancelled'}
								<StateNotice tone="warning" message="Album download stopped." compact={true} />
							{:else if queueStatus === 'paused'}
								<StateNotice tone="warning" message="Album download paused." compact={true} />
							{:else if albumInLibrary}
								<StateNotice
									tone="success"
									compact={true}
									liveRegion="off"
									message={
										downloadStoragePreference === 'server'
											? `Already in local library (${albumLibraryTrackCount} track${albumLibraryTrackCount === 1 ? '' : 's'} found). Click "Redownload Album" to overwrite.`
											: `Already in local library (${albumLibraryTrackCount} track${albumLibraryTrackCount === 1 ? '' : 's'} found). Browser redownloads may append (2) to filenames.`
									}
								/>
							{/if}
							{#if repairMessage}
								<StateNotice tone="success" message={repairMessage} compact={true} />
							{/if}
							{#if downloadError}
								<StateNotice tone="error" message={downloadError} compact={true} />
							{/if}
							{#if isMusicBrainzReleaseLookupLoading && !selectedMusicBrainzReleaseId}
								<StateNotice
									tone="info"
									message="MusicBrainz release data is loading in the background and will be applied automatically if it resolves in time."
									compact={true}
									busy={true}
								/>
							{/if}
						</SectionBlock>
					</section>
				{/if}

				<section id="album-metadata" class="ui-section-anchor" data-ui-block="context-metadata">
					<SectionBlock
						title="MusicBrainz"
						subtitle="Preferred release metadata for downloads."
						tone="tertiary"
					>
						<svelte:fragment slot="actions">
								<button
									type="button"
									onclick={() => lookupMusicBrainzReleases({ manual: true })}
									class="ui-chip-button ui-chip-button--compact"
									disabled={isMusicBrainzReleaseLookupLoading}
								>
									{#if isMusicBrainzReleaseLookupLoading}
										Refreshing…
									{:else}
										Refresh Matches
									{/if}
								</button>
						</svelte:fragment>
						{#if isMusicBrainzReleaseLookupLoading && musicBrainzReleaseOptions.length === 0}
							<StateNotice tone="info" message="Searching MusicBrainz releases…" compact={true} />
						{:else if isMusicBrainzReleaseLookupLoading}
							<StateNotice
								tone="info"
								message="Refreshing MusicBrainz releases…"
								compact={true}
								stale={musicBrainzReleaseOptions.length > 0}
							/>
						{:else if musicBrainzReleaseOptions.length > 0}
							<label class="ui-section-block__eyebrow" for="musicbrainz-release-select">
								Selected Release
							</label>
							<select
								id="musicbrainz-release-select"
								class="ui-select w-full"
								bind:value={selectedMusicBrainzReleaseId}
							>
								{#each musicBrainzReleaseOptions as release, index (release.id)}
									<option value={release.id}>
										{release.id === selectedMusicBrainzReleaseId
											? 'Selected - '
											: index === 0
												? 'Best Score - '
												: ''}{formatMusicBrainzReleaseOption(release)}
									</option>
								{/each}
							</select>
							{#if selectedMusicBrainzRelease}
								<DataGrid>
									{#if selectedMusicBrainzRelease.trackCount}
										<div class="ui-data-point">
											<p class="ui-data-point__label">Track Count</p>
											<p class="ui-data-point__value">{selectedMusicBrainzRelease.trackCount}</p>
										</div>
									{/if}
									{#if selectedMusicBrainzRelease.date}
										<div class="ui-data-point">
											<p class="ui-data-point__label">Release Date</p>
											<p class="ui-data-point__value">{selectedMusicBrainzRelease.date}</p>
										</div>
									{/if}
									{#if selectedMusicBrainzRelease.country}
										<div class="ui-data-point">
											<p class="ui-data-point__label">Country</p>
											<p class="ui-data-point__value">{selectedMusicBrainzRelease.country}</p>
										</div>
									{/if}
									{#if selectedMusicBrainzRelease.status}
										<div class="ui-data-point">
											<p class="ui-data-point__label">Status</p>
											<p class="ui-data-point__value">{selectedMusicBrainzRelease.status}</p>
										</div>
									{/if}
									{#if selectedMusicBrainzRelease.barcode}
										<div class="ui-data-point">
											<p class="ui-data-point__label">Barcode</p>
											<p class="ui-data-point__value">{selectedMusicBrainzRelease.barcode}</p>
										</div>
									{/if}
									<div class="ui-data-point">
										<p class="ui-data-point__label">Release MBID</p>
										<p class="ui-data-point__value">{selectedMusicBrainzRelease.id}</p>
									</div>
								</DataGrid>
								<p class="ui-action-status">
									<a
										href={`https://musicbrainz.org/release/${selectedMusicBrainzRelease.id}`}
										target="_blank"
										rel="noopener noreferrer"
										aria-label="Open release in MusicBrainz in a new tab"
										class="text-gray-300 underline decoration-dotted underline-offset-2 transition-colors hover:text-white"
									>
										Open release in MusicBrainz
									</a>
								</p>
							{/if}
						{:else if hasMusicBrainzReleaseLookupAttempted}
							<StateNotice
								tone="neutral"
								message="No MusicBrainz release matches found for this album."
								compact={true}
							/>
						{/if}
						{#if musicBrainzReleaseLookupError}
							<StateNotice tone="error" message={musicBrainzReleaseLookupError} compact={true} />
						{/if}
						<p class="ui-action-status">
							{#if experimentalMusicBrainzTaggingPreference}
								The selected release is used for MusicBrainz tagging when downloading this album.
							{:else}
								Enable experimental MusicBrainz tagging in Settings to apply this release when downloading.
							{/if}
						</p>
					</SectionBlock>
				</section>

				{#if album.copyright}
					<section id="album-notes" class="ui-section-anchor" data-ui-block="secondary-content">
						<SectionBlock title="Notes" subtitle="Rights and release notes.">
							<p class="ui-detail-note">{album.copyright}</p>
						</SectionBlock>
					</section>
				{/if}
			</div>
		</div>
	</div>
{/if}
