<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import { losslessAPI } from '$lib/api';
	import { downloadAlbum } from '$lib/downloads';
	import {
		createArtistAlbumQueueController,
		createDefaultArtistAlbumDownloadState as createDefaultAlbumDownloadState,
		isArtistAlbumQueueDownloadCancellable as isAlbumQueueDownloadCancellable,
		type ArtistAlbumDownloadState as AlbumDownloadState
	} from '$lib/features/artist/artistAlbumQueueController';
	import {
		buildFeaturedDiscographyAlbums,
		buildTopTrackAlbumSignals,
		filterDiscographyEntries
	} from '$lib/features/artist/artistDiscographyModel';
	import {
		formatMusicBrainzArtistLifeSpan,
		normalizeArtistToken as normalizeToken,
		pickDefaultMusicBrainzArtistId,
		searchMusicBrainzArtistsByName,
		type MusicBrainzArtistOption
	} from '$lib/features/artist/artistMusicBrainzController';
	import type { Album, ArtistDetails, ArtistRecommendations, AudioQuality } from '$lib/types';
	import TopTracksGrid from '$lib/components/TopTracksGrid.svelte';
	import EntityMediaCard from '$lib/components/ui/EntityMediaCard.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import ActionPanel from '$lib/components/ui/ActionPanel.svelte';
	import ToolPanel from '$lib/components/ui/ToolPanel.svelte';
	import DataGrid from '$lib/components/ui/DataGrid.svelte';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import {
		groupDiscography,
		type DiscographyBestEditionRule
	} from '$lib/utils/discography';
	import {
		getCoverCacheKey,
		getResolvedCoverUrl,
		getUnifiedCoverCandidates,
		isCoverInFailureBackoff,
		markCoverFailed,
		markCoverResolved,
		prefetchCoverCandidates,
		subscribeCoverPipelineEvents
	} from '$lib/utils/coverPipeline';
	import { scoreAlbumForSelection } from '$lib/utils/albumSelection';
	import { sortTopTracks } from '$lib/utils/topTracks';
	import { fetchAlbumLibraryStatus } from '$lib/utils/mediaLibraryClient';
	import {
		ArrowLeft,
		ChevronLeft,
		ChevronRight,
		Download,
		LoaderCircle,
		RotateCcw,
		User,
		X
	} from 'lucide-svelte';

	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { artistCacheStore } from '$lib/stores/artistCache';
	import { navigationHistoryStore } from '$lib/stores/navigationHistory';

	let artist = $state<ArtistDetails | null>(null);
	let artistImage = $state<string | null>(null);
	let recommendations = $state<ArtistRecommendations | null>(null);
	let recommendationsLoading = $state(false);
	let recommendationsError = $state<string | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	const artistId = $derived($page.params.id);
	const topTracks = $derived(artist?.tracks ?? []);
	const rawDiscography = $derived.by(() => {
		const albums = artist?.albums ?? [];
		const currentArtistIdRaw = artist?.id;
		const currentArtistName = normalizeToken(artist?.name);
		if (
			typeof currentArtistIdRaw !== 'number' ||
			!Number.isFinite(currentArtistIdRaw) ||
			currentArtistIdRaw <= 0
		) {
			return albums;
		}
		const currentArtistId = currentArtistIdRaw;
		return albums.filter((album) => {
			const primaryArtistIdCandidate = album.artist?.id ?? album.artists?.[0]?.id;
			if (typeof primaryArtistIdCandidate === 'number' && Number.isFinite(primaryArtistIdCandidate)) {
				return primaryArtistIdCandidate === currentArtistId;
			}
			const primaryArtistName = normalizeToken(album.artist?.name ?? album.artists?.[0]?.name);
			if (!primaryArtistName || !currentArtistName) {
				return false;
			}
			return primaryArtistName === currentArtistName;
		});
	});
	const recommendedArtists = $derived(recommendations?.artists ?? []);
	const recommendedAlbums = $derived(recommendations?.albums ?? []);
	const FEATURED_DISCOGRAPHY_ALBUM_LIMIT = 12;
	const discographyInfo = $derived(artist?.discographyInfo ?? null);
	const downloadQuality = $derived($downloadPreferencesStore.downloadQuality as AudioQuality);
	let bestEditionRule = $state<DiscographyBestEditionRule>('balanced');
	let discographyFilterState = $state({
		album: true,
		ep: true,
		single: true,
		live: true,
		remaster: true,
		explicit: true,
		clean: true
	});
	const groupedDiscographyEntries = $derived(
		groupDiscography(rawDiscography, downloadQuality, { bestEditionRule })
	);
	const discographyEntries = $derived(
		filterDiscographyEntries(groupedDiscographyEntries, discographyFilterState)
	);
	const hasGroupedDiscography = $derived(groupedDiscographyEntries.length > 0);
	const filtersHideAllDiscography = $derived(hasGroupedDiscography && discographyEntries.length === 0);
	const discographyEntriesWithLoadedCovers = $derived.by(() => {
		const resolutionTick = coverResolutionTick;
		const currentArtistId = artist?.id ?? 0;
		return discographyEntries.filter((entry) => {
			if (resolutionTick < 0) return false;
			const album = entry.representative;
			if (!album || !Number.isFinite(album.id) || album.id <= 0) return false;
			if (albumCoverFailures[album.id]) return false;
			const hasOfficialTidalSource = album.discographySource === 'official_tidal';
			const coverOverride = albumCoverOverrides[album.id];
			const coverImageCandidates = buildAlbumCoverCandidates(
				album,
				entry.versions,
				hasOfficialTidalSource,
				coverOverride
			);
			if (coverImageCandidates.length === 0) return false;
			const coverCacheKey = getCoverCacheKey({
				coverId: coverOverride || album.cover,
				size: '640',
				proxy: hasOfficialTidalSource,
				overrideKey: `artist:${currentArtistId}:album:${album.id}`
			});
			return Boolean(getResolvedCoverUrl(coverCacheKey));
		});
	});
	const discography = $derived(discographyEntries.map((entry) => entry.representative));
	const visibleDiscography = $derived(discographyEntries.map((entry) => entry.representative));
	const discographyAlbums = $derived(discographyEntries.filter((entry) => entry.section === 'album'));
	const discographyEps = $derived(discographyEntries.filter((entry) => entry.section === 'ep'));
	const discographySingles = $derived(discographyEntries.filter((entry) => entry.section === 'single'));
	const topTrackAlbumSignals = $derived.by(() => buildTopTrackAlbumSignals(topTracks));
	const featuredDiscographyAlbums = $derived.by(() =>
		buildFeaturedDiscographyAlbums(discographyEntries, topTrackAlbumSignals, {
			limit: FEATURED_DISCOGRAPHY_ALBUM_LIMIT
		})
	);
	const discographyMissingCoverCount = $derived(
		Math.max(0, discographyEntries.length - discographyEntriesWithLoadedCovers.length)
	);
	const downloadMode = $derived($downloadPreferencesStore.mode);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const experimentalMusicBrainzTaggingPreference = $derived(
		$userPreferencesStore.experimentalMusicBrainzTagging
	);
	const strictMusicBrainzMatchingPreference = $derived(
		$userPreferencesStore.strictMusicBrainzMatching
	);
	const downloadStoragePreference = $derived($downloadPreferencesStore.storage);

	let isDownloadingDiscography = $state(false);
	let discographyProgress = $state({ completed: 0, total: 0 });
	let discographyError = $state<string | null>(null);
	let albumDownloadStates = $state<Record<number, AlbumDownloadState>>({});
	let albumLibraryPresence = $state<Record<number, { exists: boolean; matchedTracks: number }>>({});
	let albumCoverOverrides = $state<Record<number, string>>({});
	let albumCoverFailures = $state<Record<number, boolean>>({});
	let albumCoverHydrationAttempted = $state<Record<number, boolean>>({});
	type PendingCoverLookup = {
		generation: number;
		promise: Promise<string | null>;
	};
	type CoverHydrationScheduler = {
		generation: number;
		activeLookups: number;
		queue: number[];
		queuedAlbumIds: Set<number>;
	};

	const MAX_CONCURRENT_COVER_LOOKUPS = 4;
	const ALBUM_QUEUE_POLL_INTERVAL_MS = 1000;
	const pendingAlbumCoverLookups = new Map<number, PendingCoverLookup>();
	let coverHydrationGeneration = $state(0);
	let coverHydrationGenerationCounter = 0;
	let coverHydrationScheduler: CoverHydrationScheduler = {
		generation: 0,
		activeLookups: 0,
		queue: [],
		queuedAlbumIds: new Set<number>()
	};
	let activeRequestToken = 0;
	let artistLoadAbortController: AbortController | null = null;
	let activeArtistLoadId: number | null = null;
	let albumLibraryLookupToken = 0;
	let coverResolutionTick = $state(0);
	let isDocumentVisible = $state(true);
	const COVER_CANDIDATE_DELIMITER = '\n';
	const FORCE_OVERWRITE_CONFIRMATION =
		'This album is already in your local library. Redownload it and overwrite existing files?';
	const CLIENT_REDOWNLOAD_CONFIRMATION =
		'This album is already in your local library. Browser downloads cannot overwrite existing files and may append (2) to filenames. Continue anyway?';
	let recommendedArtistsRail = $state<HTMLDivElement | null>(null);
	let recommendedAlbumsRail = $state<HTMLDivElement | null>(null);
	let featuredDiscographyRail = $state<HTMLDivElement | null>(null);
	let musicBrainzArtistOptions = $state<MusicBrainzArtistOption[]>([]);
	let selectedMusicBrainzArtistId = $state<string>('');
	let isMusicBrainzArtistLookupLoading = $state(false);
	let musicBrainzArtistLookupError = $state<string | null>(null);
	let hasMusicBrainzArtistLookupAttempted = $state(false);
	let musicBrainzArtistLookupToken = 0;

	const selectedMusicBrainzArtist = $derived.by(
		() =>
			musicBrainzArtistOptions.find((candidate) => candidate.id === selectedMusicBrainzArtistId) ??
			null
	);

	$effect(() => {
		const id = Number(artistId);
		if (!Number.isFinite(id) || id <= 0) {
			artistLoadAbortController?.abort();
			artistLoadAbortController = null;
			activeArtistLoadId = null;
			activeRequestToken += 1;
			albumQueueController.stopAllPolling();
			beginCoverHydrationGeneration();
			albumDownloadStates = {};
			artist = null;
			artistImage = null;
			recommendations = null;
			recommendationsLoading = false;
			recommendationsError = null;
			musicBrainzArtistLookupToken += 1;
			musicBrainzArtistOptions = [];
			selectedMusicBrainzArtistId = '';
			isMusicBrainzArtistLookupLoading = false;
			musicBrainzArtistLookupError = null;
			hasMusicBrainzArtistLookupAttempted = false;
			error = 'Invalid artist id';
			isLoading = false;
			return;
		}
		if (artistLoadAbortController && activeArtistLoadId === id) {
			return;
		}
		artistLoadAbortController?.abort();
		activeArtistLoadId = id;
		const controller = new AbortController();
		artistLoadAbortController = controller;
		void loadArtist(id, controller);
	});

	onDestroy(() => {
		artistLoadAbortController?.abort();
		artistLoadAbortController = null;
		activeArtistLoadId = null;
		albumQueueController.stopAllPolling();
	});

	onMount(() => {
		const updateDocumentVisibility = () => {
			isDocumentVisible = document.visibilityState !== 'hidden';
		};
		updateDocumentVisibility();
		document.addEventListener('visibilitychange', updateDocumentVisibility);
		const unsubscribeCoverEvents = subscribeCoverPipelineEvents((event) => {
			const currentArtistId = artist?.id;
			if (!Number.isFinite(currentArtistId)) {
				return;
			}
			if (!event.cacheKey.startsWith(`artist:${currentArtistId}:album:`)) {
				return;
			}
			coverResolutionTick += 1;
		});
		return () => {
			document.removeEventListener('visibilitychange', updateDocumentVisibility);
			unsubscribeCoverEvents();
		};
	});

	$effect(() => {
		if (!artist) {
			musicBrainzArtistOptions = [];
			selectedMusicBrainzArtistId = '';
			isMusicBrainzArtistLookupLoading = false;
			musicBrainzArtistLookupError = null;
			hasMusicBrainzArtistLookupAttempted = false;
			return;
		}
		void lookupMusicBrainzArtists({
			id: artist.id,
			name: artist.name
		});
	});

	async function lookupMusicBrainzArtists(
		activeArtist: Pick<ArtistDetails, 'id' | 'name'>
	): Promise<void> {
		const lookupToken = ++musicBrainzArtistLookupToken;
		isMusicBrainzArtistLookupLoading = true;
		musicBrainzArtistLookupError = null;
		hasMusicBrainzArtistLookupAttempted = true;
		try {
			const candidates = await searchMusicBrainzArtistsByName(activeArtist.name, { limit: 10 });
			if (
				lookupToken !== musicBrainzArtistLookupToken ||
				!artist ||
				artist.id !== activeArtist.id
			) {
				return;
			}
			musicBrainzArtistOptions = candidates;
			if (candidates.length === 0) {
				selectedMusicBrainzArtistId = '';
				return;
			}
			const hasExisting = candidates.some(
				(candidate) => candidate.id === selectedMusicBrainzArtistId
			);
			if (hasExisting) {
				return;
			}
			selectedMusicBrainzArtistId = pickDefaultMusicBrainzArtistId(candidates, activeArtist.name);
		} catch (lookupError) {
			musicBrainzArtistLookupError =
				lookupError instanceof Error
					? lookupError.message
					: 'Failed to search MusicBrainz artists';
		} finally {
			if (lookupToken === musicBrainzArtistLookupToken) {
				isMusicBrainzArtistLookupLoading = false;
			}
		}
	}

	function getReleaseYear(date?: string | null): string | null {
		if (!date) return null;
		const timestamp = Date.parse(date);
		if (Number.isNaN(timestamp)) return null;
		return new Date(timestamp).getFullYear().toString();
	}

	function formatAlbumMeta(album: Album): string | null {
		const parts: string[] = [];
		const year = getReleaseYear(album.releaseDate ?? null);
		if (year) parts.push(year);
		if (album.type) parts.push(album.type.replace(/_/g, ' '));
		if (album.numberOfTracks) parts.push(`${album.numberOfTracks} tracks`);
		if (parts.length === 0) return null;
		return parts.join(' • ');
	}

	function formatQualityLabel(quality: AudioQuality): string {
		switch (quality) {
			case 'HI_RES_LOSSLESS':
				return 'Hi-Res';
			case 'LOSSLESS':
				return 'Lossless';
			case 'HIGH':
				return 'High';
			case 'LOW':
				return 'Low';
			default:
				return quality;
		}
	}

	function toggleDiscographyFilter(
		key: 'album' | 'ep' | 'single' | 'live' | 'remaster' | 'explicit' | 'clean'
	): void {
		const nextState = {
			...discographyFilterState,
			[key]: !discographyFilterState[key]
		};
		// Keep at least one content-rating option active to avoid a confusing "everything hidden" state.
		if ((key === 'explicit' || key === 'clean') && !nextState.explicit && !nextState.clean) {
			nextState[key === 'explicit' ? 'clean' : 'explicit'] = true;
		}
		discographyFilterState = nextState;
	}

	function resetDiscographyFilters(): void {
		discographyFilterState = {
			album: true,
			ep: true,
			single: true,
			live: true,
			remaster: true,
			explicit: true,
			clean: true
		};
	}

	function displayTrackTotal(total?: number | null): number {
		if (!Number.isFinite(total)) return 0;
		return total && total > 0 ? total : (total ?? 0);
	}

	function parseNumericId(value: unknown): number | null {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string' && value.trim().length > 0) {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
		return null;
	}

	function normalizeArtistDetails(data: ArtistDetails): ArtistDetails {
		const normalizedAlbumsInput = Array.isArray(data.albums) ? data.albums : [];
		const dedupedAlbums = new Map<number, Album>();
		for (const album of normalizedAlbumsInput) {
			const parsedId = parseNumericId((album as { id?: unknown }).id);
			if (parsedId === null) continue;
			const normalizedAlbum = { ...album, id: parsedId };
			const existing = dedupedAlbums.get(parsedId);
			if (!existing || scoreAlbumForSelection(normalizedAlbum) > scoreAlbumForSelection(existing)) {
				dedupedAlbums.set(parsedId, normalizedAlbum);
			}
		}

		const normalizedTracksInput = Array.isArray(data.tracks) ? data.tracks : [];
		const dedupedTracks = new Map<number, (typeof normalizedTracksInput)[number]>();
		for (const track of normalizedTracksInput) {
			const parsedId = parseNumericId((track as { id?: unknown }).id);
			if (parsedId === null) continue;
			if (!dedupedTracks.has(parsedId)) {
				dedupedTracks.set(parsedId, { ...track, id: parsedId });
			}
		}

		return {
			...data,
			albums: Array.from(dedupedAlbums.values()),
			tracks: sortTopTracks(Array.from(dedupedTracks.values()), 100)
		};
	}

	function buildAlbumCoverCandidates(
		representative: Album,
		versions: Album[],
		useProxy: boolean,
		overrideCoverId?: string
	): string[] {
		const coverIds: string[] = [];
		const seenIds = new Set<string>();
		const normalizedOverride = typeof overrideCoverId === 'string' ? overrideCoverId.trim() : '';
		if (normalizedOverride) {
			seenIds.add(normalizedOverride);
			coverIds.push(normalizedOverride);
		}
		for (const version of [representative, ...versions]) {
			const cover = typeof version.cover === 'string' ? version.cover.trim() : '';
			if (!cover || seenIds.has(cover)) continue;
			seenIds.add(cover);
			coverIds.push(cover);
			if (coverIds.length >= 4) break;
		}

		const urls: string[] = [];
		for (const coverId of coverIds) {
			const cacheKey = getCoverCacheKey({
				coverId,
				size: '640',
				proxy: useProxy
			});
			const resolved = getResolvedCoverUrl(cacheKey);
			if (resolved && !urls.includes(resolved)) {
				urls.push(resolved);
			}
			if (isCoverInFailureBackoff(cacheKey) && !resolved) {
				continue;
			}
			const candidates = getUnifiedCoverCandidates({
				coverId,
				size: '640',
				proxy: useProxy,
				includeLowerSizes: true
			});
			for (const candidate of candidates) {
				if (candidate && !urls.includes(candidate)) {
					urls.push(candidate);
				}
			}
		}
		return urls;
	}

	function serializeCoverCandidates(candidates: string[]): string {
		return candidates.join(COVER_CANDIDATE_DELIMITER);
	}

	function parseCoverCandidates(rawCandidates: string): string[] {
		return rawCandidates
			.split(COVER_CANDIDATE_DELIMITER)
			.map((candidate) => candidate.trim())
			.filter((candidate) => candidate.length > 0);
	}

	function markAlbumCoverFailed(albumId: number): void {
		albumCoverFailures = {
			...albumCoverFailures,
			[albumId]: true
		};
	}

	function clearAlbumCoverFailure(albumId: number): void {
		if (!albumCoverFailures[albumId]) {
			return;
		}
		const next = { ...albumCoverFailures };
		delete next[albumId];
		albumCoverFailures = next;
	}

	function createCoverHydrationScheduler(generation: number): CoverHydrationScheduler {
		return {
			generation,
			activeLookups: 0,
			queue: [],
			queuedAlbumIds: new Set<number>()
		};
	}

	function beginCoverHydrationGeneration(): number {
		coverHydrationGenerationCounter += 1;
		coverHydrationGeneration = coverHydrationGenerationCounter;
		coverHydrationScheduler = createCoverHydrationScheduler(coverHydrationGenerationCounter);
		pendingAlbumCoverLookups.clear();
		return coverHydrationGenerationCounter;
	}

	function drainAlbumCoverHydrationQueue(scheduler: CoverHydrationScheduler): void {
		if (
			scheduler !== coverHydrationScheduler ||
			scheduler.generation !== coverHydrationGeneration
		) {
			return;
		}

		while (
			scheduler.activeLookups < MAX_CONCURRENT_COVER_LOOKUPS &&
			scheduler.queue.length > 0
		) {
			const albumId = scheduler.queue.shift();
			if (albumId === undefined || !Number.isFinite(albumId)) {
				continue;
			}
			scheduler.activeLookups += 1;
			void resolveAlbumCoverFromApi(albumId, scheduler.generation)
				.catch(() => null)
				.finally(() => {
					scheduler.activeLookups = Math.max(0, scheduler.activeLookups - 1);
					scheduler.queuedAlbumIds.delete(albumId);
					drainAlbumCoverHydrationQueue(scheduler);
				});
		}
	}

	function enqueueAlbumCoverHydration(albumId: number, generation: number): void {
		if (!Number.isFinite(albumId) || albumId <= 0 || generation !== coverHydrationGeneration) {
			return;
		}

		const scheduler = coverHydrationScheduler;
		if (scheduler.generation !== generation) {
			return;
		}

		if (scheduler.queuedAlbumIds.has(albumId)) {
			return;
		}

		scheduler.queuedAlbumIds.add(albumId);
		scheduler.queue.push(albumId);
		drainAlbumCoverHydrationQueue(scheduler);
	}

	async function resolveAlbumCoverFromApi(
		albumId: number,
		generation: number
	): Promise<string | null> {
		if (!Number.isFinite(albumId) || albumId <= 0 || generation !== coverHydrationGeneration) {
			return null;
		}

		const existingOverride = albumCoverOverrides[albumId];
		if (existingOverride) {
			return existingOverride;
		}

		const pending = pendingAlbumCoverLookups.get(albumId);
		if (pending && pending.generation === generation) {
			return pending.promise;
		}
		if (pending && pending.generation !== generation) {
			pendingAlbumCoverLookups.delete(albumId);
		}

		const lookupPromise = (async () => {
			try {
				const { album: albumData } = await losslessAPI.getAlbum(albumId);
				const cover = typeof albumData.cover === 'string' ? albumData.cover.trim() : '';
				if (!cover || generation !== coverHydrationGeneration) {
					return null;
				}

				albumCoverOverrides = {
					...albumCoverOverrides,
					[albumId]: cover
				};
				clearAlbumCoverFailure(albumId);

				const artistForCache = albumData.artist?.id ?? artist?.id;
				if (typeof artistForCache === 'number' && Number.isFinite(artistForCache)) {
					artistCacheStore.upsertAlbumCover(artistForCache, albumId, cover);
				}
				artistCacheStore.upsertAlbumCoverGlobally(albumId, cover);

				return cover;
			} catch (lookupError) {
				if (generation === coverHydrationGeneration) {
					console.warn(`[Artist] Failed to hydrate cover for album ${albumId}:`, lookupError);
				}
				return null;
			} finally {
				const current = pendingAlbumCoverLookups.get(albumId);
				if (current && current.generation === generation) {
					pendingAlbumCoverLookups.delete(albumId);
				}
			}
		})();

		pendingAlbumCoverLookups.set(albumId, {
			generation,
			promise: lookupPromise
		});
		return lookupPromise;
	}

	async function attemptAlbumCoverRecovery(
		image: HTMLImageElement,
		currentCandidates: string[],
		generation: number
	): Promise<void> {
		if (!image.isConnected || generation !== coverHydrationGeneration) {
			return;
		}

		const albumId = Number.parseInt(image.dataset.albumId ?? '', 10);
		if (!Number.isFinite(albumId) || albumId <= 0) {
			return;
		}

		const hydratedCover = await resolveAlbumCoverFromApi(albumId, generation);
		if (!image.isConnected || generation !== coverHydrationGeneration) {
			return;
		}

		if (!hydratedCover) {
			markAlbumCoverFailed(albumId);
			return;
		}

		const useProxy = image.dataset.coverUseProxy === '1';
		const hydratedCandidates = getUnifiedCoverCandidates({
			coverId: hydratedCover,
			size: '640',
			proxy: useProxy,
			includeLowerSizes: true
		});

		const merged = [...currentCandidates];
		for (const candidate of hydratedCandidates) {
			if (candidate && !merged.includes(candidate)) {
				merged.push(candidate);
			}
		}
		if (merged.length <= currentCandidates.length) {
			markAlbumCoverFailed(albumId);
			return;
		}

		const nextIndex = currentCandidates.length;
		image.dataset.coverCandidates = serializeCoverCandidates(merged);
		image.dataset.coverIndex = String(nextIndex);
		image.dataset.coverGeneration = String(generation);
		image.src = merged[nextIndex]!;
	}

	function handleAlbumCoverLoad(event: Event): void {
		if (!(event.currentTarget instanceof HTMLImageElement)) {
			return;
		}
		const image = event.currentTarget;
		const imageGeneration = Number.parseInt(image.dataset.coverGeneration ?? '', 10);
		if (Number.isFinite(imageGeneration) && imageGeneration !== coverHydrationGeneration) {
			return;
		}
		const albumId = Number.parseInt(image.dataset.albumId ?? '', 10);
		if (Number.isFinite(albumId)) {
			clearAlbumCoverFailure(albumId);
		}
		const coverCacheKey = image.dataset.coverCacheKey ?? '';
		if (coverCacheKey && image.currentSrc) {
			markCoverResolved(coverCacheKey, image.currentSrc);
		}
	}

	function handleAlbumCoverError(event: Event): void {
		if (!(event.currentTarget instanceof HTMLImageElement)) {
			return;
		}
		const image = event.currentTarget;
		const imageGeneration = Number.parseInt(image.dataset.coverGeneration ?? '', 10);
		if (Number.isFinite(imageGeneration) && imageGeneration !== coverHydrationGeneration) {
			return;
		}
		const albumId = Number.parseInt(image.dataset.albumId ?? '', 10);
		const rawCandidates = image.dataset.coverCandidates ?? '';
		if (!rawCandidates) return;

		const candidates = parseCoverCandidates(rawCandidates);
		if (candidates.length === 0) return;

		const currentIndex = Number.parseInt(image.dataset.coverIndex ?? '0', 10);
		const safeIndex = Number.isFinite(currentIndex) && currentIndex >= 0 ? currentIndex : 0;
		const nextIndex = safeIndex + 1;
		if (nextIndex >= candidates.length) {
			if (image.dataset.coverRecoveryTried !== '1') {
				image.dataset.coverRecoveryTried = '1';
				void attemptAlbumCoverRecovery(image, candidates, coverHydrationGeneration);
				return;
			}
			if (Number.isFinite(albumId)) {
				markAlbumCoverFailed(albumId);
			}
			const coverCacheKey = image.dataset.coverCacheKey ?? '';
			if (coverCacheKey) {
				markCoverFailed(coverCacheKey);
			}
			return;
		}

		image.dataset.coverIndex = String(nextIndex);
		image.src = candidates[nextIndex]!;
	}

	$effect(() => {
		if (!artist || !isDocumentVisible) return;
		const generation = coverHydrationGeneration;
		for (const entry of discographyEntries) {
			const album = entry.representative;
			if (!album || !Number.isFinite(album.id)) continue;
			if (albumCoverOverrides[album.id] || albumCoverHydrationAttempted[album.id]) {
				continue;
			}
			const hasAnyCover = entry.versions.some(
				(version) => typeof version.cover === 'string' && version.cover.trim().length > 0
			);
			if (hasAnyCover) {
				continue;
			}
			albumCoverHydrationAttempted = {
				...albumCoverHydrationAttempted,
				[album.id]: true
			};
			enqueueAlbumCoverHydration(album.id, generation);
		}
	});

	$effect(() => {
		if (!artist || !isDocumentVisible || discographyEntries.length === 0) {
			return;
		}
		const artistIdForKey = artist.id;
		const batch = discographyEntries
			.map((entry) => {
				const representative = entry.representative;
				const override = albumCoverOverrides[representative.id];
				const useProxy = representative.discographySource === 'official_tidal';
				const candidates = buildAlbumCoverCandidates(
					representative,
					entry.versions,
					useProxy,
					override
				);
				if (candidates.length === 0) return null;
				return {
					cacheKey: getCoverCacheKey({
						coverId: override || representative.cover,
						size: '640',
						proxy: useProxy,
						overrideKey: `artist:${artistIdForKey}:album:${representative.id}`
					}),
					candidates
				};
			})
			.filter((entry): entry is { cacheKey: string; candidates: string[] } => entry !== null);
		if (batch.length === 0) return;
		void prefetchCoverCandidates(batch)
			.then(() => {
				coverResolutionTick += 1;
			})
			.catch(() => {
				// failures are tracked in cover pipeline caches
			});
	});

	$effect(() => {
		if (!artist || recommendedAlbums.length === 0) {
			return;
		}
		const artistIdForKey = artist.id;
		const batch = recommendedAlbums
			.slice(0, 24)
			.map((album) => {
				const coverId = typeof album.cover === 'string' ? album.cover.trim() : '';
				if (!coverId) return null;
				const cacheKey = getCoverCacheKey({
					coverId,
					size: '640',
					proxy: true,
					overrideKey: `artist:${artistIdForKey}:recommendation:${album.id}`
				});
				const candidates = getUnifiedCoverCandidates({
					coverId,
					size: '640',
					proxy: true,
					includeLowerSizes: true
				});
				if (candidates.length === 0) return null;
				return { cacheKey, candidates };
			})
			.filter((entry): entry is { cacheKey: string; candidates: string[] } => entry !== null);
		if (batch.length === 0) return;
		void prefetchCoverCandidates(batch).catch(() => {
			// failures are tracked in cover pipeline caches
		});
	});

	$effect(() => {
		if (!artist || discographyEntries.length === 0) {
			albumLibraryPresence = {};
			return;
		}
		const artistNameForLookup = artist.name;
		const lookupToken = ++albumLibraryLookupToken;
		const payload = discographyEntries.map((entry) => {
			const representative = entry.representative;
			return {
				id: representative.id,
				artistName: representative.artist?.name ?? artistNameForLookup,
				albumTitle: representative.title,
				expectedTrackCount:
					typeof representative.numberOfTracks === 'number' ? representative.numberOfTracks : undefined
			};
		});
		void fetchAlbumLibraryStatus(payload)
			.then((result) => {
				if (lookupToken !== albumLibraryLookupToken) {
					return;
				}
				albumLibraryPresence = result;
			})
			.catch(() => {
				if (lookupToken !== albumLibraryLookupToken) {
					return;
				}
				albumLibraryPresence = {};
			});
	});

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

	const albumQueueController = createArtistAlbumQueueController({
		getState: getAlbumDownloadState,
		patchState: patchAlbumDownloadState,
		pollIntervalMs: ALBUM_QUEUE_POLL_INTERVAL_MS
	});

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

	async function handleAlbumDownload(album: Album, event?: MouseEvent) {
		event?.preventDefault();
		event?.stopPropagation();

		const currentState = getAlbumDownloadState(album.id);
		if (isDownloadingDiscography) {
			return;
		}

		if (isAlbumQueueDownloadCancellable(currentState)) {
			await cancelAlbumQueueDownload(album.id);
			return;
		}
		if (currentState.status === 'paused') {
			await resumeAlbumQueueDownload(album.id);
			return;
		}
		const inLibrary = albumLibraryPresence[album.id]?.exists === true;
		let forceOverwrite = false;
		if (inLibrary && currentState.status === 'idle') {
			if (downloadStoragePreference === 'server') {
				forceOverwrite = window.confirm(FORCE_OVERWRITE_CONFIRMATION);
				if (!forceOverwrite) {
					return;
				}
			} else if (!window.confirm(CLIENT_REDOWNLOAD_CONFIRMATION)) {
				return;
			}
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
			failedTracks: 0,
			queueJobId: null
		});

		const quality = downloadQuality;

		try {
			let failedCount = 0;
			const result = await downloadAlbum(
				album,
				quality,
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
					},
					onTrackFailed: (track, error, attempt) => {
						if (attempt >= 3) {
							failedCount++;
							patchAlbumDownloadState(album.id, { failedTracks: failedCount });
						}
					}
				},
				artist?.name,
				{
					mode: downloadMode,
					convertAacToMp3: convertAacToMp3Preference,
					experimentalMusicBrainzTagging: experimentalMusicBrainzTaggingPreference,
					strictMusicBrainzMatching: strictMusicBrainzMatchingPreference,
					storage: downloadStoragePreference,
					forceOverwrite
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

			const finalState = albumDownloadStates[album.id];
			patchAlbumDownloadState(album.id, {
				status: failedCount > 0 ? 'failed' : 'completed',
				downloading: false,
				completed: finalState?.total ?? result.completedTracks ?? finalState?.completed ?? 0,
				error:
					failedCount > 0
						? `${failedCount} track${failedCount > 1 ? 's' : ''} failed after 3 attempts`
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

	async function handleDownloadDiscography() {
		if (!artist || discography.length === 0 || isDownloadingDiscography) {
			return;
		}

		isDownloadingDiscography = true;
		discographyError = null;

		let estimatedTotal = discography.reduce((sum, album) => sum + (album.numberOfTracks ?? 0), 0);
		if (!Number.isFinite(estimatedTotal) || estimatedTotal < 0) {
			estimatedTotal = 0;
		}

		let completed = 0;
		let total = estimatedTotal;
		discographyProgress = { completed, total };
		const quality = downloadQuality;

		for (const album of discography) {
			let albumEstimate = album.numberOfTracks ?? 0;
			let albumFailedCount = 0;
			try {
				await downloadAlbum(
					album,
					quality,
					{
						onTotalResolved: (resolvedTotal) => {
							if (resolvedTotal !== albumEstimate) {
								total += resolvedTotal - albumEstimate;
								albumEstimate = resolvedTotal;
								discographyProgress = { completed, total };
							} else if (total === 0 && resolvedTotal > 0) {
								total += resolvedTotal;
								discographyProgress = { completed, total };
							}
						},
						onTrackDownloaded: () => {
							completed += 1;
							discographyProgress = { completed, total };
						},
						onTrackFailed: (track, error, attempt) => {
							if (attempt >= 3) {
								albumFailedCount++;
							}
						}
					},
					artist?.name,
					{
						mode: downloadMode,
						convertAacToMp3: convertAacToMp3Preference,
						experimentalMusicBrainzTagging: experimentalMusicBrainzTaggingPreference,
						strictMusicBrainzMatching: strictMusicBrainzMatchingPreference,
						storage: downloadStoragePreference
					}
				);
				if (albumFailedCount > 0) {
					console.warn(
						`[Discography] ${albumFailedCount} track(s) failed in album: ${album.title}`
					);
				}
			} catch (err) {
				console.error('Failed to download discography album:', err);
				const message =
					err instanceof Error && err.message
						? err.message
						: 'Failed to download part of the discography.';
				discographyError = message;
				break;
			}
		}

		isDownloadingDiscography = false;
	}

	async function loadArtistRecommendations(
		id: number,
		requestToken: number,
		controller: AbortController
	): Promise<void> {
		recommendationsLoading = true;
		recommendationsError = null;
		try {
			const recommendationPayload = await losslessAPI.getArtistRecommendations(id, {
				signal: controller.signal
			});
			if (requestToken !== activeRequestToken) {
				return;
			}
			recommendations = recommendationPayload;
		} catch (recommendationError) {
			if (requestToken !== activeRequestToken) {
				return;
			}
			if (
				recommendationError instanceof Error &&
				recommendationError.name === 'AbortError'
			) {
				return;
			}
			recommendations = null;
			recommendationsError =
				recommendationError instanceof Error && recommendationError.message
					? recommendationError.message
					: 'Failed to load recommendations.';
			console.warn(`[Artist] Failed to load recommendations for ${id}:`, recommendationError);
		} finally {
			if (requestToken === activeRequestToken) {
				recommendationsLoading = false;
			}
		}
	}

	async function loadArtist(id: number, controller: AbortController) {
		const requestToken = ++activeRequestToken;
		beginCoverHydrationGeneration();
		albumQueueController.stopAllPolling();
		const cachedArtist = artistCacheStore.get(id);
		const hasCachedArtist = Boolean(cachedArtist);

		error = null;
		isDownloadingDiscography = false;
		discographyProgress = { completed: 0, total: 0 };
		discographyError = null;
		albumDownloadStates = {};
		albumLibraryPresence = {};
		albumCoverOverrides = {};
		albumCoverFailures = {};
		albumCoverHydrationAttempted = {};
		recommendations = null;
		recommendationsLoading = false;
		recommendationsError = null;
		musicBrainzArtistLookupToken += 1;
		musicBrainzArtistOptions = [];
		selectedMusicBrainzArtistId = '';
		isMusicBrainzArtistLookupLoading = false;
		musicBrainzArtistLookupError = null;
		hasMusicBrainzArtistLookupAttempted = false;

		if (cachedArtist) {
			const normalizedCached = normalizeArtistDetails(cachedArtist);
			artistCacheStore.set(normalizedCached);
			artist = normalizedCached;
			artistImage = normalizedCached.picture
				? losslessAPI.getArtistPictureUrl(normalizedCached.picture)
				: null;
			isLoading = false;
			breadcrumbStore.setParent(`/artist/${normalizedCached.id}`, '/');
			breadcrumbStore.setCurrentLabel(normalizedCached.name, `/artist/${normalizedCached.id}`);
			navigationHistoryStore.visitArtist({
				id: normalizedCached.id,
				name: normalizedCached.name,
				picture: normalizedCached.picture
			});
		}

		try {
			if (!hasCachedArtist) {
				isLoading = true;
				artist = null;
				artistImage = null;
			}
			const data = await losslessAPI.getArtist(id, {
				signal: controller.signal
			});
			const normalizedData = normalizeArtistDetails(data);
			if (requestToken !== activeRequestToken) {
				return;
			}
			artist = normalizedData;
			artistCacheStore.set(normalizedData);

			breadcrumbStore.setParent(`/artist/${normalizedData.id}`, '/');
			breadcrumbStore.setCurrentLabel(normalizedData.name, `/artist/${normalizedData.id}`);
			navigationHistoryStore.visitArtist({
				id: normalizedData.id,
				name: normalizedData.name,
				picture: normalizedData.picture
			});

			// Get artist picture
			if (artist.picture) {
				artistImage = losslessAPI.getArtistPictureUrl(artist.picture);
			}
			void loadArtistRecommendations(normalizedData.id, requestToken, controller);
		} catch (err) {
			if (requestToken === activeRequestToken) {
				if (err instanceof Error && err.name === 'AbortError') {
					return;
				}
				error = err instanceof Error ? err.message : 'Failed to load artist';
				console.error('Failed to load artist:', err);
			}
		} finally {
			if (requestToken === activeRequestToken) {
				isLoading = false;
			}
			if (artistLoadAbortController === controller) {
				artistLoadAbortController = null;
			}
		}
	}

	function handleBackNavigation() {
		const target = breadcrumbStore.goBack($page.url.pathname, '/');
		void goto(target);
	}

	function scrollRecommendationRail(
		rail: HTMLDivElement | null,
		direction: 'left' | 'right'
	): void {
		if (!rail) {
			return;
		}
		const sampleCard = rail.querySelector<HTMLElement>('[data-recommendation-card="true"]');
		const step = sampleCard
			? sampleCard.getBoundingClientRect().width + 14
			: Math.max(rail.clientWidth * 0.85, 260);
		rail.scrollBy({
			left: direction === 'left' ? -step : step,
			behavior: 'smooth'
		});
	}
</script>

<svelte:head>
	<title>{artist?.name || 'Artist'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="ui-page flex w-full flex-col gap-4 py-16" data-ui-archetype="detail" data-ui-route="artist">
		<div class="ui-surface-card p-6">
			<div class="mb-3 text-sm font-semibold text-gray-300">Loading artist data</div>
			<div
				class="flex items-center gap-3 text-sm text-gray-400"
				data-testid="artist-loading-spinner"
				role="status"
			>
				<LoaderCircle size={18} class="animate-spin text-white/80" />
				<span>Fetching artist details…</span>
			</div>
		</div>
	</div>
{:else if error}
	<div class="ui-page py-12" data-ui-archetype="detail" data-ui-route="artist">
		<div class="ui-surface-card border-red-500/40 bg-red-950/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-200">Error Loading Artist</h2>
			<p class="text-red-100/85">{error}</p>
			<a
				href="/"
				class="ui-action-button mt-4 inline-flex"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if artist}
	<div
		class="ui-page space-y-6 pb-32 pt-4 lg:pb-40"
		data-ui-archetype="detail"
		data-ui-route="artist"
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



		<!-- Artist Header -->
		<div class="flex flex-col items-start gap-8 md:flex-row md:items-end" data-ui-block="entity-hero">
			<!-- Artist Picture -->
			<div
				class="aspect-square w-full flex-shrink-0 overflow-hidden rounded-full border border-white/12 bg-white/5 md:w-80"
			>
				{#if artistImage}
					<img src={artistImage} alt={artist.name} class="h-full w-full object-cover" />
				{:else}
					<div class="flex h-full w-full items-center justify-center">
						<User size={120} class="text-gray-600" />
					</div>
				{/if}
			</div>

			<!-- Artist Info -->
			<div class="flex-1">
				<p class="mb-2 text-sm text-gray-400">ARTIST</p>
				<h1 class="mb-4 text-4xl font-bold md:text-6xl">{artist.name}</h1>

				<div class="mb-6" data-ui-block="primary-actions">
					<ActionPanel
						intent="Artist Actions"
						summary="Share this artist or open the official profile."
						intentful={true}
						panelRole="artist-actions"
					>
						<div class="ui-action-row ui-action-row--progressive">
							<ShareButton type="artist" id={artist.id} variant="secondary" />
							{#if artist.url}
								<a
									href={artist.url}
									target="_blank"
									rel="noopener noreferrer"
									class="ui-action-button"
								>
									Open Artist Profile
								</a>
							{/if}
						</div>
					</ActionPanel>
				</div>

				<div class="mb-6" data-ui-block="context-metadata">
					<ActionPanel panelRole="musicbrainz-artist">
						<svelte:fragment slot="header">
							<div class="ui-action-subpanel__header">
								<p class="ui-action-panel__intent">MusicBrainz Artist Metadata</p>
								<button
									type="button"
									onclick={() =>
										lookupMusicBrainzArtists({
											id: artist!.id,
											name: artist!.name
										})}
									class="ui-chip-button ui-chip-button--compact"
									disabled={isMusicBrainzArtistLookupLoading}
								>
									{#if isMusicBrainzArtistLookupLoading}
										Refreshing…
									{:else}
										Refresh Match
									{/if}
								</button>
							</div>
						</svelte:fragment>
					{#if isMusicBrainzArtistLookupLoading && musicBrainzArtistOptions.length === 0}
						<p class="ui-action-status">Searching MusicBrainz artists…</p>
					{:else if musicBrainzArtistOptions.length > 0}
						<label class="ui-action-panel__intent" for="musicbrainz-artist-select">
							Selected Artist
						</label>
						<select
							id="musicbrainz-artist-select"
							class="ui-select w-full"
							bind:value={selectedMusicBrainzArtistId}
						>
							{#each musicBrainzArtistOptions as candidate, index (candidate.id)}
								<option value={candidate.id}>
									{index === 0 ? 'Best Match - ' : ''}{candidate.name || 'Unnamed artist'}
									{#if candidate.country}
										· {candidate.country}
									{/if}
									{#if candidate.type}
										· {candidate.type}
									{/if}
								</option>
							{/each}
						</select>
						{#if selectedMusicBrainzArtist}
							<DataGrid gridRole="artist-musicbrainz-facts">
								{#if selectedMusicBrainzArtist.type}
									<div class="ui-data-point">
										<p class="ui-data-point__label">Type</p>
										<p class="ui-data-point__value">{selectedMusicBrainzArtist.type}</p>
									</div>
								{/if}
								{#if selectedMusicBrainzArtist.country}
									<div class="ui-data-point">
										<p class="ui-data-point__label">Country</p>
										<p class="ui-data-point__value">{selectedMusicBrainzArtist.country}</p>
									</div>
								{/if}
								{#if selectedMusicBrainzArtist.area}
									<div class="ui-data-point">
										<p class="ui-data-point__label">Area</p>
										<p class="ui-data-point__value">{selectedMusicBrainzArtist.area}</p>
									</div>
								{/if}
								{#if formatMusicBrainzArtistLifeSpan(selectedMusicBrainzArtist)}
									<div class="ui-data-point">
										<p class="ui-data-point__label">Life Span</p>
										<p class="ui-data-point__value">
											{formatMusicBrainzArtistLifeSpan(selectedMusicBrainzArtist)}
										</p>
									</div>
								{/if}
								{#if typeof selectedMusicBrainzArtist.score === 'number'}
									<div class="ui-data-point">
										<p class="ui-data-point__label">Match Score</p>
										<p class="ui-data-point__value">{selectedMusicBrainzArtist.score}/100</p>
									</div>
								{/if}
							</DataGrid>
							{#if selectedMusicBrainzArtist.disambiguation}
								<p class="ui-action-status">{selectedMusicBrainzArtist.disambiguation}</p>
							{/if}
							<p class="ui-action-status">
								<a
									href={`https://musicbrainz.org/artist/${selectedMusicBrainzArtist.id}`}
									target="_blank"
									rel="noopener noreferrer"
									class="text-gray-300 underline decoration-dotted underline-offset-2 transition-colors hover:text-white"
								>
									Open artist in MusicBrainz
								</a>
							</p>
						{/if}
					{:else if hasMusicBrainzArtistLookupAttempted}
						<p class="ui-action-status">No MusicBrainz artist match found for this artist.</p>
					{/if}
					{#if musicBrainzArtistLookupError}
						<p class="ui-action-status" data-tone="error">{musicBrainzArtistLookupError}</p>
					{/if}
					</ActionPanel>
				</div>

				<div class="mb-6 flex flex-wrap items-center gap-2">
					{#if artist.popularity}
						<div class="ui-meta-pill">
							Popularity: <span class="font-semibold text-white">{artist.popularity}</span>
						</div>
					{/if}
					{#if artist.artistTypes && artist.artistTypes.length > 0}
						{#each artist.artistTypes as type (type)}
							<div class="ui-meta-pill">
								{type}
							</div>
						{/each}
					{/if}
				</div>

				{#if artist.artistRoles && artist.artistRoles.length > 0}
					<div class="mb-4">
						<h3 class="mb-2 text-sm font-semibold text-gray-400">Roles</h3>
						<div class="flex flex-wrap gap-2">
							{#each artist.artistRoles as role (role.category)}
								<div class="ui-meta-pill">
									{role.category}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Music Overview -->
		<div class="space-y-12">
			<section data-ui-block="main-content">
				<div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 class="text-2xl font-semibold text-white">Top Tracks</h2>
						<p class="text-sm text-gray-400">Best songs from {artist.name}.</p>
					</div>
				</div>
				{#if topTracks.length > 0}
					<div class="ui-surface-card mt-6 overflow-hidden p-4">
						<TopTracksGrid tracks={topTracks} />
					</div>
				{:else}
					<div
						class="ui-surface-card mt-6 p-6 text-sm text-gray-400"
					>
						<p>No top tracks available for this artist yet.</p>
					</div>
				{/if}
			</section>

			<section data-ui-block="secondary-content">
				<ToolPanel
					eyebrow="Secondary"
					title="Discovery Suggestions"
					subtitle={`Related artists and albums based on ${artist.name}.`}
					panelRole="artist-discovery"
				>
					{#if recommendations?.source === 'artist-mix' && recommendations.mixTitle}
						<p class="ui-action-status">
							Source: {recommendations.mixTitle}
							{#if recommendations.mixSubtitle}
								• {recommendations.mixSubtitle}
							{/if}
						</p>
					{/if}
					{#if recommendationsLoading}
						<StateBlock
							kind="loading"
							title="Loading recommendations"
							message="Fetching related artists and albums."
							embedded={true}
						/>
					{:else if recommendationsError}
						<StateBlock
							kind="error"
							title="Recommendations unavailable"
							message={recommendationsError}
							embedded={true}
						/>
					{:else if recommendedArtists.length > 0 || recommendedAlbums.length > 0}
						<div class="artist-rail-stack">
							{#if recommendedArtists.length > 0}
								<div class="artist-rail-group">
									<div class="artist-rail-group__header">
										<div class="artist-rail-group__title-row">
											<h3 class="artist-rail-group__title">Recommended Artists</h3>
											<span class="recommendation-count-pill">{recommendedArtists.length}</span>
										</div>
										<div class="recommendation-slider__controls">
											<button
												type="button"
												class="recommendation-slider__control"
												onclick={() => scrollRecommendationRail(recommendedArtistsRail, 'left')}
												aria-label="Scroll recommended artists left"
											>
												<ChevronLeft size={16} />
											</button>
											<button
												type="button"
												class="recommendation-slider__control"
												onclick={() => scrollRecommendationRail(recommendedArtistsRail, 'right')}
												aria-label="Scroll recommended artists right"
											>
												<ChevronRight size={16} />
											</button>
										</div>
									</div>
									<div
										class="recommendation-slider"
										role="region"
										aria-label="Recommended artists"
										bind:this={recommendedArtistsRail}
									>
										{#each recommendedArtists as recommendationArtist (recommendationArtist.id)}
											<EntityMediaCard
												type="artist"
												href={`/artist/${recommendationArtist.id}`}
												title={recommendationArtist.name}
												subtitle={recommendationArtist.type || 'Artist'}
												class="recommendation-slider__item"
												data-recommendation-card="true"
											>
												{#snippet artwork()}
													{#if recommendationArtist.picture}
														<img
															src={losslessAPI.getArtistPictureUrl(recommendationArtist.picture)}
															alt={recommendationArtist.name}
															loading="lazy"
														/>
													{:else}
														<div class="flex h-full w-full items-center justify-center text-gray-500">
															<User size={34} />
														</div>
													{/if}
												{/snippet}
											</EntityMediaCard>
										{/each}
									</div>
								</div>
							{/if}
							{#if recommendedAlbums.length > 0}
								<div class="artist-rail-group">
									<div class="artist-rail-group__header">
										<div class="artist-rail-group__title-row">
											<h3 class="artist-rail-group__title">Recommended Albums</h3>
											<span class="recommendation-count-pill">{recommendedAlbums.length}</span>
										</div>
										<div class="recommendation-slider__controls">
											<button
												type="button"
												class="recommendation-slider__control"
												onclick={() => scrollRecommendationRail(recommendedAlbumsRail, 'left')}
												aria-label="Scroll recommended albums left"
											>
												<ChevronLeft size={16} />
											</button>
											<button
												type="button"
												class="recommendation-slider__control"
												onclick={() => scrollRecommendationRail(recommendedAlbumsRail, 'right')}
												aria-label="Scroll recommended albums right"
											>
												<ChevronRight size={16} />
											</button>
										</div>
									</div>
									<div
										class="recommendation-slider"
										role="region"
										aria-label="Recommended albums"
										bind:this={recommendedAlbumsRail}
									>
										{#each recommendedAlbums as recommendationAlbum (recommendationAlbum.id)}
											{@const recommendationCoverCacheKey = getCoverCacheKey({
												coverId: recommendationAlbum.cover,
												size: '640',
												proxy: true,
												overrideKey: `artist:${artist.id}:recommendation:${recommendationAlbum.id}`
											})}
											{@const recommendationCoverCandidates = getUnifiedCoverCandidates({
												coverId: recommendationAlbum.cover,
												size: '640',
												proxy: true,
												includeLowerSizes: true
											})}
											<EntityMediaCard
												type="album"
												href={`/album/${recommendationAlbum.id}`}
												title={recommendationAlbum.title}
												subtitle={recommendationAlbum.artist?.name}
												meta={formatAlbumMeta(recommendationAlbum)}
												coverCacheKey={recommendationAlbum.cover ? recommendationCoverCacheKey : null}
												coverCandidates={recommendationAlbum.cover ? recommendationCoverCandidates : []}
												class="recommendation-slider__item"
												data-recommendation-card="true"
											/>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{:else}
						<StateBlock
							kind="empty"
							title="No recommendations yet"
							message="No related artists or albums are available right now."
							embedded={true}
						/>
					{/if}
				</ToolPanel>
			</section>

			{#if featuredDiscographyAlbums.length > 0}
				<section data-ui-block="secondary-content">
					<ToolPanel
						eyebrow="Secondary"
						title="Discography Highlights"
						subtitle={`Best-known releases from ${artist.name}, separated from the full catalog below.`}
						panelRole="artist-discography-highlights"
					>
						<div class="artist-rail-group">
							<div class="artist-rail-group__header">
								<h3 class="artist-rail-group__title">Featured Releases</h3>
								<div class="recommendation-slider__controls">
									<button
										type="button"
										class="recommendation-slider__control"
										onclick={() => scrollRecommendationRail(featuredDiscographyRail, 'left')}
										aria-label="Scroll recommended discography albums left"
									>
										<ChevronLeft size={16} />
									</button>
									<button
										type="button"
										class="recommendation-slider__control"
										onclick={() => scrollRecommendationRail(featuredDiscographyRail, 'right')}
										aria-label="Scroll recommended discography albums right"
									>
										<ChevronRight size={16} />
									</button>
								</div>
							</div>
							<div
								class="recommendation-slider discography-featured__slider"
								role="region"
								aria-label="Recommended albums from this artist discography"
								bind:this={featuredDiscographyRail}
							>
								{#each featuredDiscographyAlbums as featured (`featured:${featured.entry.key}:${featured.entry.representative.id}`)}
									{@const album = featured.entry.representative}
									{@const hasOfficialTidalSource = album.discographySource === 'official_tidal'}
									{@const coverOverride = albumCoverOverrides[album.id]}
									{@const coverImageCandidates = buildAlbumCoverCandidates(
										album,
										featured.entry.versions,
										hasOfficialTidalSource,
										coverOverride
									)}
									{@const coverCacheKey = getCoverCacheKey({
										coverId: coverOverride || album.cover,
										size: '640',
										proxy: hasOfficialTidalSource,
										overrideKey: `artist:${artist?.id ?? 0}:album:${album.id}`
									})}
									{@const resolvedCoverUrl = getResolvedCoverUrl(coverCacheKey)}
									{@const coverImageUrl = resolvedCoverUrl ?? coverImageCandidates[0] ?? ''}
									<EntityMediaCard
										type="album"
										href={`/album/${album.id}`}
										title={album.title}
										subtitle={formatAlbumMeta(album)}
										class="recommendation-slider__item discography-featured__item"
										data-recommendation-card="true"
									>
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
													onerror={handleAlbumCoverError}
													onload={handleAlbumCoverLoad}
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
									</EntityMediaCard>
								{/each}
							</div>
						</div>
					</ToolPanel>
				</section>
			{/if}

				<section class="artist-discography-primary" data-ui-block="main-content">
					<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
						<div>
							<h2 class="text-2xl font-semibold text-white">Discography</h2>
							<p class="text-sm text-gray-400">Albums, EPs, and more from {artist.name}.</p>
						</div>
						<div class="ui-action-row ui-action-row--progressive">
							<button
								onclick={handleDownloadDiscography}
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
									bind:value={bestEditionRule}
									class="ui-select"
									aria-label="Best edition rule"
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
									onclick={() => toggleDiscographyFilter(release.key as 'album' | 'ep' | 'single')}
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
										toggleDiscographyFilter(
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
								Resolving cover art for {discographyMissingCoverCount} release{discographyMissingCoverCount === 1 ? '' : 's'} in the background.
							</p>
						{/if}
						{#each [
							{ id: 'album', title: 'Albums', entries: discographyAlbums },
							{ id: 'ep', title: 'EPs', entries: discographyEps },
							{ id: 'single', title: 'Singles', entries: discographySingles }
						] as section (section.id)}
							{#if section.entries.length > 0}
								<div class="space-y-3">
									<div class="flex items-center justify-between">
										<div>
											<h3 class="text-lg font-semibold text-white">{section.title}</h3>
											<p class="text-xs text-gray-400">
												Showing {formatQualityLabel(downloadQuality)} variants
											</p>
										</div>
										<span
											class="ui-meta-pill"
										>
											{section.entries.length}
										</span>
									</div>
										<div class="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
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
													overrideKey: `artist:${artist?.id ?? 0}:album:${album.id}`
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
																	? cancelAlbumQueueDownload(album.id, event)
																	: handleAlbumDownload(album, event)}
															type="button"
															class="absolute top-3 right-3 z-40 flex items-center justify-center rounded-full border border-white/15 bg-black/80 p-2 text-gray-200 transition-[background-color,border-color,color,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:-translate-y-px hover:border-white/35 hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
															disabled={
																isDownloadingDiscography ||
																albumDownloadState.status === 'submitting'
															}
															aria-label={
																canCancelAlbumDownload
																	? `Stop download ${album.title}`
																	: albumDownloadState.status === 'paused'
																		? `Resume download ${album.title}`
																		: `Download ${album.title}`
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
																onerror={handleAlbumCoverError}
																onload={handleAlbumCoverLoad}
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
													{#snippet footer()}
														{#if albumDownloadState.status === 'queued'}
															<p class="album-card-status">Queued</p>
														{:else if albumDownloadState.downloading}
															<p class="album-card-status">
																Downloading {albumDownloadState.completed ?? 0}/{displayTrackTotal(
																	albumDownloadState.total ?? 0
																)}
															</p>
														{:else if albumDownloadState.status === 'completed'}
															<p class="album-card-status">Downloaded</p>
														{:else if albumDownloadState.status === 'cancelled'}
															<p class="album-card-status">Stopped</p>
														{:else if albumDownloadState.status === 'paused'}
															<p class="album-card-status">Paused</p>
														{:else if albumDownloadState.error}
															<p class="album-card-status" role="alert">Download error</p>
														{:else if albumInLibrary}
															<p class="album-card-status">In library</p>
														{/if}
													{/snippet}
												</EntityMediaCard>
											{/each}
									</div>
								</div>
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
									onclick={resetDiscographyFilters}
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
		</div>

	</div>
{/if}

<style>
	.artist-discography-primary {
		border-top: 1px solid rgba(255, 255, 255, 0.18);
		padding-top: 0.9rem;
	}

	.artist-rail-stack {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.artist-rail-group {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.artist-rail-group__header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
	}

	.artist-rail-group__title-row {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.artist-rail-group__title {
		margin: 0;
		font-size: 0.96rem;
		font-weight: 700;
		line-height: 1.3;
		color: rgba(238, 238, 238, 0.96);
	}

	.recommendation-count-pill {
		display: inline-flex;
		align-items: center;
		border: 1px solid rgba(255, 255, 255, 0.2);
		background: rgba(255, 255, 255, 0.05);
		border-radius: var(--ui-radius-sm, 9px);
		padding: 0.2rem 0.58rem;
		font-size: 0.74rem;
		font-weight: 600;
		color: rgba(234, 234, 234, 0.95);
	}

	.recommendation-slider__controls {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.recommendation-slider__control {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(255, 255, 255, 0.16);
		background: rgba(255, 255, 255, 0.04);
		border-radius: var(--ui-radius-sm, 9px);
		padding: 0.28rem 0.36rem;
		min-width: 2rem;
		min-height: 2rem;
		color: rgba(234, 234, 234, 0.95);
		transition:
			background-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.recommendation-slider__control:hover {
		border-color: rgba(255, 255, 255, 0.3);
		background: rgba(255, 255, 255, 0.11);
		color: rgba(246, 246, 246, 0.98);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.recommendation-slider {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(180px, 220px);
		gap: 0.65rem;
		overflow-x: auto;
		padding: 0.1rem 0.1rem 0.5rem;
		scroll-snap-type: x mandatory;
		scrollbar-color: rgba(255, 255, 255, 0.28) rgba(22, 22, 22, 0.4);
		scrollbar-width: thin;
	}

	.recommendation-slider::-webkit-scrollbar {
		height: 8px;
	}

	.recommendation-slider::-webkit-scrollbar-track {
		background: rgba(22, 22, 22, 0.4);
	}

	.recommendation-slider::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.28);
	}

	:global(.recommendation-slider__item) {
		scroll-snap-align: start;
	}

	:global(.recommendation-slider__item.ui-media-card) {
		padding: 0.62rem;
		gap: 0.46rem;
		border-radius: var(--ui-radius-sm, 9px);
	}

	:global(.recommendation-slider__item .ui-media-card__title) {
		font-size: 0.92rem;
	}

	:global(.recommendation-slider__item .ui-media-card__subtitle) {
		font-size: 0.82rem;
	}

	:global(.recommendation-slider__item .ui-media-card__meta) {
		font-size: 0.76rem;
	}

	.discography-featured__slider {
		padding-top: 0.1rem;
	}

	:global(.discography-featured__item) {
		border-color: rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.02);
	}

	.album-card-status {
		margin: 0;
		padding-top: 0.2rem;
		font-size: 0.76rem;
		color: rgba(200, 200, 200, 0.9);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 600;
	}

	@media (max-width: 900px) {
		.recommendation-slider {
			grid-auto-columns: minmax(180px, 62vw);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.recommendation-slider__control,
		.recommendation-slider,
		.recommendation-slider * {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
