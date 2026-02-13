<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { losslessAPI } from '$lib/api';
	import { downloadAlbum } from '$lib/downloads';
	import { isAlbumDownloadQueueActive, type AlbumDownloadStatus } from '$lib/controllers/albumDownloadUi';
	import type { Album, ArtistDetails, AudioQuality } from '$lib/types';
	import TopTracksGrid from '$lib/components/TopTracksGrid.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import {
		groupDiscography,
		getDiscographyTraits,
		type DiscographyBestEditionRule
	} from '$lib/utils/discography';
	import {
		getCoverCacheKey,
		getResolvedCoverUrl,
		getUnifiedCoverCandidates,
		isCoverInFailureBackoff,
		markCoverFailed,
		markCoverResolved,
		prefetchCoverCandidates
	} from '$lib/utils/coverPipeline';
	import { scoreAlbumForSelection } from '$lib/utils/albumSelection';
	import { fetchAlbumLibraryStatus } from '$lib/utils/mediaLibraryClient';
	import { ArrowLeft, User, Download, LoaderCircle, RotateCcw, X } from 'lucide-svelte';

	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { artistCacheStore } from '$lib/stores/artistCache';

	let artist = $state<ArtistDetails | null>(null);
	let artistImage = $state<string | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	const artistId = $derived($page.params.id);
	const topTracks = $derived(artist?.tracks ?? []);
	const rawDiscography = $derived(artist?.albums ?? []);
	const discographyInfo = $derived(artist?.discographyInfo ?? null);
	const enrichmentDiagnostics = $derived(discographyInfo?.enrichmentDiagnostics ?? null);
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
		groupedDiscographyEntries.filter((entry) => {
			const traits = getDiscographyTraits(entry.representative);
			if (!discographyFilterState[traits.releaseType]) return false;
			if (!discographyFilterState.live && traits.isLive) return false;
			if (!discographyFilterState.remaster && traits.isRemaster) return false;
			if (!discographyFilterState.explicit && traits.isExplicit) return false;
			if (!discographyFilterState.clean && !traits.isExplicit) return false;
			return true;
		})
	);
	const duplicateCollapsedCount = $derived(
		Math.max(0, rawDiscography.length - groupedDiscographyEntries.length)
	);
	const filteredOutCount = $derived(
		Math.max(0, groupedDiscographyEntries.length - discographyEntries.length)
	);
	const hasGroupedDiscography = $derived(groupedDiscographyEntries.length > 0);
	const filtersHideAllDiscography = $derived(hasGroupedDiscography && discographyEntries.length === 0);
	const discography = $derived(discographyEntries.map((entry) => entry.representative));
	const discographyAlbums = $derived(
		discographyEntries.filter((entry) => entry.section === 'album')
	);
	const discographyEps = $derived(
		discographyEntries.filter((entry) => entry.section === 'ep')
	);
	const discographySingles = $derived(
		discographyEntries.filter((entry) => entry.section === 'single')
	);
	const recentMeaningfulEnrichmentPasses = $derived(
		(enrichmentDiagnostics?.passes ?? [])
			.filter(
				(pass) =>
					pass.name === 'official-tidal' ||
					pass.accepted > 0 ||
					pass.returned > 0 ||
					pass.newlyAdded > 0 ||
					(typeof pass.total === 'number' && pass.total > 0)
			)
			.slice(-4)
	);
	const zeroResultEnrichmentPasses = $derived(
		(enrichmentDiagnostics?.passes ?? []).filter(
			(pass) =>
				pass.name !== 'official-tidal' &&
				pass.accepted === 0 &&
				pass.returned === 0 &&
				pass.newlyAdded === 0 &&
				(pass.total === undefined || pass.total === 0)
		).length
	);
	const downloadMode = $derived($downloadPreferencesStore.mode);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const downloadStoragePreference = $derived($downloadPreferencesStore.storage);

	type AlbumDownloadState = {
		status: AlbumDownloadStatus;
		downloading: boolean;
		completed: number;
		total: number;
		error: string | null;
		failedTracks: number;
		queueJobId: string | null;
	};

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
	const albumQueuePollTimers = new Map<number, ReturnType<typeof setInterval>>();
	const albumQueuePollTokens = new Map<number, number>();
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
	const COVER_CANDIDATE_DELIMITER = '\n';

	$effect(() => {
		const id = Number(artistId);
		if (!Number.isFinite(id) || id <= 0) {
			artistLoadAbortController?.abort();
			artistLoadAbortController = null;
			activeArtistLoadId = null;
			activeRequestToken += 1;
			stopAllAlbumQueuePolling();
			beginCoverHydrationGeneration();
			albumDownloadStates = {};
			artist = null;
			artistImage = null;
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
		stopAllAlbumQueuePolling();
	});

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

	function formatEnrichmentPassName(name: 'artist-name' | 'official-tidal'): string {
		if (name === 'official-tidal') return 'Official TIDAL API';
		return 'Artist-name search';
	}

	function formatEnrichmentPassStatus(pass: {
		name: 'artist-name' | 'official-tidal';
		query: string;
	}): string | null {
		if (pass.name !== 'official-tidal') return null;
		if (pass.query === 'official-discography') return 'active';
		const [, detail = 'unavailable'] = pass.query.split(':', 2);
		return detail.replace(/_/g, ' ');
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
			tracks: Array.from(dedupedTracks.values())
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
		if (!artist) return;
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
		if (!artist || discographyEntries.length === 0) {
			return;
		}
		const artistIdForKey = artist.id;
		const batch = discographyEntries
			.slice(0, 30)
			.map((entry) => {
				const representative = entry.representative;
				const override = albumCoverOverrides[representative.id];
				const useProxy = entry.versions.some(
					(version) => version.discographySource === 'official_tidal'
				);
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
		void prefetchCoverCandidates(batch);
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

	function createDefaultAlbumDownloadState(total = 0): AlbumDownloadState {
		return {
			status: 'idle',
			downloading: false,
			completed: 0,
			total,
			error: null,
			failedTracks: 0,
			queueJobId: null
		};
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
			const payload = (await response.json()) as {
				success?: boolean;
				job?: {
					status?: 'queued' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
					trackCount?: number;
					completedTracks?: number;
					progress?: number;
					error?: string;
				};
			};
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
						error: null
					});
					stopAlbumQueuePolling(albumId);
					albumQueuePollTokens.delete(albumId);
					break;
				case 'cancelled':
					patchAlbumDownloadState(albumId, {
						status: 'cancelled',
						downloading: false,
						error: null
					});
					stopAlbumQueuePolling(albumId);
					albumQueuePollTokens.delete(albumId);
					break;
				case 'failed':
					patchAlbumDownloadState(albumId, {
						status: 'failed',
						downloading: false,
						error: payload.job.error ?? 'Album download failed.'
					});
					stopAlbumQueuePolling(albumId);
					albumQueuePollTokens.delete(albumId);
					break;
				default:
					break;
			}
		} catch {
			// Keep latest optimistic state; next poll will reconcile.
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
				error: null
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
		if (inLibrary && currentState.status === 'idle') {
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
						storage: downloadStoragePreference
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

	async function loadArtist(id: number, controller: AbortController) {
		const requestToken = ++activeRequestToken;
		beginCoverHydrationGeneration();
		stopAllAlbumQueuePolling();
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

		if (cachedArtist) {
			const normalizedCached = normalizeArtistDetails(cachedArtist);
			artistCacheStore.set(normalizedCached);
			artist = normalizedCached;
			artistImage = normalizedCached.picture
				? losslessAPI.getArtistPictureUrl(normalizedCached.picture)
				: null;
			isLoading = false;
			breadcrumbStore.setCurrentLabel(normalizedCached.name, `/artist/${normalizedCached.id}`);
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

			breadcrumbStore.setCurrentLabel(normalizedData.name, `/artist/${normalizedData.id}`);

			// Get artist picture
			if (artist.picture) {
				artistImage = losslessAPI.getArtistPictureUrl(artist.picture);
			}
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
	<div class="mx-auto flex w-full max-w-xl flex-col gap-4 py-16">
		<div class="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
			<div class="mb-3 text-sm font-semibold text-gray-300">Loading artist data</div>
			<div
				class="flex items-center gap-3 text-sm text-gray-400"
				data-testid="artist-loading-spinner"
				role="status"
			>
				<LoaderCircle size={18} class="animate-spin text-blue-400" />
				<span>Fetching artist details…</span>
			</div>
		</div>
	</div>
{:else if error}
	<div class="mx-auto max-w-2xl py-12">
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-400">Error Loading Artist</h2>
			<p class="text-red-300">{error}</p>
			<a
				href="/"
				class="mt-4 inline-flex rounded-lg bg-red-600 px-4 py-2 transition-colors hover:bg-red-700"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if artist}
	<div class="space-y-6 pb-32 lg:pb-40">
		<!-- Back Button -->
		<button
			onclick={handleBackNavigation}
			class="flex items-center gap-2 text-gray-400 transition-colors hover:text-white"
		>
			<ArrowLeft size={20} />
			Back
		</button>



		<!-- Artist Header -->
		<div class="flex flex-col items-start gap-8 md:flex-row md:items-end">
			<!-- Artist Picture -->
			<div
				class="aspect-square w-full flex-shrink-0 overflow-hidden rounded-full bg-gray-800 shadow-2xl md:w-80"
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

				<div class="mb-6">
					<ShareButton type="artist" id={artist.id} variant="secondary" />
				</div>

				<div class="mb-6 flex flex-wrap items-center gap-4">
					{#if artist.popularity}
						<div class="text-sm text-gray-400">
							Popularity: <span class="font-semibold text-white">{artist.popularity}</span>
						</div>
					{/if}
					{#if artist.artistTypes && artist.artistTypes.length > 0}
						{#each artist.artistTypes as type (type)}
							<div
								class="rounded-full bg-blue-900/30 px-3 py-1 text-xs font-semibold text-blue-400"
							>
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
								<div class="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300">
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
			<section>
				<div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 class="text-2xl font-semibold text-white">Top Tracks</h2>
						<p class="text-sm text-gray-400">Best songs from {artist.name}.</p>
					</div>
				</div>
				{#if topTracks.length > 0}
					<div class="mt-6 overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
						<TopTracksGrid tracks={topTracks} />
					</div>
				{:else}
					<div
						class="mt-6 rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400"
					>
						<p>No top tracks available for this artist yet.</p>
					</div>
				{/if}
			</section>

			<section>
				<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 class="text-2xl font-semibold text-white">Discography</h2>
						<p class="text-sm text-gray-400">Albums, EPs, and more from {artist.name}.</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={handleDownloadDiscography}
							type="button"
							class="inline-flex items-center gap-2 rounded-full border border-blue-600 bg-blue-600/10 px-4 py-2 text-sm font-semibold text-blue-100 transition-colors hover:bg-blue-600/20 disabled:cursor-not-allowed disabled:opacity-60"
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
				<div class="mt-4 space-y-3 rounded-xl border border-gray-800 bg-gray-900/40 p-4">
					<div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
						<p class="text-xs font-semibold tracking-wide text-gray-300 uppercase">
							Discography Selection
						</p>
						<label class="flex items-center gap-2 text-xs text-gray-400">
							<span>Best edition</span>
							<select
								bind:value={bestEditionRule}
								class="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100"
								aria-label="Best edition rule"
							>
								<option value="balanced">Balanced</option>
								<option value="quality_first">Quality first</option>
								<option value="completeness_first">Most complete</option>
								<option value="original_release">Original release</option>
							</select>
						</label>
					</div>
						<div class="flex flex-wrap gap-2">
							{#each [
								{ key: 'album', label: 'Albums' },
								{ key: 'ep', label: 'EPs' },
								{ key: 'single', label: 'Singles' }
							] as release (release.key)}
							<button
								type="button"
								onclick={() => toggleDiscographyFilter(release.key as 'album' | 'ep' | 'single')}
								class={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
									discographyFilterState[release.key as 'album' | 'ep' | 'single']
										? 'border-blue-500 bg-blue-600/20 text-blue-100'
										: 'border-gray-700 bg-gray-900 text-gray-400 hover:text-gray-200'
								}`}
							>
								{release.label}
							</button>
						{/each}
					</div>
							<div class="flex flex-wrap gap-2">
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
								class={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
									discographyFilterState[
										filter.key as 'live' | 'remaster' | 'explicit' | 'clean'
									]
										? 'border-emerald-600 bg-emerald-700/20 text-emerald-100'
										: 'border-gray-700 bg-gray-900 text-gray-400 hover:text-gray-200'
								}`}
							>
								{filter.label}
							</button>
							{/each}
						</div>
						<p class="text-xs text-gray-500">
							Content filters use release metadata. “Non-explicit” is what some catalogs label as “clean”.
						</p>
					</div>
				{#if discographyInfo?.mayBeIncomplete}
					<div class="mt-3 rounded-lg border border-amber-700/40 bg-amber-900/20 p-3 text-sm text-amber-200">
						<p class="font-semibold">Discography may be incomplete from source data.</p>
						{#if discographyInfo.reason}
							<p class="mt-1 text-xs text-amber-100/90">{discographyInfo.reason}.</p>
						{/if}
						{#if discographyInfo.enrichedAlbumCount > 0}
							<p class="mt-1 text-xs text-amber-100/90">
								Enrichment already added {discographyInfo.enrichedAlbumCount} album{discographyInfo.enrichedAlbumCount === 1 ? '' : 's'}.
							</p>
						{/if}
						{#if enrichmentDiagnostics}
							<p class="mt-2 text-xs text-amber-100/90">
								Enrichment queries: {enrichmentDiagnostics.queryCount}/{enrichmentDiagnostics.queryBudget}
								{#if enrichmentDiagnostics.budgetExhausted}
									(query budget reached)
								{/if}
							</p>
							{#if enrichmentDiagnostics.duplicateQueriesSkipped > 0}
								<p class="mt-1 text-xs text-amber-100/90">
									Duplicate queries skipped: {enrichmentDiagnostics.duplicateQueriesSkipped}
								</p>
							{/if}
							{#if zeroResultEnrichmentPasses > 0}
								<p class="mt-1 text-xs text-amber-100/90">
									{zeroResultEnrichmentPasses} enrichment quer{zeroResultEnrichmentPasses === 1 ? 'y returned' : 'ies returned'} no album results.
								</p>
							{/if}
							{#if recentMeaningfulEnrichmentPasses.length > 0}
								<div class="mt-2 space-y-1 text-xs text-amber-100/90">
									{#each recentMeaningfulEnrichmentPasses as pass, index (`${pass.name}-${pass.query}-${index}`)}
										<p class="truncate">
											{formatEnrichmentPassName(pass.name)}:
											{pass.accepted}/{pass.returned}
											{#if pass.total !== undefined}
												(of {pass.total})
											{/if}
											matched
											{#if pass.newlyAdded > 0}
												, +{pass.newlyAdded} added
											{/if}
											{#if formatEnrichmentPassStatus(pass)}
												({formatEnrichmentPassStatus(pass)})
											{/if}
										</p>
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				{:else if discographyInfo?.enrichedAlbumCount && discographyInfo.enrichedAlbumCount > 0}
					<div class="mt-3 rounded-lg border border-emerald-800/40 bg-emerald-900/15 p-3 text-xs text-emerald-200">
						<p>
							Enrichment added {discographyInfo.enrichedAlbumCount} album{discographyInfo.enrichedAlbumCount === 1 ? '' : 's'}
							beyond the source artist payload.
						</p>
					</div>
				{/if}
				{#if discographyError}
					<p class="mt-2 text-sm text-red-400" role="alert">{discographyError}</p>
				{/if}
				{#if discography.length > 0}
					<div class="mt-6 space-y-8">
						{#if duplicateCollapsedCount > 0 || filteredOutCount > 0}
							<p class="text-xs text-gray-500">
									{#if duplicateCollapsedCount > 0}
										Merged {duplicateCollapsedCount} duplicate resolution variant{duplicateCollapsedCount === 1 ? '' : 's'}.
									{/if}
									{#if filteredOutCount > 0}
										Filtered out {filteredOutCount} release{filteredOutCount === 1 ? '' : 's'} by selection settings.
									{/if}
								Showing one version per release for {formatQualityLabel(downloadQuality)} quality preference.
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
											class="rounded-full border border-gray-700 bg-gray-900/70 px-2.5 py-1 text-xs text-gray-300"
										>
											{section.entries.length}
										</span>
									</div>
										<div class="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
											{#each section.entries as entry (`${entry.key}:${downloadQuality}`)}
												{@const album = entry.representative}
												{@const hasOfficialTidalSource = entry.versions.some(
													(version) => version.discographySource === 'official_tidal'
												)}
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
												{@const coverImageUrl = coverImageCandidates[0] ?? ''}
												{@const albumDownloadState =
													albumDownloadStates[album.id] ??
													createDefaultAlbumDownloadState(album.numberOfTracks ?? 0)}
												{@const canCancelAlbumDownload = isAlbumQueueDownloadCancellable(
													albumDownloadState
												)}
												{@const albumInLibrary = albumLibraryPresence[album.id]?.exists === true}
												<div
													class="group relative flex h-full flex-col rounded-xl border border-gray-800 bg-gray-900/40 p-4 text-center transition-colors hover:border-blue-700 hover:bg-gray-900"
												>
												{#if hasOfficialTidalSource}
													<span
														class="absolute top-3 left-3 z-30 rounded-full border border-emerald-600/60 bg-emerald-900/70 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-200"
														title="Loaded from official TIDAL API enrichment"
													>
														TIDAL
													</span>
												{/if}
												{#if albumInLibrary}
													<span
														class="absolute top-9 left-3 z-20 rounded-full border border-blue-500/60 bg-blue-900/70 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-blue-100"
														title="Already in local library"
													>
														IN LIBRARY
													</span>
												{/if}
												<button
													onclick={(event) =>
														canCancelAlbumDownload
															? cancelAlbumQueueDownload(album.id, event)
															: handleAlbumDownload(album, event)}
													type="button"
													class="absolute top-3 right-3 z-40 flex items-center justify-center rounded-full bg-black/50 p-2 text-gray-200 backdrop-blur-md transition-colors hover:bg-blue-600/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
													disabled={
														isDownloadingDiscography ||
														albumDownloadState.status === 'submitting' ||
														(albumInLibrary && albumDownloadState.status === 'idle')
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
												<a
													href={`/album/${album.id}`}
													class="flex flex-1 flex-col items-center gap-4 rounded-lg text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900"
													>
														<div
															class="mx-auto aspect-square w-full max-w-[220px] overflow-hidden rounded-lg bg-gray-800"
														>
															{#if coverImageUrl && !albumCoverFailures[album.id]}
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
																	class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
																	loading="lazy"
																	decoding="async"
																/>
														{:else}
															<div
																class="flex h-full w-full items-center justify-center text-sm text-gray-500"
															>
																No artwork
															</div>
														{/if}
													</div>
													<div class="w-full">
														<h3
															class="truncate text-lg font-semibold text-balance text-white group-hover:text-blue-400"
														>
															{album.title}
														</h3>
														{#if formatAlbumMeta(album)}
															<p class="mt-1 text-sm text-gray-400">{formatAlbumMeta(album)}</p>
														{/if}
														<p class="mt-1 text-xs text-gray-500">
															Quality: {formatQualityLabel(downloadQuality)}
														</p>
													</div>
												</a>
												{#if albumDownloadState.status === 'queued'}
													<p class="mt-3 text-xs text-blue-300">
														Queued on server…
													</p>
												{:else if albumDownloadState.downloading}
													<p class="mt-3 text-xs text-blue-300">
														Downloading
														{#if albumDownloadState.total}
															{albumDownloadState.completed ?? 0}/{displayTrackTotal(
																albumDownloadState.total ?? 0
															)}
														{:else}
															{albumDownloadState.completed ?? 0}
														{/if}
														tracks…
													</p>
												{:else if albumDownloadState.status === 'completed'}
													<p class="mt-3 text-xs text-emerald-300">Download completed.</p>
												{:else if albumDownloadState.status === 'cancelled'}
													<p class="mt-3 text-xs text-amber-300">Download stopped.</p>
												{:else if albumDownloadState.status === 'paused'}
													<p class="mt-3 text-xs text-amber-300">Download paused.</p>
												{:else if albumDownloadState.error}
													<p class="mt-3 text-xs text-red-400" role="alert">
														{albumDownloadState.error}
													</p>
												{:else if albumInLibrary}
													<p class="mt-3 text-xs text-emerald-300">Already in local library.</p>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}
						{/each}
					</div>
				{:else if filtersHideAllDiscography}
					<div
						class="mt-6 space-y-3 rounded-lg border border-amber-700/40 bg-amber-900/20 p-6 text-sm text-amber-200"
					>
						<p>Current discography filters hide all releases.</p>
						<p class="text-xs text-amber-100/90">
							Tip: keep both “Explicit” and “Non-explicit” enabled if you want all editions.
						</p>
						<div>
							<button
								type="button"
								onclick={resetDiscographyFilters}
								class="rounded-full border border-amber-500/60 bg-amber-700/20 px-3 py-1 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-700/30"
							>
								Reset discography filters
							</button>
						</div>
					</div>
				{:else}
					<div
						class="mt-6 rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400"
					>
						<p>Discography information isn&apos;t available right now.</p>
					</div>
				{/if}
			</section>
		</div>

		{#if artist.url}
			<a
				href={artist.url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-block text-sm text-blue-400 transition-colors hover:text-blue-300"
			>
				View profile →
			</a>
		{/if}
	</div>
{/if}
