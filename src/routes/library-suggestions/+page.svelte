<script lang="ts">
	import { onMount } from 'svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';
	import { fetchMediaLibrarySuggestions, type MediaLibraryAlbumSuggestion, type MediaLibraryArtistSuggestion } from '$lib/utils/mediaLibraryClient';
	import { losslessAPI } from '$lib/api';
	import { getCoverCacheKey, getUnifiedCoverCandidates, prefetchCoverCandidates } from '$lib/utils/coverPipeline';
	import PageState from '$lib/components/ui/PageState.svelte';
	import EntityMediaCard from '$lib/components/ui/EntityMediaCard.svelte';
	import type { Album, Artist } from '$lib/types';
	import { Activity, Disc, Library, LoaderCircle, RefreshCw, User } from 'lucide-svelte';

	const meta = getRouteMeta('/library-suggestions');
	const LOCAL_ARTIST_LIMIT = 25;
	const LOCAL_ALBUM_LIMIT = 25;
	const SMART_SEED_LIMIT = 8;
	const SMART_ARTIST_LIMIT = 20;
	const SMART_ALBUM_LIMIT = 20;
	const SUGGESTIONS_CACHE_KEY = 'tidal-ui-library-suggestions-cache-v1';

	type SeedArtist = {
		artist: Artist;
		source: MediaLibraryArtistSuggestion;
		weight: number;
	};

	type ScoredArtist = {
		artist: Artist;
		score: number;
		seedMatches: number;
	};

	type ScoredAlbum = {
		album: Album;
		score: number;
		seedMatches: number;
	};

	type SuggestionsCacheSnapshot = {
		localArtists: MediaLibraryArtistSuggestion[];
		localAlbums: MediaLibraryAlbumSuggestion[];
		scannedAt: number | null;
		seedArtists: SeedArtist[];
		smartArtists: ScoredArtist[];
		smartAlbums: ScoredAlbum[];
		localError: string | null;
		smartError: string | null;
		suggestionSeed: number | null;
		smartGeneratedAt: number | null;
	};

	let refreshToken = 0;
	let refreshing = $state(false);
	let activeAction = $state<'refresh' | 'generate' | null>(null);
	let localError = $state<string | null>(null);
	let smartError = $state<string | null>(null);
	let localArtists = $state<MediaLibraryArtistSuggestion[]>([]);
	let localAlbums = $state<MediaLibraryAlbumSuggestion[]>([]);
	let scannedAt = $state<number | null>(null);
	let seedArtists = $state<SeedArtist[]>([]);
	let smartArtists = $state<ScoredArtist[]>([]);
	let smartAlbums = $state<ScoredAlbum[]>([]);
	let suggestionSeed = $state<number | null>(null);
	let smartGeneratedAt = $state<number | null>(null);

	const hasSmartSuggestions = $derived(smartArtists.length > 0 || smartAlbums.length > 0);
	const scannedAtText = $derived.by(() =>
		Number.isFinite(scannedAt) && scannedAt
			? new Date(scannedAt).toLocaleString()
			: 'not scanned yet'
	);
	const suggestionSeedText = $derived.by(() =>
		typeof suggestionSeed === 'number' && Number.isFinite(suggestionSeed)
			? String(suggestionSeed)
			: 'not generated yet'
	);
	const smartGeneratedAtText = $derived.by(() =>
		Number.isFinite(smartGeneratedAt) && smartGeneratedAt
			? new Date(smartGeneratedAt).toLocaleString()
			: 'not generated yet'
	);

	onMount(() => {
		const restored = restoreSuggestionsFromCache();
		if (!restored) {
			void refreshSuggestions();
		}
	});

	function getCurrentSnapshot(): SuggestionsCacheSnapshot {
		return {
			localArtists: [...localArtists],
			localAlbums: [...localAlbums],
			scannedAt,
			seedArtists: [...seedArtists],
			smartArtists: [...smartArtists],
			smartAlbums: [...smartAlbums],
			localError,
			smartError,
			suggestionSeed,
			smartGeneratedAt
		};
	}

	function applySnapshot(snapshot: SuggestionsCacheSnapshot): void {
		localArtists = Array.isArray(snapshot.localArtists) ? snapshot.localArtists : [];
		localAlbums = Array.isArray(snapshot.localAlbums) ? snapshot.localAlbums : [];
		scannedAt = typeof snapshot.scannedAt === 'number' && Number.isFinite(snapshot.scannedAt)
			? snapshot.scannedAt
			: null;
		seedArtists = Array.isArray(snapshot.seedArtists) ? snapshot.seedArtists : [];
		smartArtists = Array.isArray(snapshot.smartArtists) ? snapshot.smartArtists : [];
		smartAlbums = Array.isArray(snapshot.smartAlbums) ? snapshot.smartAlbums : [];
		localError = snapshot.localError ?? null;
		smartError = snapshot.smartError ?? null;
		suggestionSeed = typeof snapshot.suggestionSeed === 'number' && Number.isFinite(snapshot.suggestionSeed)
			? snapshot.suggestionSeed
			: null;
		smartGeneratedAt = typeof snapshot.smartGeneratedAt === 'number' && Number.isFinite(snapshot.smartGeneratedAt)
			? snapshot.smartGeneratedAt
			: null;
	}

	function persistSuggestionsToCache(): void {
		if (typeof window === 'undefined') {
			return;
		}
		try {
			const snapshot = getCurrentSnapshot();
			sessionStorage.setItem(SUGGESTIONS_CACHE_KEY, JSON.stringify(snapshot));
		} catch (error) {
			console.warn('[Library Suggestions] Failed to persist cache:', error);
		}
	}

	function restoreSuggestionsFromCache(): boolean {
		if (typeof window === 'undefined') {
			return false;
		}
		try {
			const raw = sessionStorage.getItem(SUGGESTIONS_CACHE_KEY);
			if (!raw) {
				return false;
			}
			const parsed = JSON.parse(raw) as SuggestionsCacheSnapshot | null;
			if (!parsed || typeof parsed !== 'object') {
				return false;
			}
			const hasRenderableState =
				(Array.isArray(parsed.localArtists) && parsed.localArtists.length > 0) ||
				(Array.isArray(parsed.localAlbums) && parsed.localAlbums.length > 0) ||
				(Array.isArray(parsed.smartArtists) && parsed.smartArtists.length > 0) ||
				(Array.isArray(parsed.smartAlbums) && parsed.smartAlbums.length > 0) ||
				(typeof parsed.scannedAt === 'number' && Number.isFinite(parsed.scannedAt)) ||
				(typeof parsed.suggestionSeed === 'number' && Number.isFinite(parsed.suggestionSeed)) ||
				typeof parsed.localError === 'string' ||
				typeof parsed.smartError === 'string';
			if (!hasRenderableState) {
				return false;
			}
			applySnapshot(parsed);
			return true;
		} catch (error) {
			console.warn('[Library Suggestions] Failed to restore cache:', error);
			return false;
		}
	}

	function normalizeToken(value: string | null | undefined): string {
		if (!value) return '';
		return value
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();
	}

	function buildSearchHref(query: string, tab: 'artists' | 'albums'): string {
		const normalizedQuery = query.trim();
		if (!normalizedQuery) return '/';
		const params = new URLSearchParams({ q: normalizedQuery, tab });
		return `/?${params.toString()}`;
	}

	function getAlbumCoverSrc(cover: string | null | undefined): string | null {
		if (typeof cover !== 'string' || cover.trim().length === 0) {
			return null;
		}
		return losslessAPI.getCoverUrl(cover, '640') || null;
	}

	function getAlbumCoverCacheKey(album: Album): string | null {
		const coverId = typeof album.cover === 'string' ? album.cover.trim() : '';
		if (!coverId) {
			return null;
		}
		return getCoverCacheKey({
			coverId,
			size: '640',
			proxy: true,
			overrideKey: `library-suggestions:album:${album.id}`
		});
	}

	function getAlbumCoverCandidates(cover: string | null | undefined): string[] {
		const coverId = typeof cover === 'string' ? cover.trim() : '';
		if (!coverId) {
			return [];
		}
		return getUnifiedCoverCandidates({
			coverId,
			size: '640',
			proxy: true,
			includeLowerSizes: true
		});
	}

	function getArtistPortraitSrc(picture: string | null | undefined): string | null {
		if (typeof picture !== 'string' || picture.trim().length === 0) {
			return null;
		}
		return losslessAPI.getArtistPictureUrl(picture) || null;
	}

	$effect(() => {
		if (smartAlbums.length === 0) {
			return;
		}
		const batch = smartAlbums
			.slice(0, 24)
			.map((recommendation) => {
				const album = recommendation.album;
				const cacheKey = getAlbumCoverCacheKey(album);
				const candidates = getAlbumCoverCandidates(album.cover);
				if (!cacheKey || candidates.length === 0) {
					return null;
				}
				return { cacheKey, candidates };
			})
			.filter((entry): entry is { cacheKey: string; candidates: string[] } => entry !== null);
		if (batch.length === 0) {
			return;
		}
		void prefetchCoverCandidates(batch).catch(() => {
			// failures are tracked in cover pipeline caches
		});
	});

	function scoreArtistMatch(candidate: Artist, expectedArtistName: string): number {
		const expected = normalizeToken(expectedArtistName);
		const candidateName = normalizeToken(candidate.name);
		if (!candidateName) return Number.NEGATIVE_INFINITY;
		let score = 0;
		if (expected.length > 0) {
			if (candidateName === expected) {
				score += 1000;
			} else if (
				candidateName.startsWith(expected) ||
				expected.startsWith(candidateName)
			) {
				score += 420;
			} else if (
				candidateName.includes(expected) ||
				expected.includes(candidateName)
			) {
				score += 210;
			}
		}
		score += Math.max(0, Math.trunc((candidate.popularity ?? 0) / 5));
		return score;
	}

	function pickBestArtistMatch(items: Artist[], expectedArtistName: string): Artist | null {
		if (!Array.isArray(items) || items.length === 0) {
			return null;
		}
		let best: Artist | null = null;
		let bestScore = Number.NEGATIVE_INFINITY;
		for (const item of items) {
			const score = scoreArtistMatch(item, expectedArtistName);
			if (score > bestScore) {
				best = item;
				bestScore = score;
			}
		}
		return best;
	}

	function getAlbumLibraryKey(artistName: string | null | undefined, albumTitle: string | null | undefined): string {
		return `${normalizeToken(artistName)}::${normalizeToken(albumTitle)}`;
	}

	type RandomFn = () => number;

	function createSuggestionSeed(): number {
		if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
			const seedBuffer = new Uint32Array(1);
			crypto.getRandomValues(seedBuffer);
			return seedBuffer[0] >>> 0;
		}
		return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
	}

	function createSeededRandom(seed: number): RandomFn {
		let t = seed >>> 0;
		return () => {
			t += 0x6d2b79f5;
			let result = Math.imul(t ^ (t >>> 15), 1 | t);
			result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
			return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
		};
	}

	function randomInt(maxExclusive: number, random: RandomFn): number {
		if (maxExclusive <= 1) return 0;
		return Math.floor(random() * maxExclusive);
	}

	function pickWeightedRandomIndex(weights: number[], random: RandomFn): number {
		if (weights.length === 0) return -1;
		const totalWeight = weights.reduce(
			(total, weight) => total + (Number.isFinite(weight) && weight > 0 ? weight : 0),
			0
		);
		if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
			return randomInt(weights.length, random);
		}
		let threshold = random() * totalWeight;
		for (let index = 0; index < weights.length; index += 1) {
			const candidateWeight = weights[index];
			const weight =
				typeof candidateWeight === 'number' && Number.isFinite(candidateWeight) && candidateWeight > 0
					? candidateWeight
					: 0;
			threshold -= weight;
			if (threshold <= 0) {
				return index;
			}
		}
		return weights.length - 1;
	}

	function sampleSeedArtistCandidates(
		artists: MediaLibraryArtistSuggestion[],
		limit: number,
		random: RandomFn
	): MediaLibraryArtistSuggestion[] {
		const candidatePool = [...artists]
			.map((candidate) => ({
				candidate,
				baseWeight: Math.max(1, candidate.trackCount) + Math.max(0, candidate.albumCount) * 1.5
			}))
			.sort((a, b) => {
				if (b.baseWeight !== a.baseWeight) return b.baseWeight - a.baseWeight;
				return a.candidate.artistName.localeCompare(b.candidate.artistName);
			})
			.slice(0, Math.max(limit * 2, SMART_SEED_LIMIT * 4));

		const selected: MediaLibraryArtistSuggestion[] = [];
		const workingPool = [...candidatePool];
		while (selected.length < limit && workingPool.length > 0) {
			const weights = workingPool.map((entry, index) => {
				const rankFactor = (workingPool.length - index) / workingPool.length;
				const randomJitter = random() * Math.max(2, entry.baseWeight * 0.35);
				return entry.baseWeight * (0.75 + rankFactor * 0.5) + randomJitter;
			});
			const pickedIndex = pickWeightedRandomIndex(weights, random);
			if (pickedIndex < 0 || pickedIndex >= workingPool.length) {
				break;
			}
			selected.push(workingPool[pickedIndex]?.candidate ?? workingPool[0].candidate);
			workingPool.splice(pickedIndex, 1);
		}
		return selected;
	}

	async function resolveSeedArtists(
		artists: MediaLibraryArtistSuggestion[],
		random: RandomFn
	): Promise<SeedArtist[]> {
		const rankedCandidates = sampleSeedArtistCandidates(artists, SMART_SEED_LIMIT * 4, random);
		const resolved: SeedArtist[] = [];
		const seenArtistIds = new Set<number>();
		for (const candidate of rankedCandidates) {
			if (resolved.length >= SMART_SEED_LIMIT) {
				break;
			}
			const query = (candidate.searchQuery || candidate.artistName || '').trim();
			if (!query) {
				continue;
			}
			try {
				const response = await losslessAPI.searchArtists(query);
				const match = pickBestArtistMatch(response.items ?? [], candidate.artistName);
				if (!match || !Number.isFinite(match.id) || seenArtistIds.has(match.id)) {
					continue;
				}
				seenArtistIds.add(match.id);
				const weight = Math.max(1, candidate.trackCount) + Math.max(0, candidate.albumCount) * 1.5;
				resolved.push({
					artist: match,
					source: candidate,
					weight
				});
			} catch (error) {
				console.warn(`[Library Suggestions] Failed to resolve seed artist "${query}":`, error);
			}
		}
		return resolved;
	}

	async function buildSmartSuggestions(
		artists: MediaLibraryArtistSuggestion[],
		albums: MediaLibraryAlbumSuggestion[],
		token: number,
		seed: number
	): Promise<void> {
		smartError = null;
		const random = createSeededRandom(seed);
		const resolvedSeeds = await resolveSeedArtists(artists, random);
		if (token !== refreshToken) return;
		suggestionSeed = seed >>> 0;
		smartGeneratedAt = Date.now();
		seedArtists = resolvedSeeds;
		if (resolvedSeeds.length === 0) {
			smartArtists = [];
			smartAlbums = [];
			smartError = 'No reliable seed artists found in your library yet.';
			persistSuggestionsToCache();
			return;
		}

		const localArtistNames = new Set(artists.map((entry) => normalizeToken(entry.artistName)));
		const localAlbumKeys = new Set(
			albums.map((entry) => getAlbumLibraryKey(entry.artistName, entry.albumTitle))
		);
		const artistScores = new Map<number, ScoredArtist>();
		const albumScores = new Map<number, ScoredAlbum>();
		let successfulSeeds = 0;

		for (const seed of resolvedSeeds) {
			if (token !== refreshToken) return;
			try {
				const recommendations = await losslessAPI.getArtistRecommendations(seed.artist.id);
				successfulSeeds += 1;
				const weight = Math.max(1, seed.weight);
				for (const recommendationArtist of recommendations.artists ?? []) {
					if (!Number.isFinite(recommendationArtist.id)) continue;
					if (recommendationArtist.id === seed.artist.id) continue;
					if (localArtistNames.has(normalizeToken(recommendationArtist.name))) continue;
					const current = artistScores.get(recommendationArtist.id);
					if (current) {
						current.score += weight;
						current.seedMatches += 1;
					} else {
						artistScores.set(recommendationArtist.id, {
							artist: recommendationArtist,
							score: weight,
							seedMatches: 1
						});
					}
				}
				for (const recommendationAlbum of recommendations.albums ?? []) {
					if (!Number.isFinite(recommendationAlbum.id)) continue;
					const artistName = recommendationAlbum.artist?.name ?? recommendationAlbum.artists?.[0]?.name ?? '';
					const albumKey = getAlbumLibraryKey(artistName, recommendationAlbum.title);
					if (localAlbumKeys.has(albumKey)) continue;
					const current = albumScores.get(recommendationAlbum.id);
					if (current) {
						current.score += weight;
						current.seedMatches += 1;
					} else {
						albumScores.set(recommendationAlbum.id, {
							album: recommendationAlbum,
							score: weight,
							seedMatches: 1
						});
					}
				}
			} catch (error) {
				console.warn(
					`[Library Suggestions] Failed to load recommendations for seed artist ${seed.artist.id}:`,
					error
				);
			}
		}

		if (token !== refreshToken) return;
		const rankedArtists = Array.from(artistScores.values()).sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			const popularityA = a.artist.popularity ?? 0;
			const popularityB = b.artist.popularity ?? 0;
			if (popularityB !== popularityA) return popularityB - popularityA;
			return a.artist.name.localeCompare(b.artist.name);
		});
		const rankedAlbums = Array.from(albumScores.values()).sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			const popularityA = a.album.popularity ?? 0;
			const popularityB = b.album.popularity ?? 0;
			if (popularityB !== popularityA) return popularityB - popularityA;
			return a.album.title.localeCompare(b.album.title);
		});

		smartArtists = rankedArtists.slice(0, SMART_ARTIST_LIMIT);
		smartAlbums = rankedAlbums.slice(0, SMART_ALBUM_LIMIT);
		if (successfulSeeds === 0) {
			smartError = 'API recommendations are currently unavailable.';
		} else if (smartArtists.length === 0 && smartAlbums.length === 0) {
			smartError = 'No new recommendations available from current seed artists.';
		}
		persistSuggestionsToCache();
	}

	async function refreshSuggestions(force = false): Promise<void> {
		const token = ++refreshToken;
		refreshing = true;
		activeAction = 'refresh';
		localError = null;
		smartError = null;
		try {
			const result = await fetchMediaLibrarySuggestions({
				artistLimit: LOCAL_ARTIST_LIMIT,
				albumLimit: LOCAL_ALBUM_LIMIT,
				force
			});
			if (token !== refreshToken) return;
			if (!result.success) {
				throw new Error(result.error || 'Failed to load media library suggestions');
			}
			localArtists = Array.isArray(result.artists) ? result.artists : [];
			localAlbums = Array.isArray(result.albums) ? result.albums : [];
			scannedAt = typeof result.scannedAt === 'number' ? result.scannedAt : null;
			await buildSmartSuggestions(localArtists, localAlbums, token, createSuggestionSeed());
		} catch (error) {
			if (token !== refreshToken) return;
			localArtists = [];
			localAlbums = [];
			scannedAt = null;
			seedArtists = [];
			smartArtists = [];
			smartAlbums = [];
			suggestionSeed = null;
			smartGeneratedAt = null;
			localError =
				error instanceof Error && error.message
					? error.message
					: 'Failed to load media library suggestions.';
			smartError = localError;
			persistSuggestionsToCache();
		} finally {
			if (token === refreshToken) {
				refreshing = false;
				activeAction = null;
			}
		}
	}

	async function generateNewSuggestions(): Promise<void> {
		if (localArtists.length === 0 && localAlbums.length === 0) {
			await refreshSuggestions(false);
			return;
		}
		const token = ++refreshToken;
		refreshing = true;
		activeAction = 'generate';
		smartError = null;
		try {
			await buildSmartSuggestions(localArtists, localAlbums, token, createSuggestionSeed());
		} catch (error) {
			if (token !== refreshToken) return;
			smartError =
				error instanceof Error && error.message
					? error.message
					: 'Failed to generate new recommendations.';
			persistSuggestionsToCache();
		} finally {
			if (token === refreshToken) {
				refreshing = false;
				activeAction = null;
			}
		}
	}
