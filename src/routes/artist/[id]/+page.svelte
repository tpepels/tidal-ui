<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { losslessAPI } from '$lib/api';
	import { downloadAlbum } from '$lib/downloads';
	import type { Album, ArtistDetails, AudioQuality } from '$lib/types';
	import TopTracksGrid from '$lib/components/TopTracksGrid.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import { groupDiscography } from '$lib/utils/discography';
	import { scoreAlbumForSelection } from '$lib/utils/albumSelection';
	import { ArrowLeft, User, Download, LoaderCircle } from 'lucide-svelte';

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
	const discographyEntries = $derived(groupDiscography(rawDiscography, downloadQuality));
	const discography = $derived(discographyEntries.map((entry) => entry.representative));
	const discographyAlbums = $derived(
		discographyEntries.filter((entry) => entry.section === 'album')
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
		downloading: boolean;
		completed: number;
		total: number;
		error: string | null;
		failedTracks: number;
	};

	let isDownloadingDiscography = $state(false);
	let discographyProgress = $state({ completed: 0, total: 0 });
	let discographyError = $state<string | null>(null);
	let albumDownloadStates = $state<Record<number, AlbumDownloadState>>({});
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
	const COVER_CANDIDATE_DELIMITER = '\n';

	$effect(() => {
		const id = Number(artistId);
		if (!Number.isFinite(id) || id <= 0) {
			activeRequestToken += 1;
			beginCoverHydrationGeneration();
			artist = null;
			artistImage = null;
			error = 'Invalid artist id';
			isLoading = false;
			return;
		}
		void loadArtist(id);
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
		return total && total > 0 ? total + 1 : (total ?? 0);
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
			const candidates = losslessAPI.getCoverUrlFallbacks(coverId, '640', {
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
		const hydratedCandidates = losslessAPI.getCoverUrlFallbacks(hydratedCover, '640', {
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

	function patchAlbumDownloadState(albumId: number, patch: Partial<AlbumDownloadState>) {
		const previous = albumDownloadStates[albumId] ?? {
			downloading: false,
			completed: 0,
			total: 0,
			error: null,
			failedTracks: 0
		};
		albumDownloadStates = {
			...albumDownloadStates,
			[albumId]: { ...previous, ...patch }
		};
	}

	async function handleAlbumDownload(album: Album, event?: MouseEvent) {
		event?.preventDefault();
		event?.stopPropagation();

		if (isDownloadingDiscography || albumDownloadStates[album.id]?.downloading) {
			return;
		}

		patchAlbumDownloadState(album.id, {
			downloading: true,
			completed: 0,
			total: album.numberOfTracks ?? 0,
			error: null
		});

		const quality = downloadQuality;

		try {
			let failedCount = 0;
			await downloadAlbum(
				album,
				quality,
				{
					onTotalResolved: (total) => {
						patchAlbumDownloadState(album.id, { total });
					},
					onTrackDownloaded: (completed, total) => {
						patchAlbumDownloadState(album.id, { completed, total });
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
			const finalState = albumDownloadStates[album.id];
			patchAlbumDownloadState(album.id, {
				downloading: false,
				completed: finalState?.total ?? finalState?.completed ?? 0,
				error:
					failedCount > 0
						? `${failedCount} track${failedCount > 1 ? 's' : ''} failed after 3 attempts`
						: null
			});
		} catch (err) {
			console.error('Failed to download album:', err);
			const message =
				err instanceof Error && err.message
					? err.message
					: 'Failed to download album. Please try again.';
			patchAlbumDownloadState(album.id, { downloading: false, error: message });
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

	async function loadArtist(id: number) {
		const requestToken = ++activeRequestToken;
		beginCoverHydrationGeneration();
		const cachedArtist = artistCacheStore.get(id);
		const hasCachedArtist = Boolean(cachedArtist);

		error = null;
		isDownloadingDiscography = false;
		discographyProgress = { completed: 0, total: 0 };
		discographyError = null;
		albumDownloadStates = {};
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
			const data = await losslessAPI.getArtist(id);
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
				error = err instanceof Error ? err.message : 'Failed to load artist';
				console.error('Failed to load artist:', err);
			}
		} finally {
			if (requestToken === activeRequestToken) {
				isLoading = false;
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
						{#if rawDiscography.length > discography.length}
							<p class="text-xs text-gray-500">
								Merged {rawDiscography.length - discography.length} duplicate resolution variants.
								Showing one version per release for selected download quality ({formatQualityLabel(downloadQuality)}).
							</p>
						{/if}
						{#each [
							{ id: 'album', title: 'Albums', entries: discographyAlbums },
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
												{@const coverImageUrl = coverImageCandidates[0] ?? ''}
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
												<button
													onclick={(event) => handleAlbumDownload(album, event)}
													type="button"
													class="absolute top-3 right-3 z-40 flex items-center justify-center rounded-full bg-black/50 p-2 text-gray-200 backdrop-blur-md transition-colors hover:bg-blue-600/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
													disabled={isDownloadingDiscography || albumDownloadStates[album.id]?.downloading}
													aria-label={`Download ${album.title}`}
												>
													{#if albumDownloadStates[album.id]?.downloading}
														<LoaderCircle size={16} class="animate-spin" />
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
												{#if albumDownloadStates[album.id]?.downloading}
													<p class="mt-3 text-xs text-blue-300">
														Downloading
														{#if albumDownloadStates[album.id]?.total}
															{albumDownloadStates[album.id]?.completed ?? 0}/{displayTrackTotal(
																albumDownloadStates[album.id]?.total ?? 0
															)}
														{:else}
															{albumDownloadStates[album.id]?.completed ?? 0}
														{/if}
														tracks…
													</p>
												{:else if albumDownloadStates[album.id]?.error}
													<p class="mt-3 text-xs text-red-400" role="alert">
														{albumDownloadStates[album.id]?.error}
													</p>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}
						{/each}
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
