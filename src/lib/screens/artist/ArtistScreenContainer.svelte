<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { losslessAPI } from '$lib/api';
	import { downloadAlbum } from '$lib/downloads';
	import {
		artistAlbumDownloadPrompts,
		createArtistAlbumDownloadController
	} from '$lib/features/artist/artistAlbumDownloadController';
	import {
		createArtistAlbumQueueController,
		createDefaultArtistAlbumDownloadState as createDefaultAlbumDownloadState,
		isArtistAlbumQueueDownloadCancellable as isAlbumQueueDownloadCancellable,
		type ArtistAlbumDownloadState as AlbumDownloadState
	} from '$lib/features/artist/artistAlbumQueueController';
	import {
		createArtistCoverHydrationController,
	} from '$lib/features/artist/artistCoverHydrationController';
	import {
		buildArtistAlbumCoverCandidates as buildAlbumCoverCandidates,
		parseCoverCandidates,
		serializeCoverCandidates
	} from '$lib/presentation/artistCoverPresentation';
	import {
		buildFeaturedDiscographyAlbums,
		buildTopTrackAlbumSignals,
		filterDiscographyEntries
	} from '$lib/features/artist/artistDiscographyModel';
	import { resolveDiscographyGroupMusicBrainzReleaseId } from '$lib/features/artist/artistDiscographyPresentation';
	import {
		createAlbumMusicBrainzMatchController,
		selectAlbumMusicBrainzHydrationCandidates
	} from '$lib/features/search/albumMusicBrainzMatchController';
	import {
		normalizeArtistToken as normalizeToken,
		pickDefaultMusicBrainzArtistId,
		searchMusicBrainzArtistsByName,
		type MusicBrainzArtistOption
	} from '$lib/features/artist/artistMusicBrainzController';
	import type { Album, ArtistDetails, ArtistRecommendations, AudioQuality } from '$lib/types';
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import { confirm as requestConfirmation } from '$lib/stores/dialogs';
	import {
		groupDiscography,
		type DiscographyBestEditionRule
	} from '$lib/utils/discography';
	import {
		getCoverCacheKey,
		getResolvedCoverUrl,
		getUnifiedCoverCandidates,
		markCoverFailed,
		markCoverResolved,
		prefetchCoverCandidates,
		subscribeCoverPipelineEvents
	} from '$lib/utils/coverPipeline';
	import { fetchAlbumLibraryStatus } from '$lib/utils/mediaLibraryClient';
	import { ArrowLeft, LoaderCircle } from 'lucide-svelte';
	import ArtistDiscographySection from '$lib/screens/artist/sections/ArtistDiscographySection.svelte';
	import ArtistHeroSection from '$lib/screens/artist/sections/ArtistHeroSection.svelte';
	import ArtistHighlightsSection from '$lib/screens/artist/sections/ArtistHighlightsSection.svelte';
	import ArtistMusicBrainzSection from '$lib/screens/artist/sections/ArtistMusicBrainzSection.svelte';
	import ArtistRecommendationsSection from '$lib/screens/artist/sections/ArtistRecommendationsSection.svelte';
	import ArtistTopTracksSection from '$lib/screens/artist/sections/ArtistTopTracksSection.svelte';
	import {
		DEFAULT_ARTIST_DISCOGRAPHY_FILTER_STATE,
		buildArtistHeroViewModel,
		buildArtistMusicBrainzSectionViewModel,
		buildArtistRecommendationRailState,
		buildArtistSectionNavItems,
		displayArtistTrackTotal,
		formatArtistAlbumMeta,
		formatArtistQualityLabel,
		normalizeArtistDetails,
		toggleArtistDiscographyFilterState
	} from '$lib/screens/artist/artistViewModel';

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
	let discographyFilterState = $state({ ...DEFAULT_ARTIST_DISCOGRAPHY_FILTER_STATE });
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
	const ALBUM_QUEUE_POLL_INTERVAL_MS = 1000;
	let coverHydrationGeneration = $state(0);
	let activeRequestToken = 0;
	let artistLoadAbortController: AbortController | null = null;
	let activeArtistLoadId: number | null = null;
	let albumLibraryLookupToken = 0;
	let coverResolutionTick = $state(0);
	let isDocumentVisible = $state(true);
	let musicBrainzArtistOptions = $state<MusicBrainzArtistOption[]>([]);
	let selectedMusicBrainzArtistId = $state<string>('');
	let isMusicBrainzArtistLookupLoading = $state(false);
	let musicBrainzArtistLookupError = $state<string | null>(null);
	let hasMusicBrainzArtistLookupAttempted = $state(false);
	let musicBrainzArtistLookupToken = 0;

	let albumMusicBrainzReleaseMatches = $state<Record<number, string>>({});
	let isDiscographyMusicBrainzLookupLoading = $state(false);
	let pendingDiscographyMusicBrainzAlbumIds = $state<Set<number>>(new Set());
	let discographyMusicBrainzLookupToken = 0;

	const discographyMusicBrainzController = createAlbumMusicBrainzMatchController({
		hasMatch: (albumId) => Boolean(albumMusicBrainzReleaseMatches[albumId]),
		onMatch: (albumId, releaseId) => {
			albumMusicBrainzReleaseMatches = { ...albumMusicBrainzReleaseMatches, [albumId]: releaseId };
			if (pendingDiscographyMusicBrainzAlbumIds.has(albumId)) {
				const next = new Set(pendingDiscographyMusicBrainzAlbumIds);
				next.delete(albumId);
				pendingDiscographyMusicBrainzAlbumIds = next;
			}
		},
		onLookupSettled: (albumId) => {
			if (!pendingDiscographyMusicBrainzAlbumIds.has(albumId)) {
				return;
			}
			const next = new Set(pendingDiscographyMusicBrainzAlbumIds);
			next.delete(albumId);
			pendingDiscographyMusicBrainzAlbumIds = next;
		}
	});
	const visibleDiscographyMusicBrainzReleaseMatches = $derived.by(() => {
		const matches: Record<number, string> = {};
		for (const entry of discographyEntries) {
			const releaseId = resolveDiscographyGroupMusicBrainzReleaseId(entry, {
				albumMusicBrainzReleaseMatches,
				resolveCachedMusicBrainzReleaseId: (album) => discographyMusicBrainzController.peekMatch(album)
			});
			if (releaseId) {
				matches[entry.representative.id] = releaseId;
			}
		}
		return matches;
	});

	const selectedMusicBrainzArtist = $derived.by(
		() =>
			musicBrainzArtistOptions.find((candidate) => candidate.id === selectedMusicBrainzArtistId) ??
			null
	);
	const hasRecommendationRail = $derived(
		buildArtistRecommendationRailState({
			recommendationsLoading,
			recommendationsError,
			recommendedArtistsCount: recommendedArtists.length,
			recommendedAlbumsCount: recommendedAlbums.length
		})
	);
	const hasHighlightsSection = $derived(featuredDiscographyAlbums.length > 0);
	const sectionNavItems = $derived.by(() =>
		buildArtistSectionNavItems({
			hasRecommendationRail,
			hasHighlightsSection
		})
	);
	const heroViewModel = $derived.by(() =>
		artist ? buildArtistHeroViewModel(artist, artistImage) : null
	);
	const musicBrainzSectionViewModel = $derived.by(() =>
		buildArtistMusicBrainzSectionViewModel({
			candidates: musicBrainzArtistOptions,
			selectedArtistId: selectedMusicBrainzArtistId,
			selectedArtist: selectedMusicBrainzArtist,
			isLoading: isMusicBrainzArtistLookupLoading,
			hasAttempted: hasMusicBrainzArtistLookupAttempted,
			error: musicBrainzArtistLookupError
		})
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
			discographyMusicBrainzLookupToken += 1;
			albumMusicBrainzReleaseMatches = {};
			isDiscographyMusicBrainzLookupLoading = false;
			pendingDiscographyMusicBrainzAlbumIds = new Set();
			discographyMusicBrainzController.invalidate();
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
			musicBrainzArtistOptions = [];
			selectedMusicBrainzArtistId = '';
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

	function toggleDiscographyFilter(
		key: 'album' | 'ep' | 'single' | 'live' | 'remaster' | 'explicit' | 'clean'
	): void {
		discographyFilterState = toggleArtistDiscographyFilterState(discographyFilterState, key);
	}

	function resetDiscographyFilters(): void {
		discographyFilterState = { ...DEFAULT_ARTIST_DISCOGRAPHY_FILTER_STATE };
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

	function beginCoverHydrationGeneration(): number {
		return coverHydrationController.beginGeneration();
	}

	const coverHydrationController = createArtistCoverHydrationController({
		getCoverOverride: (albumId) => albumCoverOverrides[albumId],
		setCoverOverride: (albumId, coverId) => {
			albumCoverOverrides = {
				...albumCoverOverrides,
				[albumId]: coverId
			};
		},
		clearCoverFailure: clearAlbumCoverFailure,
		fetchCoverFromApi: async (albumId, generation) => {
			const { album: albumData } = await losslessAPI.getAlbum(albumId);
			const cover = typeof albumData.cover === 'string' ? albumData.cover.trim() : '';
			if (!cover || generation !== coverHydrationGeneration) {
				return null;
			}
			const artistForCache = albumData.artist?.id ?? artist?.id;
			if (typeof artistForCache === 'number' && Number.isFinite(artistForCache)) {
				artistCacheStore.upsertAlbumCover(artistForCache, albumId, cover);
			}
			artistCacheStore.upsertAlbumCoverGlobally(albumId, cover);
			return cover;
		},
		onGenerationChange: (generation) => {
			coverHydrationGeneration = generation;
		},
		onLookupError: (albumId, lookupError) => {
			console.warn(`[Artist] Failed to hydrate cover for album ${albumId}:`, lookupError);
		}
	});

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

		const hydratedCover = await coverHydrationController.resolveCoverFromApi(albumId, generation);
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
			coverHydrationController.enqueue(album.id, generation);
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

	$effect(() => {
		const albums = discographyEntries.map((e) => e.representative);
		if (albums.length === 0) {
			discographyMusicBrainzLookupToken += 1;
			isDiscographyMusicBrainzLookupLoading = false;
			pendingDiscographyMusicBrainzAlbumIds = new Set();
			discographyMusicBrainzController.invalidate();
			return;
		}
		const lookupCandidates = untrack(() =>
			selectAlbumMusicBrainzHydrationCandidates(albums, {
				hasMatch: (albumId) => Boolean(visibleDiscographyMusicBrainzReleaseMatches[albumId])
			})
		);
		if (lookupCandidates.length === 0) {
			discographyMusicBrainzLookupToken += 1;
			isDiscographyMusicBrainzLookupLoading = false;
			pendingDiscographyMusicBrainzAlbumIds = new Set();
			return;
		}
		const token = ++discographyMusicBrainzLookupToken;
		const pendingIds = lookupCandidates.map((entry) => entry.album.id);
		isDiscographyMusicBrainzLookupLoading = true;
		pendingDiscographyMusicBrainzAlbumIds = new Set(pendingIds);
		void (async () => {
			try {
				await discographyMusicBrainzController.hydrate(albums);
			} finally {
				if (token === discographyMusicBrainzLookupToken) {
					isDiscographyMusicBrainzLookupLoading = false;
					pendingDiscographyMusicBrainzAlbumIds = new Set();
				}
			}
		})();
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

	const albumDownloadController = createArtistAlbumDownloadController({
		getAlbumDownloadState,
		patchAlbumDownloadState,
		isAlbumQueueDownloadCancellable: isAlbumQueueDownloadCancellable,
		requestQueueCancel: (albumId) => albumQueueController.cancelQueueDownload(albumId),
		requestQueueResume: (albumId) => albumQueueController.resumeQueueDownload(albumId),
		startQueuePolling: (albumId, jobId) => {
			albumQueueController.startPolling(albumId, jobId);
		},
		isDiscographyDownloading: () => isDownloadingDiscography,
		setDiscographyDownloading: (downloading) => {
			isDownloadingDiscography = downloading;
		},
		setDiscographyProgress: (progress) => {
			discographyProgress = progress;
		},
		setDiscographyError: (message) => {
			discographyError = message;
		},
		resolveAlbumInLibrary: (albumId) => albumLibraryPresence[albumId]?.exists === true,
		confirmServerOverwrite: () =>
			requestConfirmation({
				title: 'Overwrite album files?',
				body: artistAlbumDownloadPrompts.FORCE_OVERWRITE_CONFIRMATION,
				confirmLabel: 'Overwrite files',
				cancelLabel: 'Keep existing files',
				tone: 'danger'
			}),
		confirmClientRedownload: () =>
			requestConfirmation({
				title: 'Download album again?',
				body: artistAlbumDownloadPrompts.CLIENT_REDOWNLOAD_CONFIRMATION,
				confirmLabel: 'Download again',
				cancelLabel: 'Cancel',
				tone: 'warning'
			}),
		getDownloadPreferences: () => ({
			quality: downloadQuality,
			mode: downloadMode,
			convertAacToMp3: convertAacToMp3Preference,
			experimentalMusicBrainzTagging: experimentalMusicBrainzTaggingPreference,
			strictMusicBrainzMatching: strictMusicBrainzMatchingPreference,
			storage: downloadStoragePreference
		}),
		resolveArtistName: () => artist?.name,
		resolveMusicBrainzReleaseId: (albumId) => visibleDiscographyMusicBrainzReleaseMatches[albumId],
		ensureMusicBrainzReleaseId: (album) => discographyMusicBrainzController.ensureMatch(album),
		downloadAlbumFn: downloadAlbum
	});

	async function cancelAlbumQueueDownload(albumId: number, event?: MouseEvent): Promise<void> {
		await albumDownloadController.cancelAlbumQueueDownload(albumId, event);
	}

	async function handleAlbumDownload(album: Album, event?: MouseEvent): Promise<void> {
		await albumDownloadController.handleAlbumDownload(album, event);
	}

	async function handleDownloadDiscography(): Promise<void> {
		if (!artist) {
			return;
		}
		await albumDownloadController.handleDownloadDiscography(discography);
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
		{#if heroViewModel}
			<ArtistHeroSection hero={heroViewModel} />
		{/if}

		<PageSectionNav items={sectionNavItems} sticky={true} />

		<div class="ui-detail-columns">
			<div class="ui-detail-main">
				<section id="artist-top-tracks" class="ui-section-anchor" data-ui-block="main-content">
					<ArtistTopTracksSection topTracks={topTracks} artistName={artist.name} />
				</section>

				<section id="artist-discography" class="ui-section-anchor" data-ui-block="main-content">
					<ArtistDiscographySection
						artistId={artist.id}
						artistName={artist.name}
						{discography}
						visibleDiscography={visibleDiscography}
						discographyAlbums={discographyAlbums}
						discographyEps={discographyEps}
						discographySingles={discographySingles}
						discographyInfo={discographyInfo}
						downloadQuality={downloadQuality}
						bestEditionRule={bestEditionRule}
						discographyFilterState={discographyFilterState}
						filtersHideAllDiscography={filtersHideAllDiscography}
						isDownloadingDiscography={isDownloadingDiscography}
						discographyProgress={discographyProgress}
						discographyError={discographyError}
						discographyMissingCoverCount={discographyMissingCoverCount}
						albumCoverOverrides={albumCoverOverrides}
						albumCoverFailures={albumCoverFailures}
						coverHydrationGeneration={coverHydrationGeneration}
						albumDownloadStates={albumDownloadStates}
						albumLibraryPresence={albumLibraryPresence}
						albumMusicBrainzReleaseMatches={visibleDiscographyMusicBrainzReleaseMatches}
						isDiscographyMusicBrainzLoading={isDiscographyMusicBrainzLookupLoading}
						pendingDiscographyMusicBrainzAlbumIds={pendingDiscographyMusicBrainzAlbumIds}
						displayTrackTotal={displayArtistTrackTotal}
						formatAlbumMeta={formatArtistAlbumMeta}
						formatQualityLabel={formatArtistQualityLabel}
						onDownloadDiscography={handleDownloadDiscography}
						onBestEditionRuleChange={(rule: DiscographyBestEditionRule) => {
							bestEditionRule = rule;
						}}
						onToggleDiscographyFilter={toggleDiscographyFilter}
						onResetDiscographyFilters={resetDiscographyFilters}
						onCancelAlbumQueueDownload={cancelAlbumQueueDownload}
						onAlbumDownload={handleAlbumDownload}
						onAlbumCoverError={handleAlbumCoverError}
						onAlbumCoverLoad={handleAlbumCoverLoad}
					/>
				</section>
			</div>

			<div class="ui-detail-sidebar">
				<section id="artist-metadata" class="ui-section-anchor" data-ui-block="context-metadata">
					<ArtistMusicBrainzSection
						viewModel={musicBrainzSectionViewModel}
						isLoading={isMusicBrainzArtistLookupLoading}
						onRefresh={() => {
							if (!artist) return;
							void lookupMusicBrainzArtists({
								id: artist.id,
								name: artist.name
							});
						}}
						onSelectionChange={(value) => {
							selectedMusicBrainzArtistId = value;
						}}
					/>
				</section>

				{#if hasRecommendationRail}
					<section id="artist-recommendations" class="ui-section-anchor" data-ui-block="secondary-content">
						<ArtistRecommendationsSection
							artistId={artist.id}
							artistName={artist.name}
							{recommendations}
							{recommendationsLoading}
							{recommendationsError}
							{recommendedArtists}
							{recommendedAlbums}
							formatAlbumMeta={formatArtistAlbumMeta}
						/>
					</section>
				{/if}

				{#if hasHighlightsSection}
					<section id="artist-highlights" class="ui-section-anchor" data-ui-block="secondary-content">
						<ArtistHighlightsSection
							artistId={artist.id}
							artistName={artist.name}
							{featuredDiscographyAlbums}
							{albumCoverOverrides}
							{albumCoverFailures}
							coverHydrationGeneration={coverHydrationGeneration}
							formatAlbumMeta={formatArtistAlbumMeta}
							onAlbumCoverError={handleAlbumCoverError}
							onAlbumCoverLoad={handleAlbumCoverLoad}
						/>
					</section>
				{/if}
			</div>
		</div>
	</div>
	{/if}
