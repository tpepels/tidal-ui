<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { losslessAPI } from '$lib/api';
	import type { Track } from '$lib/types';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { createTrackDownloadUi } from '$lib/controllers/trackDownloadUi';
	import { browseState } from '$lib/stores/browseState';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { artistCacheStore } from '$lib/stores/artistCache';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import EntityMediaCard from '$lib/components/ui/EntityMediaCard.svelte';
	import { LoaderCircle, Play, ArrowLeft, Disc, Clock, Download, X } from 'lucide-svelte';
	import { formatArtists } from '$lib/utils/formatters';

	let track = $state<Track | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let activeRequestToken = 0;
	let musicBrainzTags = $state<Record<string, string>>({});
	let isMusicBrainzLookupLoading = $state(false);
	let musicBrainzLookupError = $state<string | null>(null);
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
	const musicBrainzTrackId = $derived(musicBrainzTags.MUSICBRAINZ_TRACKID ?? '');
	const musicBrainzReleaseId = $derived(musicBrainzTags.MUSICBRAINZ_ALBUMID ?? '');
	const musicBrainzReleaseGroupId = $derived(musicBrainzTags.MUSICBRAINZ_RELEASEGROUPID ?? '');
	const musicBrainzReleaseType = $derived(musicBrainzTags.MUSICBRAINZ_RELEASETYPE ?? '');
	const musicBrainzArtistIds = $derived.by(() =>
		(musicBrainzTags.MUSICBRAINZ_ARTISTID ?? '')
			.split(';')
			.map((id) => id.trim())
			.filter((id) => id.length > 0)
	);

	$effect(() => {
		const parsedTrackId = Number.parseInt(trackId ?? '', 10);
		if (!Number.isFinite(parsedTrackId) || parsedTrackId <= 0) {
			track = null;
			error = 'Invalid track id';
			isLoading = false;
			musicBrainzLookupToken += 1;
			musicBrainzTags = {};
			isMusicBrainzLookupLoading = false;
			musicBrainzLookupError = null;
			hasMusicBrainzLookupAttempted = false;
			return;
		}
		const requestToken = ++activeRequestToken;
		void loadTrack(parsedTrackId, requestToken);
	});

	async function lookupTrackMusicBrainzMetadata(activeTrack: Track): Promise<void> {
		const lookupToken = ++musicBrainzLookupToken;
		isMusicBrainzLookupLoading = true;
		musicBrainzLookupError = null;
		hasMusicBrainzLookupAttempted = true;
		try {
			const response = await fetch('/api/metadata/musicbrainz', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					track: activeTrack
				})
			});
			const payload = (await response.json().catch(() => null)) as {
				success?: boolean;
				error?: string;
				tags?: Record<string, string>;
			} | null;
			if (
				lookupToken !== musicBrainzLookupToken ||
				!track ||
				track.id !== activeTrack.id
			) {
				return;
			}
			if (!response.ok || !payload?.success) {
				throw new Error(payload?.error || 'Failed to lookup MusicBrainz metadata');
			}

			const normalizedTags: Record<string, string> = {};
			const payloadTags = payload.tags;
			if (payloadTags && typeof payloadTags === 'object' && !Array.isArray(payloadTags)) {
				for (const [key, value] of Object.entries(payloadTags)) {
					if (typeof key !== 'string' || typeof value !== 'string') {
						continue;
					}
					const normalizedValue = value.trim();
					if (!normalizedValue) {
						continue;
					}
					normalizedTags[key] = normalizedValue;
				}
			}
			musicBrainzTags = normalizedTags;
		} catch (lookupError) {
			musicBrainzLookupError =
				lookupError instanceof Error
					? lookupError.message
					: 'Failed to lookup MusicBrainz metadata';
			musicBrainzTags = {};
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
			musicBrainzTags = {};
			isMusicBrainzLookupLoading = false;
			musicBrainzLookupError = null;
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
	<div class="ui-page flex items-center justify-center py-24">
		<LoaderCircle class="h-16 w-16 animate-spin text-white/80" />
	</div>
{:else if error}
	<div class="ui-page py-12">
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
	<div class="ui-page space-y-8 pb-32 pt-4 lg:pb-40">
		<!-- Back Button -->
		<button
			onclick={handleBackNavigation}
			class="ui-chip-button ui-chip-button--compact ui-detail-back"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<div class="ui-surface-card flex flex-col gap-8 p-5 md:flex-row">
			<!-- Album Art -->
			<div class="aspect-square w-full flex-shrink-0 overflow-hidden rounded-xl border border-white/12 bg-white/5 md:w-96">
				{#if track.album.cover}
					<img
						src={losslessAPI.getCoverUrl(track.album.cover, '1280')}
						alt={track.album.title}
						class="h-full w-full object-cover"
					/>
				{:else}
					<div class="flex h-full w-full items-center justify-center bg-gray-800">
						<Disc size={64} class="text-gray-600" />
					</div>
				{/if}
			</div>

			<!-- Track Info -->
			<div class="flex flex-1 flex-col justify-end">
				<h1 class="mb-2 text-4xl font-bold md:text-5xl">{track.title}</h1>
				{#if track.version}
					<span class="ui-meta-pill mb-4 inline-flex">
						{track.version}
					</span>
				{/if}

				<div class="mb-6 space-y-4">
					<div class="flex items-center gap-2 text-gray-500">
						<Clock size={18} />
						<span>{formatDuration(track.duration)}</span>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<EntityMediaCard
							type="artist"
							href={`/artist/${track.artist.id}`}
							title={track.artist.name}
							subtitle={
								track.artists.length > 1
									? `${track.artists.length} credited artists`
									: track.artist.type || 'Artist'
							}
							meta={formatArtists(track.artists)}
							imageSrc={
								track.artist.picture ? losslessAPI.getArtistPictureUrl(track.artist.picture) : null
							}
							imageAlt={`Portrait of ${track.artist.name}`}
							links={[{ href: `/artist/${track.artist.id}`, label: 'Artist Page' }]}
						/>
						<EntityMediaCard
							type="album"
							href={`/album/${track.album.id}`}
							title={track.album.title}
							subtitle={track.album.artist?.name ?? track.artist.name}
							meta={track.album.releaseDate ? track.album.releaseDate.split('-')[0] : null}
							imageSrc={track.album.cover ? losslessAPI.getCoverUrl(track.album.cover, '640') : null}
							imageAlt={`Cover for ${track.album.title}`}
							links={[
								{ href: `/album/${track.album.id}`, label: 'Album Page' },
								{ href: `/artist/${track.artist.id}`, label: 'Artist Page' }
							]}
						/>
					</div>
				</div>

				<div class="ui-action-panel ui-action-panel--intentful">
					<div class="ui-action-panel__header">
						<p class="ui-action-panel__intent">Track Actions</p>
						<p class="ui-action-panel__summary">Play, download, or share this track.</p>
					</div>
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
							<button
								disabled
								class="ui-action-button"
							>
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
				</div>

				<div class="ui-action-panel">
					<div class="ui-action-subpanel__header">
						<p class="ui-action-panel__intent">MusicBrainz Track Metadata</p>
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
					</div>
					{#if isMusicBrainzLookupLoading && Object.keys(musicBrainzTags).length === 0}
						<p class="ui-action-status">Resolving MusicBrainz metadata…</p>
					{:else if Object.keys(musicBrainzTags).length > 0}
						<div class="ui-data-grid">
							{#if musicBrainzTrackId}
								<div class="ui-data-point">
									<p class="ui-data-point__label">Track MBID</p>
									<p class="ui-data-point__value">{musicBrainzTrackId}</p>
								</div>
							{/if}
							{#if musicBrainzReleaseId}
								<div class="ui-data-point">
									<p class="ui-data-point__label">Release MBID</p>
									<p class="ui-data-point__value">{musicBrainzReleaseId}</p>
								</div>
							{/if}
							{#if musicBrainzReleaseGroupId}
								<div class="ui-data-point">
									<p class="ui-data-point__label">Release Group</p>
									<p class="ui-data-point__value">{musicBrainzReleaseGroupId}</p>
								</div>
							{/if}
							{#if musicBrainzReleaseType}
								<div class="ui-data-point">
									<p class="ui-data-point__label">Release Type</p>
									<p class="ui-data-point__value">{musicBrainzReleaseType}</p>
								</div>
							{/if}
							{#if musicBrainzTags.MUSICBRAINZ_RELEASESTATUS}
								<div class="ui-data-point">
									<p class="ui-data-point__label">Release Status</p>
									<p class="ui-data-point__value">{musicBrainzTags.MUSICBRAINZ_RELEASESTATUS}</p>
								</div>
							{/if}
							{#if musicBrainzTags.MUSICBRAINZ_RELEASECOUNTRY}
								<div class="ui-data-point">
									<p class="ui-data-point__label">Release Country</p>
									<p class="ui-data-point__value">{musicBrainzTags.MUSICBRAINZ_RELEASECOUNTRY}</p>
								</div>
							{/if}
							{#if musicBrainzTags.BARCODE}
								<div class="ui-data-point">
									<p class="ui-data-point__label">Barcode</p>
									<p class="ui-data-point__value">{musicBrainzTags.BARCODE}</p>
								</div>
							{/if}
							{#if musicBrainzArtistIds.length > 0}
								<div class="ui-data-point">
									<p class="ui-data-point__label">Artist MBIDs</p>
									<p class="ui-data-point__value">{musicBrainzArtistIds.length}</p>
								</div>
							{/if}
						</div>
						<div class="ui-action-row">
							{#if musicBrainzTrackId}
								<a
									href={`https://musicbrainz.org/recording/${musicBrainzTrackId}`}
									target="_blank"
									rel="noreferrer"
									class="ui-chip-button ui-chip-button--compact"
								>
									Open Recording
								</a>
							{/if}
							{#if musicBrainzReleaseId}
								<a
									href={`https://musicbrainz.org/release/${musicBrainzReleaseId}`}
									target="_blank"
									rel="noreferrer"
									class="ui-chip-button ui-chip-button--compact"
								>
									Open Release
								</a>
							{/if}
							{#if musicBrainzArtistIds.length > 0}
								<a
									href={`https://musicbrainz.org/artist/${musicBrainzArtistIds[0]}`}
									target="_blank"
									rel="noreferrer"
									class="ui-chip-button ui-chip-button--compact"
								>
									Open Artist
								</a>
							{/if}
						</div>
					{:else if hasMusicBrainzLookupAttempted}
						<p class="ui-action-status">No MusicBrainz metadata match found for this track.</p>
					{/if}
					{#if musicBrainzLookupError}
						<p class="ui-action-status" data-tone="error">{musicBrainzLookupError}</p>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
