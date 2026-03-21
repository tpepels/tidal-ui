<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { losslessAPI } from '$lib/api';
	import {
		isAlbumDownloadQueueActive,
		type AlbumDownloadStatus
	} from '$lib/controllers/albumDownloadUi';
	import StateNotice from '$lib/components/ui/StateNotice.svelte';
	import { confirm as requestConfirmation } from '$lib/stores/dialogs';
	import type { Album, Track } from '$lib/types';
	import { ArrowLeft } from 'lucide-svelte';
	import {
		machineCurrentTrack,
		machineIsLoading,
		machineIsPlaying,
		machineQueue
	} from '$lib/stores/playerDerived';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { browseState } from '$lib/stores/browseState';
	import { artistCacheStore } from '$lib/stores/artistCache';
	import { navigationHistoryStore } from '$lib/stores/navigationHistory';
	import { fetchAlbumLibraryStatus } from '$lib/utils/mediaLibraryClient';
	import {
		type MusicBrainzReleaseOption,
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
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import AlbumActionsSection from '$lib/screens/album/sections/AlbumActionsSection.svelte';
	import AlbumHeroSection from '$lib/screens/album/sections/AlbumHeroSection.svelte';
	import AlbumMusicBrainzSection from '$lib/screens/album/sections/AlbumMusicBrainzSection.svelte';
	import AlbumNotesSection from '$lib/screens/album/sections/AlbumNotesSection.svelte';
	import AlbumTracksSection from '$lib/screens/album/sections/AlbumTracksSection.svelte';
	import {
		buildAlbumActionSectionViewModel,
		buildAlbumHeroViewModel,
		buildAlbumMusicBrainzSectionViewModel,
		buildAlbumSectionNavItems
	} from '$lib/screens/album/albumViewModel';

	let album = $state<Album | null>(null);
	let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isDownloadingAll = $state(false);
	let downloadedCount = $state(0);
	let downloadError = $state<string | null>(null);
	let queueStatus = $state<AlbumDownloadStatus>('idle');
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

	const albumId = $derived($page.params.id);
	const isAlbumQueue = $derived(
		tracks.length > 0 &&
			$machineQueue.length === tracks.length &&
			$machineQueue.every((t, i) => t?.id === tracks[i]?.id)
	);
	const isAlbumPlaying = $derived(isAlbumQueue && ($machineIsPlaying || $machineIsLoading));
	const albumDownloadMode = $derived($downloadPreferencesStore.mode);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const experimentalMusicBrainzTaggingPreference = $derived(
		$userPreferencesStore.experimentalMusicBrainzTagging
	);
	const strictMusicBrainzMatchingPreference = $derived(
		$userPreferencesStore.strictMusicBrainzMatching
	);
	const downloadStoragePreference = $derived($downloadPreferencesStore.storage);
	const hasActiveQueueDownload = $derived(
		queueStatus === 'submitting' || queueStatus === 'queued' || queueStatus === 'processing'
	);
	const isQueueDownloadCancellable = $derived(isAlbumDownloadQueueActive(queueStatus));
	const selectedMusicBrainzRelease = $derived.by(() =>
		musicBrainzReleaseOptions.find((release) => release.id === selectedMusicBrainzReleaseId) ?? null
	);
	const sectionNavItems = $derived.by(() =>
		buildAlbumSectionNavItems({
			hasNotes: Boolean(album?.copyright)
		})
	);
	const totalDuration = $derived(tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0));
	const expectedTrackCount = $derived.by(() => resolveExpectedTrackCount(album));
	const missingTrackNumbers = $derived.by(() => findMissingTrackNumbers(tracks, expectedTrackCount));
	const hasIncompleteTrackList = $derived.by(
		() =>
			expectedTrackCount !== null &&
			(tracks.length < expectedTrackCount || missingTrackNumbers.length > 0)
	);
	const missingTrackLabel = $derived.by(() => missingTrackNumbers.map((number) => `#${number}`).join(', '));
	const heroSectionViewModel = $derived.by(() =>
		album
			? buildAlbumHeroViewModel({
					album,
					trackCount: tracks.length,
					totalDuration,
					hasIncompleteTrackList,
					expectedTrackCount,
					missingTrackLabel
				})
			: null
	);
	const actionSectionViewModel = $derived.by(() =>
		buildAlbumActionSectionViewModel({
			queueStatus,
			isQueueDownloadCancellable,
			isDownloadingAll,
			downloadedCount,
			trackCount: tracks.length,
			albumInLibrary,
			albumLibraryTrackCount,
			isRepairingAlbum,
			repairMessage,
			downloadError,
			queueCompletedTracks,
			queueTotalTracks,
			downloadStoragePreference,
			isMusicBrainzReleaseLookupLoading,
			selectedMusicBrainzReleaseId,
			hasActiveQueueDownload
		})
	);
	const musicBrainzSectionViewModel = $derived.by(() =>
		buildAlbumMusicBrainzSectionViewModel({
			releases: musicBrainzReleaseOptions,
			selectedReleaseId: selectedMusicBrainzReleaseId,
			selectedRelease: selectedMusicBrainzRelease,
			isLoading: isMusicBrainzReleaseLookupLoading,
			hasAttempted: hasMusicBrainzReleaseLookupAttempted,
			error: musicBrainzReleaseLookupError,
			experimentalMusicBrainzTaggingPreference
		})
	);

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
		if (patch.queueStatus !== undefined) queueStatus = patch.queueStatus;
		if (patch.queueJobId !== undefined) queueJobId = patch.queueJobId;
		if (patch.queueCompletedTracks !== undefined) queueCompletedTracks = patch.queueCompletedTracks;
		if (patch.queueTotalTracks !== undefined) queueTotalTracks = patch.queueTotalTracks;
		if (patch.isDownloadingAll !== undefined) isDownloadingAll = patch.isDownloadingAll;
		if (patch.downloadedCount !== undefined) downloadedCount = patch.downloadedCount;
		if (patch.downloadError !== undefined) downloadError = patch.downloadError;
	}

	function getMaintenanceState(): AlbumRouteMaintenanceState {
		return {
			isRepairingAlbum,
			repairMessage
		};
	}

	function patchMaintenanceState(patch: Partial<AlbumRouteMaintenanceState>): void {
		if (patch.isRepairingAlbum !== undefined) isRepairingAlbum = patch.isRepairingAlbum;
		if (patch.repairMessage !== undefined) repairMessage = patch.repairMessage;
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

	function handleAlbumAction(actionId: string): void {
		switch (actionId) {
			case 'play':
				handleAlbumPlaybackToggle();
				return;
			case 'shuffle':
				handleShufflePlay();
				return;
			case 'download':
				void handleDownloadAll();
				return;
			case 'repair':
				void handleRepairAlbum();
				return;
			default:
		}
	}
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
			<a href="/" class="ui-action-button mt-4 inline-flex">Go Home</a>
		</div>
	</div>
{:else if album}
	<div
		class="ui-page space-y-5 pb-32 pt-4 lg:pb-40"
		data-ui-archetype="detail"
		data-ui-route="album"
		data-ui-block="main-content"
	>
		<button
			onclick={handleBackNavigation}
			class="ui-chip-button ui-chip-button--compact ui-detail-back"
			data-ui-block="back-nav"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		{#if heroSectionViewModel}
			<AlbumHeroSection
				hero={heroSectionViewModel.hero}
				notices={heroSectionViewModel.notices}
			/>
		{/if}

		<PageSectionNav items={sectionNavItems} sticky={true} />

		<div class="ui-detail-columns">
			<div class="ui-detail-main">
				<section id="album-tracks" class="ui-section-anchor" data-ui-block="main-content">
					<AlbumTracksSection {tracks} />
				</section>
			</div>

			<div class="ui-detail-sidebar">
				{#if tracks.length > 0}
					<section id="album-actions" class="ui-section-anchor" data-ui-block="primary-actions">
						<AlbumActionsSection
							albumId={album.id}
							actions={actionSectionViewModel.actions}
							notices={actionSectionViewModel.notices}
							onAction={handleAlbumAction}
						/>
					</section>
				{/if}

				<section id="album-metadata" class="ui-section-anchor" data-ui-block="context-metadata">
					<AlbumMusicBrainzSection
						viewModel={musicBrainzSectionViewModel}
						isLoading={isMusicBrainzReleaseLookupLoading}
						onRefresh={() => {
							void lookupMusicBrainzReleases({ manual: true });
						}}
						onSelectionChange={(value) => {
							selectedMusicBrainzReleaseId = value;
						}}
					/>
				</section>

				{#if album.copyright}
					<section id="album-notes" class="ui-section-anchor" data-ui-block="secondary-content">
						<AlbumNotesSection copyright={album.copyright} />
					</section>
				{/if}
			</div>
		</div>
	</div>
{/if}
