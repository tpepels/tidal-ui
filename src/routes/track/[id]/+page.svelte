<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { losslessAPI } from '$lib/api';
	import { musicBrainzClient } from '$lib/clients/musicBrainzClient';
	import type { Track } from '$lib/types';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { createTrackDownloadUi } from '$lib/controllers/trackDownloadUi';
	import { browseState } from '$lib/stores/browseState';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { artistCacheStore } from '$lib/stores/artistCache';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import DataGrid from '$lib/components/ui/DataGrid.svelte';
	import MetaStrip from '$lib/components/ui/MetaStrip.svelte';
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import StateNotice from '$lib/components/ui/StateNotice.svelte';
	import { LoaderCircle, Play, ArrowLeft, Disc, Clock, Download, X } from 'lucide-svelte';
	import { formatArtists } from '$lib/utils/formatters';
	import {
		buildTrackMusicBrainzViewModel,
		normalizeTrackMusicBrainzLookupResponse,
		type MusicBrainzTrackLookupResponse
	} from '$lib/features/track/trackMusicBrainzModel';

	let track = $state<Track | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let activeRequestToken = 0;
	let musicBrainzLookupResponse = $state<MusicBrainzTrackLookupResponse | null>(null);
	let isMusicBrainzLookupLoading = $state(false);
	let hasMusicBrainzLookupAttempted = $state(false);
	let musicBrainzLookupToken = 0;

	const trackId = $derived($page.params.id);
	const downloadActionLabel = $derived(
		$downloadPreferencesStore.storage === 'server' ? 'Save to server' : 'Download'
	);
	const trackDownloadUi = createTrackDownloadUi<Track>({
		resolveSubtitle: (candidate) => candidate.album?.title ?? candidate.artist?.name,
		notificationMode: 'toast',
		skipFfmpegCountdown: true
	});
	const { downloadingIds, cancelledIds, handleCancelDownload, handleDownload } = trackDownloadUi;
	const isDownloading = $derived(track ? $downloadingIds.has(track.id) : false);
	const isCancelled = $derived(track ? $cancelledIds.has(track.id) : false);
	const musicBrainzView = $derived(
		buildTrackMusicBrainzViewModel(musicBrainzLookupResponse)
	);
	const musicBrainzPrimaryFacts = $derived(
		musicBrainzView.facts.filter((fact) => !fact.label.endsWith('MBID'))
	);
	const musicBrainzIdentifierFacts = $derived(
		musicBrainzView.facts.filter((fact) => fact.label.endsWith('MBID'))
	);
	const sectionNavItems = $derived.by(() => [
		{ id: 'track-actions', label: 'Actions', tone: 'secondary' as const },
		{ id: 'track-metadata', label: 'MusicBrainz', tone: 'tertiary' as const }
	]);

	$effect(() => {
		const parsedTrackId = Number.parseInt(trackId ?? '', 10);
		if (!Number.isFinite(parsedTrackId) || parsedTrackId <= 0) {
			track = null;
			error = 'Invalid track id';
			isLoading = false;
			musicBrainzLookupToken += 1;
			musicBrainzLookupResponse = null;
			isMusicBrainzLookupLoading = false;
			hasMusicBrainzLookupAttempted = false;
			return;
		}
		const requestToken = ++activeRequestToken;
		void loadTrack(parsedTrackId, requestToken);
	});

	async function lookupTrackMusicBrainzMetadata(activeTrack: Track): Promise<void> {
		const lookupToken = ++musicBrainzLookupToken;
		isMusicBrainzLookupLoading = true;
		hasMusicBrainzLookupAttempted = true;
		try {
			const payload = await musicBrainzClient.lookupTrackMetadata(activeTrack);
			if (
				lookupToken !== musicBrainzLookupToken ||
				!track ||
				track.id !== activeTrack.id
			) {
				return;
			}
			const normalizedResponse = normalizeTrackMusicBrainzLookupResponse(payload);
			if (!normalizedResponse) {
				throw new Error('Unexpected MusicBrainz metadata response');
			}
			musicBrainzLookupResponse = normalizedResponse;
		} catch (lookupError) {
			musicBrainzLookupResponse = {
				success: false,
				lookupStatus: 'lookup_failed',
				tags: {},
				tagCount: 0,
				match: null,
				error:
					lookupError instanceof Error
						? lookupError.message
						: 'Failed to lookup MusicBrainz metadata'
			};
		} finally {
			if (lookupToken === musicBrainzLookupToken) {
				isMusicBrainzLookupLoading = false;
			}
		}
	}

	async function loadTrack(id: number, requestToken: number) {
		try {
			isLoading = true;
			error = null;
			musicBrainzLookupToken += 1;
			musicBrainzLookupResponse = null;
			isMusicBrainzLookupLoading = false;
			hasMusicBrainzLookupAttempted = false;
			const data = await losslessAPI.getTrack(id);
			if (requestToken !== activeRequestToken) {
				return;
			}
			track = data.track;

			if (data.track.album?.artist) {
				breadcrumbStore.setLabel(
					`/artist/${data.track.album.artist.id}`,
					data.track.album.artist.name
				);
			}
			if (data.track.album?.id) {
				breadcrumbStore.setLabel(`/album/${data.track.album.id}`, data.track.album.title);
				if (data.track.album?.artist?.id) {
					breadcrumbStore.setParent(
						`/album/${data.track.album.id}`,
						`/artist/${data.track.album.artist.id}`
					);
				} else {
					breadcrumbStore.setParent(`/album/${data.track.album.id}`, '/');
				}
				breadcrumbStore.setParent(`/track/${data.track.id}`, `/album/${data.track.album.id}`);
			} else if (data.track.album?.artist?.id) {
				breadcrumbStore.setParent(`/track/${data.track.id}`, `/artist/${data.track.album.artist.id}`);
			} else {
				breadcrumbStore.setParent(`/track/${data.track.id}`, '/');
			}
			breadcrumbStore.setCurrentLabel(data.track.title, `/track/${data.track.id}`);

			if (data.track.album?.cover) {
				const albumArtistId = data.track.album.artist?.id;
				if (typeof albumArtistId === 'number' && Number.isFinite(albumArtistId)) {
					artistCacheStore.upsertAlbumCover(albumArtistId, data.track.album.id, data.track.album.cover);
				}
				artistCacheStore.upsertAlbumCoverGlobally(data.track.album.id, data.track.album.cover);
			}

			// Update browse state to track what we're viewing
			// This does NOT affect playback - only UI display context
			if (track) {
				browseState.setViewingTrack(track);
			}
			void lookupTrackMusicBrainzMetadata(data.track);
		} catch (err) {
			if (requestToken === activeRequestToken) {
				error = err instanceof Error ? err.message : 'Failed to load track';
				console.error('Failed to load track:', err);
			}
		} finally {
			if (requestToken === activeRequestToken) {
				isLoading = false;
			}
		}
	}

	function formatDuration(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function handleBackNavigation() {
		const target = breadcrumbStore.goBack($page.url.pathname, '/');
		void goto(target);
	}
</script>

<svelte:head>
	<title>{track ? `${track.title} - ${formatArtists(track.artists)}` : 'Track'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="ui-page flex items-center justify-center py-24" data-ui-archetype="detail" data-ui-route="track">
		<LoaderCircle class="h-16 w-16 animate-spin text-white/80" />
	</div>
{:else if error}
	<div class="ui-page py-12" data-ui-archetype="detail" data-ui-route="track">
		<div class="ui-surface-card border-red-500/40 bg-red-950/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-200">Error Loading Track</h2>
			<p class="text-red-100/85">{error}</p>
			<a
				href="/"
				class="ui-action-button mt-4 inline-flex"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if track}
	<div
		class="ui-page space-y-8 pb-32 pt-4 lg:pb-40"
		data-ui-archetype="detail"
		data-ui-route="track"
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
				<div class="ui-detail-hero__art">
					{#if track.album.cover}
						<img
							src={losslessAPI.getCoverUrl(track.album.cover, '1280')}
							alt={track.album.title}
						/>
					{:else}
						<div class="flex h-full w-full items-center justify-center bg-white/3">
							<Disc size={64} class="text-gray-600" />
						</div>
					{/if}
				</div>

				<div class="ui-detail-hero__body">
					<p class="ui-detail-hero__eyebrow">Track</p>
					<h1 class="ui-detail-hero__title">{track.title}</h1>
					{#if track.version}
						<MetaStrip compact={true}>
							<span class="ui-inline-tag">{track.version}</span>
						</MetaStrip>
					{/if}
					<MetaStrip>
						<div class="ui-meta-strip__item">
							<Clock size={16} />
							{formatDuration(track.duration)}
						</div>
						{#if track.audioQuality}
							<span class="ui-inline-tag">{track.audioQuality.replaceAll('_', ' ')}</span>
						{/if}
					</MetaStrip>
					<div class="ui-list-surface ui-link-row-list ui-detail-hero__related">
						<a href={`/artist/${track.artist.id}`} class="ui-link-row" data-sveltekit-preload-data>
							<div class="ui-link-row__media ui-link-row__media--circle">
								{#if track.artist.picture}
									<img
										src={losslessAPI.getArtistPictureUrl(track.artist.picture)}
										alt={track.artist.name}
									/>
								{:else}
									<span class="ui-list-row__media-fallback">
										{(track.artist.name?.slice(0, 1) ?? 'A').toUpperCase()}
									</span>
								{/if}
							</div>
							<div class="ui-link-row__body">
								<p class="ui-link-row__title">{track.artist.name}</p>
								<p class="ui-link-row__subtitle">
									{track.artists.length > 1
										? `${track.artists.length} credited artists • ${formatArtists(track.artists)}`
										: track.artist.type || 'Artist'}
								</p>
							</div>
						</a>
						<a href={`/album/${track.album.id}`} class="ui-link-row" data-sveltekit-preload-data>
							<div class="ui-link-row__media">
								{#if track.album.cover}
									<img
										src={losslessAPI.getCoverUrl(track.album.cover, '320')}
										alt={track.album.title}
									/>
								{:else}
									<span class="ui-list-row__media-fallback">
										{(track.album.title?.slice(0, 1) ?? 'A').toUpperCase()}
									</span>
								{/if}
							</div>
							<div class="ui-link-row__body">
								<p class="ui-link-row__title">{track.album.title}</p>
								<p class="ui-link-row__subtitle">
									{track.album.artist?.name ?? track.artist.name}
									{#if track.album.releaseDate}
										• {track.album.releaseDate.split('-')[0]}
									{/if}
								</p>
							</div>
						</a>
					</div>
				</div>
			</div>
		</section>

		<PageSectionNav items={sectionNavItems} sticky={true} />

		<div class="ui-detail-columns">
			<div class="ui-detail-main">
				<section id="track-actions" class="ui-section-anchor" data-ui-block="primary-actions">
					<SectionBlock
						title="Actions"
						subtitle="Play, download, or share this track."
						tone="secondary"
					>
						<div class="ui-action-row ui-action-row--progressive">
							<button
								onclick={() => {
									if (track) {
										playbackFacade.loadQueue([track], 0, { autoPlay: true });
									}
								}}
								class="ui-action-button ui-action-button--primary"
							>
								<Play size={16} fill="currentColor" />
								Play
							</button>

							{#if isDownloading}
								<button
									onclick={(event) => handleCancelDownload(track!.id, event)}
									class="ui-action-button"
								>
									<X size={16} />
									Cancel
								</button>
							{:else if isCancelled}
								<button disabled class="ui-action-button">
									<X size={16} />
									Cancelled
								</button>
							{:else}
								<button
									onclick={(event) => handleDownload(track!, event)}
									class="ui-action-button"
								>
									<Download size={16} />
									{downloadActionLabel}
								</button>
							{/if}

							<ShareButton type="track" id={track.id} variant="secondary" />
						</div>
					</SectionBlock>
				</section>
			</div>

			<div class="ui-detail-sidebar">
				<section id="track-metadata" class="ui-section-anchor" data-ui-block="context-metadata">
					<SectionBlock
						title="MusicBrainz"
						subtitle="Resolved track metadata."
						tone="tertiary"
					>
						<svelte:fragment slot="actions">
							<button
								type="button"
								onclick={() => lookupTrackMusicBrainzMetadata(track!)}
								class="ui-chip-button ui-chip-button--compact"
								disabled={isMusicBrainzLookupLoading}
							>
								{#if isMusicBrainzLookupLoading}
									Refreshing…
								{:else}
									Refresh Metadata
								{/if}
							</button>
						</svelte:fragment>
				{#if isMusicBrainzLookupLoading && musicBrainzView.status !== 'matched'}
					<StateNotice tone="info" message="Resolving MusicBrainz metadata…" compact={true} />
				{:else if isMusicBrainzLookupLoading}
					<StateNotice tone="info" message="Refreshing MusicBrainz metadata…" compact={true} stale={true} />
				{:else if musicBrainzView.status === 'matched'}
					<DataGrid>
						{#each musicBrainzPrimaryFacts as fact (fact.label)}
							<div class="ui-data-point">
								<p class="ui-data-point__label">{fact.label}</p>
								<p class="ui-data-point__value">{fact.value}</p>
							</div>
						{/each}
					</DataGrid>
					{#if musicBrainzView.artistLinks.length > 0}
						<p class="ui-section-block__eyebrow">Recording Artists</p>
						<div class="ui-action-row">
							{#each musicBrainzView.artistLinks as artist (artist.id)}
								<a
									href={artist.href}
									target="_blank"
									rel="noreferrer"
									class="ui-chip-button ui-chip-button--compact"
								>
									{artist.label}
								</a>
							{/each}
						</div>
					{/if}
					{#if musicBrainzView.albumArtistLinks.length > 0}
						<p class="ui-section-block__eyebrow">Album Artists</p>
						<div class="ui-action-row">
							{#each musicBrainzView.albumArtistLinks as artist (artist.id)}
								<a
									href={artist.href}
									target="_blank"
									rel="noreferrer"
									class="ui-chip-button ui-chip-button--compact"
								>
									{artist.label}
								</a>
							{/each}
						</div>
					{/if}
					<div class="ui-action-row">
						{#each musicBrainzView.links as link (link.label)}
							<a
								href={link.href}
								target="_blank"
								rel="noreferrer"
								class="ui-chip-button ui-chip-button--compact"
							>
								{link.label}
							</a>
						{/each}
					</div>
					{#if musicBrainzIdentifierFacts.length > 0}
						<details class="track-metadata__details">
							<summary>Show MusicBrainz IDs</summary>
							<DataGrid>
								{#each musicBrainzIdentifierFacts as fact (fact.label)}
									<div class="ui-data-point">
										<p class="ui-data-point__label">{fact.label}</p>
										<p class="ui-data-point__value">{fact.value}</p>
									</div>
								{/each}
							</DataGrid>
						</details>
					{/if}
				{:else if hasMusicBrainzLookupAttempted && musicBrainzView.status === 'no_match'}
					<StateNotice
						tone="neutral"
						message="No MusicBrainz metadata match found for this track."
						compact={true}
					/>
				{/if}
				{#if musicBrainzView.errorMessage}
					<StateNotice tone="error" message={musicBrainzView.errorMessage} compact={true} />
				{/if}
					</SectionBlock>
				</section>
			</div>
		</div>
	</div>
{/if}

<style>
	.track-metadata__details {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-top: 0.35rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
	}

	.track-metadata__details summary {
		font-size: 0.9rem;
		font-weight: 600;
		color: rgba(220, 220, 220, 0.84);
	}
</style>
