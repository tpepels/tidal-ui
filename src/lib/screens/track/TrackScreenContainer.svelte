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
	import PageSectionNav from '$lib/components/ui/PageSectionNav.svelte';
	import { LoaderCircle, ArrowLeft } from 'lucide-svelte';
	import { formatArtists } from '$lib/utils/formatters';
	import {
		buildTrackMusicBrainzViewModel,
		normalizeTrackMusicBrainzLookupResponse,
		type MusicBrainzTrackLookupResponse
	} from '$lib/features/track/trackMusicBrainzModel';
	import TrackActionsSection from '$lib/screens/track/sections/TrackActionsSection.svelte';
	import TrackHeroSection from '$lib/screens/track/sections/TrackHeroSection.svelte';
	import TrackMusicBrainzSection from '$lib/screens/track/sections/TrackMusicBrainzSection.svelte';
	import {
		buildTrackActionButtons,
		buildTrackHeroViewModel,
		buildTrackMusicBrainzSectionViewModel,
		buildTrackSectionNavItems
	} from '$lib/screens/track/trackViewModel';

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
	const sectionNavItems = $derived.by(() => buildTrackSectionNavItems());
	const heroViewModel = $derived.by(() => (track ? buildTrackHeroViewModel(track) : null));
	const actionButtons = $derived.by(() =>
		buildTrackActionButtons({
			isDownloading,
			isCancelled,
			downloadActionLabel
		})
	);
	const musicBrainzSectionViewModel = $derived.by(() =>
		buildTrackMusicBrainzSectionViewModel({
			musicBrainzView,
			isLoading: isMusicBrainzLookupLoading,
			hasAttempted: hasMusicBrainzLookupAttempted
		})
	);

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

	function handleBackNavigation() {
		const target = breadcrumbStore.goBack($page.url.pathname, '/');
		void goto(target);
	}

	function handleTrackAction(actionId: string): void {
		if (!track) {
			return;
		}
		switch (actionId) {
			case 'play':
				playbackFacade.loadQueue([track], 0, { autoPlay: true });
				return;
			case 'cancel-download':
				void handleCancelDownload(track.id);
				return;
			case 'download':
				void handleDownload(track);
				return;
			default:
		}
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

		{#if heroViewModel}
			<TrackHeroSection hero={heroViewModel} />
		{/if}

		<PageSectionNav items={sectionNavItems} sticky={true} />

		<div class="ui-detail-columns">
			<div class="ui-detail-main">
				<section id="track-actions" class="ui-section-anchor" data-ui-block="primary-actions">
					<TrackActionsSection
						trackId={track.id}
						actions={actionButtons}
						onAction={handleTrackAction}
					/>
				</section>
			</div>

			<div class="ui-detail-sidebar">
				<section id="track-metadata" class="ui-section-anchor" data-ui-block="context-metadata">
					<TrackMusicBrainzSection
						viewModel={musicBrainzSectionViewModel}
						isLoading={isMusicBrainzLookupLoading}
						onRefresh={() => {
							if (!track) return;
							void lookupTrackMusicBrainzMetadata(track);
						}}
					/>
				</section>
			</div>
		</div>
	</div>
{/if}