</script>

<svelte:head>
	<title>{meta?.title ?? 'Library Suggestions'} | BiniLossless</title>
</svelte:head>

<section
	class="ui-page library-suggestions-page"
	data-ui-archetype="collection"
	data-ui-route="library-suggestions"
>
	<header class="ui-page__header" data-ui-block="page-header">
		<div class="ui-page__title-group">
			<p class="ui-page__eyebrow">Navigation</p>
			<h1 class="ui-page__title">{meta?.title ?? 'Library Suggestions'}</h1>
			<p class="ui-page__subtitle">
				{meta?.subtitle ?? 'API recommendation picks, seeded from your local library.'}
			</p>
		</div>
		<div class="ui-page__actions" data-ui-block="filters-actions">
			<button
				type="button"
				class="ui-chip-button"
				onclick={generateNewSuggestions}
				disabled={refreshing}
			>
				{#if refreshing && activeAction === 'generate'}
					<span class="library-suggestions-page__spinner" aria-hidden="true">
						<LoaderCircle size={14} />
					</span>
				{:else}
					<Activity size={14} />
				{/if}
				<span>{refreshing && activeAction === 'generate' ? 'Generating…' : 'Generate New Suggestions'}</span>
			</button>
			<button
				type="button"
				class="ui-chip-button"
				onclick={() => refreshSuggestions(true)}
				disabled={refreshing}
			>
				{#if refreshing && activeAction === 'refresh'}
					<span class="library-suggestions-page__spinner" aria-hidden="true">
						<LoaderCircle size={14} />
					</span>
				{:else}
					<RefreshCw size={14} />
				{/if}
				<span>{refreshing && activeAction === 'refresh' ? 'Refreshing…' : 'Refresh Library Index'}</span>
			</button>
		</div>
	</header>

	<section class="ui-surface-card library-suggestions-section" data-ui-block="results">
		<div class="library-suggestions-section__header">
			<div>
				<p class="library-suggestions-section__eyebrow">Intelligent Picks</p>
				<h2>API Recommendations Based On Your Library</h2>
			</div>
		</div>
		{#if seedArtists.length > 0}
			<div class="library-suggestions-seeds">
				<p class="library-suggestions-seeds__label">Seed artists</p>
				<p class="library-suggestions-seeds__meta">
					Random seed: <code>{suggestionSeedText}</code>
					{#if Number.isFinite(smartGeneratedAt) && smartGeneratedAt}
						<span> • Generated {smartGeneratedAtText}</span>
					{/if}
				</p>
				<div class="library-suggestions-seeds__chips">
					{#each seedArtists as seed (`${seed.artist.id}:${seed.source.artistDir}`)}
						<a class="library-suggestions-seed-chip" href={`/artist/${seed.artist.id}`}>
							{seed.artist.name}
						</a>
					{/each}
				</div>
			</div>
		{/if}

		{#if localError}
			<PageState
				kind="error"
				title="Unable to build API recommendations"
				message={localError}
				actionLabel="Retry"
				onAction={() => refreshSuggestions(true)}
			/>
		{:else if smartError && !hasSmartSuggestions}
			<PageState
				kind="empty"
				title="No smart recommendations yet"
				message={smartError}
				actionLabel="Generate New"
				onAction={generateNewSuggestions}
			/>
		{:else if !hasSmartSuggestions}
			<PageState
				kind="loading"
				title="Building smart recommendations"
				message="Fetching artist-mix recommendations from API seeds."
			/>
		{:else}
			<div class="library-suggestions-columns">
				<div class="library-suggestions-column">
					<div class="library-suggestions-column__header">
						<User size={16} />
						<h3>Recommended Artists</h3>
					</div>
					<ol class="ui-media-grid ui-media-grid--artists">
						{#each smartArtists as recommendation (`artist:${recommendation.artist.id}`)}
							<li>
								<EntityMediaCard
									type="artist"
									href={`/artist/${recommendation.artist.id}`}
									title={recommendation.artist.name}
									meta={`Score ${recommendation.score.toFixed(1)} · ${recommendation.seedMatches} seed${recommendation.seedMatches === 1 ? '' : 's'}`}
									imageSrc={getArtistPortraitSrc(recommendation.artist.picture)}
									imageAlt={`Portrait of ${recommendation.artist.name}`}
									links={[
										{ href: `/artist/${recommendation.artist.id}`, label: 'Artist Page' },
										{
											href: buildSearchHref(recommendation.artist.name, 'artists'),
											label: 'Search'
										}
									]}
								/>
							</li>
						{/each}
					</ol>
				</div>
				<div class="library-suggestions-column">
					<div class="library-suggestions-column__header">
						<Disc size={16} />
						<h3>Recommended Albums</h3>
					</div>
					<ol class="ui-media-grid ui-media-grid--albums">
						{#each smartAlbums as recommendation (`album:${recommendation.album.id}`)}
							{@const recommendedAlbumArtistId =
								recommendation.album.artist &&
								Number.isFinite(recommendation.album.artist.id)
									? recommendation.album.artist.id
									: null}
							{@const recommendedAlbumArtistName =
								recommendation.album.artist?.name || recommendation.album.artists?.[0]?.name || ''}
							{@const recommendedAlbumCoverCacheKey = getAlbumCoverCacheKey(recommendation.album)}
							{@const recommendedAlbumCoverCandidates = getAlbumCoverCandidates(recommendation.album.cover)}
							<li>
								<EntityMediaCard
									type="album"
									href={`/album/${recommendation.album.id}`}
									title={recommendation.album.title}
									subtitle={recommendedAlbumArtistName}
									meta={`Score ${recommendation.score.toFixed(1)} · ${recommendation.seedMatches} seed${recommendation.seedMatches === 1 ? '' : 's'}`}
									imageSrc={getAlbumCoverSrc(recommendation.album.cover)}
									imageAlt={`Cover for ${recommendation.album.title}`}
									coverCacheKey={recommendedAlbumCoverCacheKey}
									coverCandidates={recommendedAlbumCoverCandidates}
									links={[
										{ href: `/album/${recommendation.album.id}`, label: 'Album Page' },
										{
											href: recommendedAlbumArtistId
												? `/artist/${recommendedAlbumArtistId}`
												: buildSearchHref(
														`${recommendedAlbumArtistName} ${recommendation.album.title}`,
														'albums'
													),
											label: recommendedAlbumArtistId ? 'Artist Page' : 'Search'
										}
									]}
								/>
							</li>
						{/each}
					</ol>
				</div>
			</div>
		{/if}
	</section>

	<div class="ui-surface-grid library-suggestions-overview" data-ui-block="results">
		<article class="ui-surface-card library-suggestions-overview__card">
			<div class="library-suggestions-overview__heading">
				<Library size={16} />
				<p>Local Index</p>
			</div>
			<p class="library-suggestions-overview__value">{localArtists.length + localAlbums.length}</p>
			<p class="library-suggestions-overview__meta">
				{localArtists.length} artists · {localAlbums.length} albums
			</p>
		</article>
		<article class="ui-surface-card library-suggestions-overview__card">
			<div class="library-suggestions-overview__heading">
				<Activity size={16} />
				<p>Smart API Picks</p>
			</div>
			<p class="library-suggestions-overview__value">{smartArtists.length + smartAlbums.length}</p>
			<p class="library-suggestions-overview__meta">
				{smartArtists.length} artists · {smartAlbums.length} albums
			</p>
		</article>
		<article class="ui-surface-card library-suggestions-overview__card">
			<div class="library-suggestions-overview__heading">
				<RefreshCw size={16} />
				<p>Index Timestamp</p>
			</div>
			<p class="library-suggestions-overview__value library-suggestions-overview__value--small">
				{scannedAtText}
			</p>
		</article>
		<article class="ui-surface-card library-suggestions-overview__card">
			<div class="library-suggestions-overview__heading">
				<Activity size={16} />
				<p>Suggestion Seed</p>
			</div>
			<p class="library-suggestions-overview__value library-suggestions-overview__value--small">
				{suggestionSeedText}
			</p>
			<p class="library-suggestions-overview__meta">{smartGeneratedAtText}</p>
		</article>
	</div>
</section>

<style>
	.library-suggestions-page {
		gap: 0.95rem;
	}

	.library-suggestions-page__spinner {
		animation: library-suggestions-spin 900ms linear infinite;
	}

	.library-suggestions-overview {
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
	}

	.library-suggestions-overview__card {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.library-suggestions-overview__heading {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.86rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(214, 214, 214, 0.82);
	}

	.library-suggestions-overview__heading p {
		margin: 0;
	}

	.library-suggestions-overview__value {
		margin: 0;
		font-size: 1.44rem;
		font-weight: 700;
	}

	.library-suggestions-overview__value--small {
		font-size: 0.98rem;
		line-height: 1.35;
	}

	.library-suggestions-overview__meta {
		margin: 0;
		font-size: 0.88rem;
		color: rgba(209, 209, 209, 0.85);
	}

	.library-suggestions-section {
		display: flex;
		flex-direction: column;
		gap: 0.86rem;
	}

	.library-suggestions-section__header h2 {
		margin: 0;
		font-size: 1.2rem;
	}

	.library-suggestions-section__eyebrow {
		margin: 0 0 0.2rem;
		font-size: 0.82rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: rgba(204, 204, 204, 0.75);
	}

	.library-suggestions-columns {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.92rem;
	}

	.library-suggestions-column {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.library-suggestions-column__header {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.library-suggestions-column__header h3 {
		margin: 0;
		font-size: 1.08rem;
	}

	.library-suggestions-seeds {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.library-suggestions-seeds__label {
		margin: 0;
		font-size: 0.84rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(194, 194, 194, 0.76);
	}

	.library-suggestions-seeds__meta {
		margin: 0;
		font-size: 0.86rem;
		color: rgba(212, 212, 212, 0.78);
	}

	.library-suggestions-seeds__meta code {
		padding: 0.08rem 0.35rem;
		border-radius: 0.32rem;
		background: rgba(255, 255, 255, 0.08);
		font-size: 0.82rem;
	}

	.library-suggestions-seeds__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.library-suggestions-seed-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.32rem 0.62rem;
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(212, 212, 212, 0.38);
		background: rgba(18, 18, 18, 0.55);
		font-size: 0.88rem;
		text-decoration: none;
		color: inherit;
	}

	@media (max-width: 1024px) {
		.library-suggestions-columns {
			grid-template-columns: 1fr;
		}
	}

	@keyframes library-suggestions-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
