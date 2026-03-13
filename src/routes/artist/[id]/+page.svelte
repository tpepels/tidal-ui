<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
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
		buildArtistAlbumCoverCandidates as buildAlbumCoverCandidates,
		createArtistCoverHydrationController,
		parseCoverCandidates,
		serializeCoverCandidates
	} from '$lib/features/artist/artistCoverHydrationController';
	import {
		buildFeaturedDiscographyAlbums,
		buildTopTrackAlbumSignals,
		filterDiscographyEntries
	} from '$lib/features/artist/artistDiscographyModel';
	import ArtistDiscographySection from '$lib/components/artist/ArtistDiscographySection.svelte';
	import ArtistDiscographyHighlights from '$lib/components/artist/ArtistDiscographyHighlights.svelte';
	import ArtistRecommendationsRail from '$lib/components/artist/ArtistRecommendationsRail.svelte';
	import ArtistTopTracksSection from '$lib/components/artist/ArtistTopTracksSection.svelte';
	import {
		formatMusicBrainzArtistLifeSpan,
		normalizeArtistToken as normalizeToken,
		pickDefaultMusicBrainzArtistId,
		searchMusicBrainzArtistsByName,
		type MusicBrainzArtistOption
	} from '$lib/features/artist/artistMusicBrainzController';
	import type { Album, ArtistDetails, ArtistRecommendations, AudioQuality } from '$lib/types';
	import ActionPanel from '$lib/components/ui/ActionPanel.svelte';
	import DataGrid from '$lib/components/ui/DataGrid.svelte';
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
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
	import { scoreAlbumForSelection } from '$lib/utils/albumSelection';
	import { sortTopTracks } from '$lib/utils/topTracks';
	import { fetchAlbumLibraryStatus } from '$lib/utils/mediaLibraryClient';
	import { ArrowLeft, LoaderCircle, User } from 'lucide-svelte';

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

	const selectedMusicBrainzArtist = $derived.by(
		() =>
			musicBrainzArtistOptions.find((candidate) => candidate.id === selectedMusicBrainzArtistId) ??
			null
	);
	const hasRecommendationRail = $derived(
		recommendationsLoading ||
			Boolean(recommendationsError) ||
			recommendedArtists.length > 0 ||
			recommendedAlbums.length > 0
	);
	const hasHighlightsSection = $derived(featuredDiscographyAlbums.length > 0);
	const sectionNavItems = $derived.by(() => {
		const items = [
			{ id: 'artist-metadata', label: 'MusicBrainz', tone: 'tertiary' as const },
			{ id: 'artist-top-tracks', label: 'Top Tracks' }
		];
		if (hasRecommendationRail) {
			items.push({ id: 'artist-recommendations', label: 'Recommendations', tone: 'tertiary' as const });
		}
		if (hasHighlightsSection) {
			items.push({ id: 'artist-highlights', label: 'Highlights' });
		}
		items.push({ id: 'artist-discography', label: 'Discography' });
		return items;
	});

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
			window.confirm(artistAlbumDownloadPrompts.FORCE_OVERWRITE_CONFIRMATION),
		confirmClientRedownload: () =>
			window.confirm(artistAlbumDownloadPrompts.CLIENT_REDOWNLOAD_CONFIRMATION),
		getDownloadPreferences: () => ({
			quality: downloadQuality,
			mode: downloadMode,
			convertAacToMp3: convertAacToMp3Preference,
			experimentalMusicBrainzTagging: experimentalMusicBrainzTaggingPreference,
			strictMusicBrainzMatching: strictMusicBrainzMatchingPreference,
			storage: downloadStoragePreference
		}),
		resolveArtistName: () => artist?.name,
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



		<!-- Artist Header -->
		<div class="flex flex-col items-start gap-8 md:flex-row md:items-end" data-ui-block="entity-hero">
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

			<div class="flex-1">
				<p class="mb-2 text-sm text-gray-400">ARTIST</p>
				<h1 class="mb-4 text-4xl font-bold md:text-6xl">{artist.name}</h1>

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

		<PageSectionNav items={sectionNavItems} sticky={true} />

		<div class="flex flex-col gap-12 lg:grid lg:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.95fr)] lg:items-start lg:gap-8">
			<div class="space-y-12">
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
						{displayTrackTotal}
						{formatAlbumMeta}
						{formatQualityLabel}
						onDownloadDiscography={handleDownloadDiscography}
						onBestEditionRuleChange={(rule) => {
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

			<div class="space-y-8 lg:sticky lg:top-24">
				<section id="artist-metadata" class="ui-section-anchor" data-ui-block="context-metadata">
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
				</section>

				{#if hasRecommendationRail}
					<section id="artist-recommendations" class="ui-section-anchor" data-ui-block="secondary-content">
						<ArtistRecommendationsRail
							artistId={artist.id}
							artistName={artist.name}
							{recommendations}
							{recommendationsLoading}
							{recommendationsError}
							{recommendedArtists}
							{recommendedAlbums}
							{formatAlbumMeta}
						/>
					</section>
				{/if}

				{#if hasHighlightsSection}
					<section id="artist-highlights" class="ui-section-anchor" data-ui-block="secondary-content">
						<ArtistDiscographyHighlights
							artistId={artist.id}
							artistName={artist.name}
							{featuredDiscographyAlbums}
							{albumCoverOverrides}
							{albumCoverFailures}
							coverHydrationGeneration={coverHydrationGeneration}
							{formatAlbumMeta}
							onAlbumCoverError={handleAlbumCoverError}
							onAlbumCoverLoad={handleAlbumCoverLoad}
						/>
					</section>
				{/if}
			</div>
		</div>
	</div>
	{/if}
