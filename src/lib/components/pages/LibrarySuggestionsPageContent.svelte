<script lang="ts">
	import { onMount } from 'svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';
	import { fetchMediaLibrarySuggestions, type MediaLibraryAlbumSuggestion, type MediaLibraryArtistSuggestion } from '$lib/utils/mediaLibraryClient';
	import { losslessAPI } from '$lib/api';
	import { getCoverCacheKey, getUnifiedCoverCandidates, prefetchCoverCandidates } from '$lib/utils/coverPipeline';
	import {
		buildSearchHref,
		buildSmartSuggestions,
		createSuggestionSeed,
		createSuggestionsSnapshot,
		type ScoredAlbum,
		type ScoredArtist,
		type SeedArtist,
		type SuggestionsCacheSnapshot,
		LOCAL_ALBUM_LIMIT,
		LOCAL_ARTIST_LIMIT,
		parseSuggestionsSnapshot
	} from '$lib/features/library-suggestions/librarySuggestionsModel';
	import PageState from '$lib/components/ui/PageState.svelte';
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import MediaRow from '$lib/components/ui/MediaRow.svelte';
	import type { Album, Artist } from '$lib/types';
	import { Activity, Disc, Library, LoaderCircle, RefreshCw, User } from 'lucide-svelte';

	const meta = getRouteMeta('/library-suggestions');
	const SUGGESTIONS_CACHE_KEY = 'tidal-ui-library-suggestions-cache-v1';

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
	const sectionNavItems = $derived.by(() => [
		{ id: 'library-smart-picks', label: 'Recommendations', tone: 'secondary' as const },
		{ id: 'library-overview', label: 'Overview', tone: 'tertiary' as const }
	]);

	onMount(() => {
		const restored = restoreSuggestionsFromCache();
		if (!restored) {
			void refreshSuggestions();
		}
	});

	function getCurrentSnapshot(): SuggestionsCacheSnapshot {
		return createSuggestionsSnapshot({
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
		});
	}

	function applySnapshot(snapshot: SuggestionsCacheSnapshot): void {
		localArtists = snapshot.localArtists;
		localAlbums = snapshot.localAlbums;
		scannedAt = snapshot.scannedAt;
		seedArtists = snapshot.seedArtists;
		smartArtists = snapshot.smartArtists;
		smartAlbums = snapshot.smartAlbums;
		localError = snapshot.localError;
		smartError = snapshot.smartError;
		suggestionSeed = snapshot.suggestionSeed;
		smartGeneratedAt = snapshot.smartGeneratedAt;
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
			const parsed = parseSuggestionsSnapshot(sessionStorage.getItem(SUGGESTIONS_CACHE_KEY));
			if (!parsed) {
				return false;
			}
			applySnapshot(parsed);
			return true;
		} catch (error) {
			console.warn('[Library Suggestions] Failed to restore cache:', error);
			return false;
		}
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
			const smartSuggestionState = await buildSmartSuggestions({
				artists: localArtists,
				albums: localAlbums,
				seed: createSuggestionSeed(),
				searchArtists: (query) => losslessAPI.searchArtists(query),
				getArtistRecommendations: (artistId) => losslessAPI.getArtistRecommendations(artistId)
			});
			if (token !== refreshToken) return;
			seedArtists = smartSuggestionState.seedArtists;
			smartArtists = smartSuggestionState.smartArtists;
			smartAlbums = smartSuggestionState.smartAlbums;
			suggestionSeed = smartSuggestionState.suggestionSeed;
			smartGeneratedAt = smartSuggestionState.smartGeneratedAt;
			smartError = smartSuggestionState.smartError;
			persistSuggestionsToCache();
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
			const smartSuggestionState = await buildSmartSuggestions({
				artists: localArtists,
				albums: localAlbums,
				seed: createSuggestionSeed(),
				searchArtists: (query) => losslessAPI.searchArtists(query),
				getArtistRecommendations: (artistId) => losslessAPI.getArtistRecommendations(artistId)
			});
			if (token !== refreshToken) return;
			seedArtists = smartSuggestionState.seedArtists;
			smartArtists = smartSuggestionState.smartArtists;
			smartAlbums = smartSuggestionState.smartAlbums;
			suggestionSeed = smartSuggestionState.suggestionSeed;
			smartGeneratedAt = smartSuggestionState.smartGeneratedAt;
			smartError = smartSuggestionState.smartError;
			persistSuggestionsToCache();
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

	<PageSectionNav items={sectionNavItems} sticky={true} />

	<section
		id="library-smart-picks"
		class="ui-section-anchor ui-surface-card library-suggestions-section ui-perf-block"
		data-ui-block="results"
	>
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
					<ol class="library-suggestions-list ui-list-surface">
						{#each smartArtists as recommendation (`artist:${recommendation.artist.id}`)}
							<li>
								<MediaRow
									href={`/artist/${recommendation.artist.id}`}
									title={recommendation.artist.name}
									meta={`Score ${recommendation.score.toFixed(1)} · ${recommendation.seedMatches} seed${recommendation.seedMatches === 1 ? '' : 's'}`}
									description="Open artist or run a scoped search from this recommendation."
									imageSrc={getArtistPortraitSrc(recommendation.artist.picture)}
									imageAlt={`Portrait of ${recommendation.artist.name}`}
									circle={true}
									tone="secondary"
								>
									{#snippet bodyExtra()}
										<div class="ui-action-row">
											<a
												href={buildSearchHref(recommendation.artist.name, 'artists')}
												class="ui-chip-button ui-chip-button--compact"
											>
												Search
											</a>
										</div>
									{/snippet}
								</MediaRow>
							</li>
						{/each}
					</ol>
				</div>
				<div class="library-suggestions-column">
					<div class="library-suggestions-column__header">
						<Disc size={16} />
						<h3>Recommended Albums</h3>
					</div>
					<ol class="library-suggestions-list ui-list-surface">
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
								<MediaRow
									href={`/album/${recommendation.album.id}`}
									title={recommendation.album.title}
									subtitle={recommendedAlbumArtistName}
									meta={`Score ${recommendation.score.toFixed(1)} · ${recommendation.seedMatches} seed${recommendation.seedMatches === 1 ? '' : 's'}`}
									description="Open the album or jump to the matching artist/search context."
									imageAlt={`Cover for ${recommendation.album.title}`}
									coverCacheKey={recommendedAlbumCoverCacheKey}
									coverCandidates={recommendedAlbumCoverCandidates}
									tone="tertiary"
								>
									{#snippet bodyExtra()}
										<div class="ui-action-row">
											<a
												href={recommendedAlbumArtistId
													? `/artist/${recommendedAlbumArtistId}`
													: buildSearchHref(
															`${recommendedAlbumArtistName} ${recommendation.album.title}`,
															'albums'
														)}
												class="ui-chip-button ui-chip-button--compact"
											>
												{recommendedAlbumArtistId ? 'Open Artist' : 'Search'}
											</a>
										</div>
									{/snippet}
								</MediaRow>
							</li>
						{/each}
					</ol>
				</div>
			</div>
		{/if}
	</section>

	<div
		id="library-overview"
		class="ui-section-anchor ui-surface-grid library-suggestions-overview ui-perf-block"
		data-ui-block="results"
	>
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

	.library-suggestions-list {
		list-style: none;
		padding: 0;
		margin: 0;
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
