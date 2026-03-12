<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/stores';
	import { losslessAPI } from '$lib/api';
	import { hasRegionTargets } from '$lib/config';
	import { downloadAlbum } from '$lib/downloads';
	import { isAlbumDownloadQueueActive, type AlbumDownloadStatus } from '$lib/controllers/albumDownloadUi';
	import { formatArtists } from '$lib/utils/formatters';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { createTrackDownloadUi } from '$lib/controllers/trackDownloadUi';
	import TrackDownloadButton from '$lib/components/TrackDownloadButton.svelte';
	import { fetchAlbumLibraryStatus } from '$lib/utils/mediaLibraryClient';
	import CoverArt from '$lib/components/CoverArt.svelte';
	import EntityMediaCard from '$lib/components/ui/EntityMediaCard.svelte';
	import ToolPanel from '$lib/components/ui/ToolPanel.svelte';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import {
		getCoverCacheKey,
		getUnifiedCoverCandidates,
		prefetchCoverCandidates
	} from '$lib/utils/coverPipeline';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { regionStore, type RegionOption } from '$lib/stores/region';
	import { isTidalUrl } from '$lib/utils/urlParser';
	import { areTestHooksEnabled } from '$lib/utils/testHooks';
	import {
		isSupportedStreamingUrl,
		isSpotifyPlaylistUrl as isSpotifyPlaylistUrlUtil,
		getPlatformName
	} from '$lib/utils/songlink';
	// Orchestrators
	import { searchOrchestrator, downloadOrchestrator } from '$lib/orchestrators';
	import type { Track, Album, AudioQuality, PlayableTrack } from '$lib/types';
	import { isSonglinkTrack } from '$lib/types';
	import { toasts } from '$lib/stores/toasts';
	import {
		Music,
		User,
		Disc,
		Download,
		RotateCcw,
		X,
		Newspaper,
		ListPlus,
		ListVideo,
		LoaderCircle,
		Link2,
		MoreVertical,
		List,
		Play,
		Search,
		Shuffle,
		Copy,
		Code
	} from 'lucide-svelte';

	import { searchStore, searchStoreActions, type SearchTab } from '$lib/stores/searchStoreAdapter';
	const SEARCH_TABS: SearchTab[] = ['tracks', 'albums', 'artists', 'playlists'];

	function isSearchTab(value: string | null): value is SearchTab {
		return !!value && SEARCH_TABS.includes(value as SearchTab);
	}

	function getLongLink(type: 'track' | 'album' | 'artist' | 'playlist', id: string | number) {
		return `https://music.binimum.org/${type}/${id}`;
	}

	function getShortLink(type: 'track' | 'album' | 'artist' | 'playlist', id: string | number) {
		const prefixMap = {
			track: 't',
			album: 'al',
			artist: 'ar',
			playlist: 'p'
		};
		return `https://okiw.me/${prefixMap[type]}/${id}`;
	}

	function getEmbedCode(type: 'track' | 'album' | 'artist' | 'playlist', id: string | number) {
		if (type === 'track')
			return `<iframe src="https://music.binimum.org/embed/${type}/${id}" width="100%" height="150" style="border:none; overflow:hidden; border-radius: 0.5em;" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
		return `<iframe src="https://music.binimum.org/embed/${type}/${id}" width="100%" height="450" style="border:none; overflow:hidden; border-radius: 0.5em;" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
	}

	async function copyToClipboard(text: string) {
		try {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				await navigator.clipboard.writeText(text);
			} else {
				// Fallback for non-secure contexts
				const textArea = document.createElement('textarea');
				textArea.value = text;
				textArea.style.position = 'fixed';
				textArea.style.left = '-9999px';
				textArea.style.top = '0';
				document.body.appendChild(textArea);
				textArea.focus();
				textArea.select();
				try {
					document.execCommand('copy');
				} catch (err) {
					console.error('Fallback: Oops, unable to copy', err);
					throw err;
				}
				document.body.removeChild(textArea);
			}
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}

	const trackDownloadUi = createTrackDownloadUi({
		resolveSubtitle: (track) =>
			isSonglinkTrack(track) ? track.artistName : track.album?.title ?? formatArtists(track.artists),
		notificationMode: 'toast',
		autoConvertSonglink: true,
		skipFfmpegCountdown: true
	});
	const { downloadingIds, cancelledIds, handleDownload, handleCancelDownload } = trackDownloadUi;
	let activeMenuId = $state<number | string | null>(null);

	const albumDownloadQuality = $derived($downloadPreferencesStore.downloadQuality as AudioQuality);
	const albumDownloadMode = $derived($downloadPreferencesStore.mode);
	const downloadActionLabel = $derived(
		$downloadPreferencesStore.storage === 'server' ? 'Save to server' : 'Download'
	);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const downloadCoverSeperatelyPreference = $derived(
		$userPreferencesStore.downloadCoversSeperately
	);
	const experimentalMusicBrainzTaggingPreference = $derived(
		$userPreferencesStore.experimentalMusicBrainzTagging
	);
	const strictMusicBrainzMatchingPreference = $derived(
		$userPreferencesStore.strictMusicBrainzMatching
	);
	let selectedRegion = $state<RegionOption>('us');
	let lastUrlSearchKey = $state('');
	let albumArtistFilter = $state('');
	let strictAlbumArtistMatch = $state(false);



	// Playlist state moved to searchStore

	const regionAvailability: Record<RegionOption, boolean> = {
		auto: hasRegionTargets('auto'),
		us: hasRegionTargets('us'),
		eu: hasRegionTargets('eu')
	};

	const ensureSupportedRegion = (value: RegionOption): RegionOption => {
		if (areTestHooksEnabled()) {
			return value;
		}
		if (value !== 'auto' && !regionAvailability[value]) {
			return 'auto';
		}
		return value;
	};

	const unsubscribeRegion = regionStore.subscribe((value) => {
		const nextRegion = ensureSupportedRegion(value);
		if (nextRegion !== value) {
			regionStore.setRegion(nextRegion);
		}
		selectedRegion = nextRegion;
	});


	// URL detection for UI hints (orchestrator handles actual routing)
	const isQueryATidalUrl = $derived(
		$searchStore.query.trim().length > 0 && isTidalUrl($searchStore.query.trim())
	);

	const isQueryASpotifyPlaylist = $derived(
		$searchStore.query.trim().length > 0 && isSpotifyPlaylistUrlUtil($searchStore.query.trim())
	);

	const isQueryAStreamingUrl = $derived(
		$searchStore.query.trim().length > 0 && isSupportedStreamingUrl($searchStore.query.trim())
	);

	const isQueryAUrl = $derived(isQueryATidalUrl || isQueryAStreamingUrl || isQueryASpotifyPlaylist);

	$effect(() => {
		const queryParam = ($page.url.searchParams.get('q') ?? '').trim();
		const tabParam = $page.url.searchParams.get('tab');
		const artistParam = ($page.url.searchParams.get('artist') ?? '').trim();
		const strictArtistParam = ($page.url.searchParams.get('strictArtist') ?? '').trim().toLowerCase();
		const strictFromUrl =
			strictArtistParam === '1' ||
			strictArtistParam === 'true' ||
			strictArtistParam === 'yes' ||
			strictArtistParam === 'on';
		const resolvedTab = isSearchTab(tabParam) ? tabParam : null;
		const lookupKey = `${queryParam}::${resolvedTab ?? ''}::${artistParam}::${strictFromUrl ? 'strict' : 'relaxed'}`;
		if (lookupKey === lastUrlSearchKey) {
			return;
		}
		lastUrlSearchKey = lookupKey;
		if (!queryParam) {
			return;
		}

		if (resolvedTab && $searchStore.activeTab !== resolvedTab) {
			searchStoreActions.commit({ activeTab: resolvedTab });
		}
		if ($searchStore.query !== queryParam) {
			searchStoreActions.setQuery(queryParam);
		}

		const targetTab = resolvedTab ?? $searchStore.activeTab;
		if (targetTab === 'albums' && artistParam.length > 0 && artistParam !== albumArtistFilter) {
			albumArtistFilter = artistParam;
		}
		if (targetTab === 'albums') {
			strictAlbumArtistMatch = strictFromUrl;
		}
		void searchOrchestrator.search(queryParam, targetTab, {
			region: selectedRegion,
			showErrorToasts: false,
			albumArtistQuery: targetTab === 'albums' ? albumArtistFilter.trim() : undefined,
			strictAlbumArtistMatch: targetTab === 'albums' ? strictAlbumArtistMatch : undefined
		});
	});

	type AlbumDownloadState = {
		status: AlbumDownloadStatus;
		downloading: boolean;
		completed: number;
		total: number;
		error: string | null;
		queueJobId: string | null;
	};

	const ALBUM_QUEUE_POLL_INTERVAL_MS = 1000;
	const FORCE_OVERWRITE_CONFIRMATION =
		'This album is already in your local library. Redownload it and overwrite existing files?';
	const CLIENT_REDOWNLOAD_CONFIRMATION =
		'This album is already in your local library. Browser downloads cannot overwrite existing files and may append (2) to filenames. Continue anyway?';
	let albumDownloadStates = $state<Record<number, AlbumDownloadState>>({});
	let albumLibraryPresence = $state<Record<number, { exists: boolean; matchedTracks: number }>>({});
	const albumQueuePollTimers = new Map<number, ReturnType<typeof setInterval>>();
	const albumQueuePollTokens = new Map<number, number>();
	let albumLibraryLookupToken = 0;



	const newsItems = [
		{
			title: 'Hi-Res downloading!!!',
			description:
				'You can finally download and stream in Hi-Res again because of a much better API. It should also be much faster - try it out for yourself!'
		},
		{
			title: 'Links support + QOLs!',
			description:
				"You can now paste links from supported streaming platforms (Spotify, YouTube, Apple Music, etc.) and the app will try to convert them to TIDAL equivalents for you to play or download. Only Spotify playlists work right now, but I'm working on fixing it."
		},
		{
			title: 'Redesign + QQDL',
			description:
				'Hi-Res downloading still a WIP but a cool redesign that I inspired off a very cool library called Color Thief is here - and the site is also now up at QQDL!'
		},
		{
			title: 'Hi-Res Audio',
			description:
				"Streaming for Hi-Res is now here. Stay tuned for Hi-Res downloading - I haven't gotten that one figured out yet. And video covers/lower quality streaming. Pretty cool."
		},
		{
			title: 'Even more changes!',
			description:
				"LYRICS!!! I've stabilised the API a bit and added a few more features such as ZIP download of albums, better error handling, etc. Stay tuned for word by word lyrics!"
		},
		{
			title: 'QOL changes',
			description:
				'This website is still very much in beta, but queue management and album/artist pages/downloads have been added as well as some bug squashing/QOL changes such as bigger album covers and download all for albums.'
		},
		{
			title: 'Initial release!',
			description:
				"Two APIs fetch lossless CD-quality 16/44.1kHz FLACs. No support for Hi-Res yet but I'm working on it haha. No playlist saving or logging in either but downloading and streaming work."
		}
	];

	const trackSkeletons = Array.from({ length: 6 }, (_, index) => index);
	const gridSkeletons = Array.from({ length: 8 }, (_, index) => index);

	interface Props {
		onTrackSelect?: (track: PlayableTrack) => void;
	}

	let { onTrackSelect }: Props = $props();

	// Close track menus when clicking outside
	onMount(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			// Check if click is outside any menu
			if (
				!target.closest('.track-menu-container') &&
				!target.closest('button[title="Queue actions"]')
			) {
				activeMenuId = null;
			}
		};

		document.addEventListener('click', handleClickOutside);

		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});

	async function handleDownloadWithFallback(track: PlayableTrack, event?: MouseEvent) {
		try {
			const result = await handleDownload(track, event);
			if (!result?.success && result?.error?.code === 'SONGLINK_NOT_SUPPORTED') {
				toasts.info(
					'This track needs to be played first before it can be downloaded. Click to play it, then download.'
				);
			}
		} catch (error) {
			console.error('Failed to download track:', error);
		}
	}

	function patchAlbumDownloadState(albumId: number, patch: Partial<AlbumDownloadState>) {
		const previous = albumDownloadStates[albumId] ?? createDefaultAlbumDownloadState();
		albumDownloadStates = {
			...albumDownloadStates,
			[albumId]: { ...previous, ...patch }
		};
	}

	function createDefaultAlbumDownloadState(total = 0): AlbumDownloadState {
		return {
			status: 'idle',
			downloading: false,
			completed: 0,
			total,
			error: null,
			queueJobId: null
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
						error: null,
						queueJobId: null
					});
					stopAlbumQueuePolling(albumId);
					albumQueuePollTokens.delete(albumId);
					break;
				case 'cancelled':
					patchAlbumDownloadState(albumId, {
						status: 'cancelled',
						downloading: false,
						error: null,
						queueJobId: null
					});
					stopAlbumQueuePolling(albumId);
					albumQueuePollTokens.delete(albumId);
					break;
				case 'failed':
					patchAlbumDownloadState(albumId, {
						status: 'failed',
						downloading: false,
						error: payload.job.error ?? 'Album download failed.',
						queueJobId: null
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
				error: null,
				queueJobId: null
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

	async function handleAlbumDownloadClick(album: Album, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();

		const currentState = getAlbumDownloadState(album.id);
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
		const storage = $downloadPreferencesStore.storage;
		if (inLibrary && currentState.status === 'idle') {
			if (storage === 'server') {
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
			queueJobId: null
		});

		const quality = albumDownloadQuality;

		try {
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
					}
				},
				album.artist?.name,
						{
							mode: albumDownloadMode,
							convertAacToMp3: convertAacToMp3Preference,
							downloadCoverSeperately: downloadCoverSeperatelyPreference,
							experimentalMusicBrainzTagging: experimentalMusicBrainzTaggingPreference,
							strictMusicBrainzMatching: strictMusicBrainzMatchingPreference,
							storage,
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
				startAlbumQueuePolling(album.id, result.jobId);
				return;
			}

			const finalState = getAlbumDownloadState(album.id);
			const failedTracks = result.failedTracks ?? 0;
			patchAlbumDownloadState(album.id, {
				status: failedTracks > 0 ? 'failed' : 'completed',
				downloading: false,
				completed: finalState.total ?? result.completedTracks ?? finalState.completed ?? 0,
				error:
					failedTracks > 0
						? `${failedTracks} track${failedTracks > 1 ? 's' : ''} failed after 3 attempts`
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

	function handleTrackActivation(track: PlayableTrack) {
		onTrackSelect?.(track);
	}

	function handleAddToQueue(track: PlayableTrack, event: MouseEvent) {
		event.stopPropagation();
		playbackFacade.enqueue(track);
	}

	function handlePlayNext(track: PlayableTrack, event: MouseEvent) {
		event.stopPropagation();
		playbackFacade.enqueueNext(track);
	}

	function handleTrackKeydown(event: KeyboardEvent, track: PlayableTrack) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleTrackActivation(track);
		}
	}

	$effect(() => {
		const activeIds = new Set(($searchStore.results?.albums ?? []).map((album) => album.id));
		let mutated = false;
		const nextState: Record<number, AlbumDownloadState> = {};
		for (const [albumId, state] of Object.entries(albumDownloadStates)) {
			const numericId = Number(albumId);
			if (activeIds.has(numericId)) {
				nextState[numericId] = state;
			} else {
				mutated = true;
				stopAlbumQueuePolling(numericId);
				albumQueuePollTokens.delete(numericId);
			}
		}
		if (mutated) {
			albumDownloadStates = nextState;
		}
	});

	$effect(() => {
		const albums = $searchStore.results?.albums ?? [];
		if (albums.length === 0) {
			albumLibraryPresence = {};
			return;
		}
		const lookupToken = ++albumLibraryLookupToken;
		const payload = albums.map((album) => ({
			id: album.id,
			artistName: album.artist?.name,
			albumTitle: album.title,
			expectedTrackCount:
				typeof album.numberOfTracks === 'number' ? album.numberOfTracks : undefined
		}));
		void fetchAlbumLibraryStatus(payload)
			.then((result) => {
				if (lookupToken !== albumLibraryLookupToken) return;
				albumLibraryPresence = result;
			})
			.catch(() => {
				if (lookupToken !== albumLibraryLookupToken) return;
				albumLibraryPresence = {};
			});
	});

	$effect(() => {
		const albums = ($searchStore.results?.albums ?? []).slice(0, 24);
		const batch = albums
			.map((album) => {
				if (!album.cover) return null;
				const cacheKey = getCoverCacheKey({
					coverId: album.cover,
					size: '640',
					proxy: false,
					overrideKey: `search:${album.id}`
				});
				const candidates = getUnifiedCoverCandidates({
					coverId: album.cover,
					size: '640',
					proxy: false,
					includeLowerSizes: true
				});
				if (candidates.length === 0) return null;
				return { cacheKey, candidates };
			})
			.filter((entry): entry is { cacheKey: string; candidates: string[] } => entry !== null);
		if (batch.length === 0) return;
		void prefetchCoverCandidates(batch);
	});



	async function handleSearch() {
		const trimmedQuery = $searchStore.query.trim();
		if (!trimmedQuery) return;
		const artistFilter = albumArtistFilter.trim();

		// Delegate to search orchestrator for all workflows
		await searchOrchestrator.search(trimmedQuery, $searchStore.activeTab as SearchTab, {
			region: selectedRegion,
			showErrorToasts: true,
			albumArtistQuery: $searchStore.activeTab === 'albums' ? artistFilter : undefined,
			strictAlbumArtistMatch:
				$searchStore.activeTab === 'albums' ? strictAlbumArtistMatch : undefined
		});
	}

	// These functions are now handled by the orchestrator
	// No longer needed - search orchestrator handles all workflows

	function handlePlayAll() {
		const tracks = $searchStore.results?.tracks ?? [];
		if (tracks.length > 0) {
			playbackFacade.loadQueue(tracks, 0, { autoPlay: true });
		}
	}

	function handleShuffleAll() {
		const tracks = $searchStore.results?.tracks ?? [];
		if (tracks.length > 0) {
			// Shuffle the tracks
			const shuffled = [...tracks].sort(() => Math.random() - 0.5);
			playbackFacade.loadQueue(shuffled, 0, { autoPlay: true });
		}
	}

	async function handleDownloadAll() {
		const tracks = $searchStore.results?.tracks ?? [];
		if (tracks.length === 0) return;

		for (const track of tracks) {
			try {
				// Determine subtitle based on track type
				let subtitle: string;
				if (isSonglinkTrack(track)) {
					subtitle = track.artistName;
				} else {
					subtitle = track.album?.title ?? formatArtists(track.artists);
				}

				await downloadOrchestrator.downloadTrack(track, {
					quality: $downloadPreferencesStore.downloadQuality,
					subtitle,
					notificationMode: 'silent',
					ffmpegAutoTriggered: false,
					skipFfmpegCountdown: false,
					autoConvertSonglink: true
				});
			} catch (error) {
				console.error(`Failed to download track ${track.title}:`, error);
			}
		}
	}

	function handleTabChange(tab: SearchTab) {
		searchStoreActions.commit({ activeTab: tab });
	}

	function displayTrackTotal(total?: number | null): number {
		if (!Number.isFinite(total)) return 0;
		return total && total > 0 ? total : (total ?? 0);
	}

	function formatQualityLabel(quality?: string | null): string {
		if (!quality) return '—';
		const normalized = quality.toUpperCase();
		if (normalized === 'LOSSLESS') {
			return 'CD • 16-bit/44.1 kHz FLAC';
		}
		if (normalized === 'HI_RES_LOSSLESS') {
			return 'Hi-Res • up to 24-bit/192 kHz FLAC';
		}
		return quality;
	}

	function asTrack(track: PlayableTrack): Track {
		return track as Track;
	}

	// Cleanup subscriptions on component destroy
	onDestroy(unsubscribeRegion);
	onDestroy(() => {
		stopAllAlbumQueuePolling();
	});
</script>

<div class="w-full">
	<!-- Search Input -->
	<div class="mb-6 space-y-3">
		<div class="ui-action-panel search-input-panel">
			<label for="catalog-search-input" class="ui-action-panel__intent">Search Catalog</label>
			<div class="search-input-panel__row">
				<input
					id="catalog-search-input"
					type="text"
					value={$searchStore.query}
					oninput={(event) => {
						const target = event.currentTarget as HTMLInputElement | null;
						if (target) {
							searchStoreActions.setQuery(target.value);
						}
					}}
					placeholder={isQueryATidalUrl
						? 'Tidal URL detected - click Search to import'
						: isQueryASpotifyPlaylist
							? 'Spotify playlist detected - click Search to convert'
							: isQueryAStreamingUrl
								? `${getPlatformName($searchStore.query)} URL detected - click Search to convert`
								: 'Search for tracks, albums, artists... or paste a URL'}
					class="search-input-panel__input"
				/>
				<button
					type="button"
					class="ui-action-button ui-action-button--primary search-input-panel__submit"
					onclick={handleSearch}
					disabled={
						!$searchStore.query.trim() ||
						$searchStore.isLoading ||
						$searchStore.tabLoading[$searchStore.activeTab]
					}
					aria-busy={$searchStore.isLoading || $searchStore.tabLoading[$searchStore.activeTab]}
				>
					{#if $searchStore.isLoading || $searchStore.tabLoading[$searchStore.activeTab]}
						<LoaderCircle size={16} class="animate-spin" />
						Searching…
					{:else}
						<Search size={16} />
						Search
					{/if}
				</button>
			</div>
		</div>

		{#if !isQueryAUrl && $searchStore.activeTab === 'albums'}
			<div class="ui-action-panel search-input-panel search-input-panel--secondary">
				<label for="album-artist-filter" class="ui-action-panel__intent">Artist Filter (Optional)</label>
				<div class="search-input-panel__row">
					<input
						id="album-artist-filter"
						type="text"
						value={albumArtistFilter}
						oninput={(event) => {
							const target = event.currentTarget as HTMLInputElement | null;
						if (target) {
							albumArtistFilter = target.value;
						}
					}}
					placeholder="Artist name (e.g. Daft Punk)"
						class="search-input-panel__input"
					/>
				</div>
				<label class="search-input-panel__toggle">
					<input
						type="checkbox"
						checked={strictAlbumArtistMatch}
						onchange={(event) => {
							const target = event.currentTarget as HTMLInputElement | null;
							if (target) {
								strictAlbumArtistMatch = target.checked;
							}
						}}
						disabled={!albumArtistFilter.trim()}
					/>
					<span>Strict artist match (exact artist name only)</span>
				</label>
			</div>
		{/if}
	</div>

	<!-- Tabs (hidden when URL is detected) -->
	{#if !isQueryAUrl}
		<div class="search-tab-row mb-6">
			<button
				onclick={() => handleTabChange('tracks')}
				class="ui-filter-chip search-tab-chip"
				class:is-active={$searchStore.activeTab === 'tracks'}
			>
				<Music size={18} />
				<span>Tracks</span>
			</button>
			<button
				onclick={() => handleTabChange('albums')}
				class="ui-filter-chip search-tab-chip"
				class:is-active={$searchStore.activeTab === 'albums'}
			>
				<Disc size={18} />
				<span>Albums</span>
			</button>
			<button
				onclick={() => handleTabChange('artists')}
				class="ui-filter-chip search-tab-chip"
				class:is-active={$searchStore.activeTab === 'artists'}
			>
				<User size={18} />
				<span>Artists</span>
			</button>
			<button
				onclick={() => handleTabChange('playlists')}
				class="ui-filter-chip search-tab-chip"
				class:is-active={$searchStore.activeTab === 'playlists'}
			>
				<List size={18} />
				<span>Playlists</span>
			</button>
		</div>
	{/if}

	<!-- Loading State -->
	{#if $searchStore.isLoading || $searchStore.tabLoading[$searchStore.activeTab]}
		{#if $searchStore.activeTab === 'tracks'}
				<div class="space-y-2">
					{#each trackSkeletons as i (i)}
						<div class="flex w-full items-center gap-3 rounded-lg bg-gray-800/70 p-3">
							<div class="h-12 w-12 flex-shrink-0 animate-pulse rounded bg-gray-700/80"></div>
							<div class="flex-1 space-y-2">
								<div class="h-4 w-2/3 animate-pulse rounded bg-gray-700/80"></div>
								<div class="h-3 w-1/3 animate-pulse rounded bg-gray-700/60"></div>
								<div class="h-3 w-1/4 animate-pulse rounded bg-gray-700/40"></div>
							</div>
							<div class="h-6 w-12 animate-pulse rounded-full bg-gray-700/80"></div>
						</div>
					{/each}
				</div>
			{:else if $searchStore.activeTab === 'albums' || $searchStore.activeTab === 'playlists'}
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
					{#each gridSkeletons as i (i)}
						<div class="space-y-3">
							<div class="aspect-square w-full animate-pulse rounded-lg bg-gray-800/70"></div>
							<div class="h-4 w-3/4 animate-pulse rounded bg-gray-700/80"></div>
							<div class="h-3 w-1/2 animate-pulse rounded bg-gray-700/60"></div>
						</div>
					{/each}
				</div>
			{:else if $searchStore.activeTab === 'artists'}
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
					{#each gridSkeletons as i (i)}
						<div class="flex flex-col items-center gap-3">
							<div class="aspect-square w-full animate-pulse rounded-full bg-gray-800/70"></div>
							<div class="h-4 w-3/4 animate-pulse rounded bg-gray-700/80"></div>
							<div class="h-3 w-1/2 animate-pulse rounded bg-gray-700/60"></div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="flex items-center justify-center py-12">
					<div class="h-10 w-10 animate-spin rounded-full border-b-2 border-white/80"></div>
				</div>
			{/if}
	{/if}

	<!-- Error State -->
	{#if $searchStore.error}
		<StateBlock kind="error" title="Search failed" message={$searchStore.error} />
	{/if}

	<!-- Playlist Loading Progress -->
	{#if $searchStore.playlistLoadingMessage}
		<div class="ui-action-panel mb-4 flex items-center gap-3 p-4 text-white/85">
			<LoaderCircle class="animate-spin" size={20} />
			<span>{$searchStore.playlistLoadingMessage}</span>
		</div>
	{/if}

	<!-- Results -->
	{#if !$searchStore.tabLoading[$searchStore.activeTab]}
		{#if (!$searchStore.isLoading && !$searchStore.error) || ($searchStore.isPlaylistConversionMode && ($searchStore.results?.tracks ?? []).length > 0)}
		{#if $searchStore.activeTab === 'tracks' && ($searchStore.results?.tracks ?? []).length > 0}
			<!-- Playlist Controls (shown when in playlist conversion mode) -->
			{#if $searchStore.isPlaylistConversionMode}
				<div class="mb-6 flex flex-wrap items-center gap-3">
					<button
						onclick={handlePlayAll}
						class="ui-action-button ui-action-button--primary"
						aria-label="Play search results"
					>
						<Play size={16} fill="currentColor" />
						Play Results
					</button>
					<button
						onclick={handleShuffleAll}
						class="ui-action-button"
						aria-label="Shuffle search results"
					>
						<Shuffle size={16} />
						Shuffle Results
					</button>
					<button
						onclick={handleDownloadAll}
						class="ui-action-button"
						aria-label="Download search results"
					>
						<Download size={16} />
						Download Results
					</button>
					<div class="ml-auto text-sm text-gray-400">
						{($searchStore.results?.tracks ?? []).length} of {$searchStore.playlistConversionTotal} tracks
					</div>
				</div>
			{/if}

			<div class="space-y-2">
				{#each ($searchStore.results?.tracks ?? []) as track (track.id)}
					<div
						role="button"
						tabindex="0"
						onclick={(e) => {
							if (
								e.target instanceof Element &&
								(e.target.closest('a') || e.target.closest('button'))
							)
								return;
							handleTrackActivation(track);
						}}
						onkeydown={(event) => handleTrackKeydown(event, track)}
						class="search-track-row ui-surface-card group flex w-full cursor-pointer items-center gap-2 overflow-hidden p-2 sm:gap-3 sm:p-3 {activeMenuId ===
						track.id
							? 'relative z-20'
							: ''}"
					>
						{#if isSonglinkTrack(track)}
							<!-- Display for SonglinkTrack -->
							<img
								src={track.thumbnailUrl || '/placeholder-album.jpg'}
								alt={`${track.title} by ${track.artistName}`}
								class="h-10 w-10 sm:h-12 sm:w-12 flex-shrink-0 rounded object-cover"
							/>
							<div class="min-w-0 flex-1">
								<h3 class="font-semibold text-sm leading-tight break-words whitespace-normal sm:text-base sm:truncate text-white group-hover:text-gray-100">
									{track.title}
								</h3>
								<p class="truncate text-xs sm:text-sm text-gray-400">
									{track.artistName}
								</p>
								<p class="text-xs text-gray-500">
									{formatQualityLabel(track.audioQuality)}
								</p>
							</div>
							<!-- Queue actions for Songlink tracks -->
							<div class="flex items-center gap-2 text-sm text-gray-400">
								<div class="relative">
									<button
										onclick={(event) => {
											event.stopPropagation();
											activeMenuId = activeMenuId === track.id ? null : track.id;
										}}
										class="search-track-menu__trigger"
										title="Queue actions"
										aria-label="Queue actions for {track.title}"
									>
										<MoreVertical size={18} />
									</button>
									<!-- Dropdown menu for queue actions -->
									{#if activeMenuId === track.id}
										<div
											class="search-track-menu track-menu-container absolute top-full right-0 z-10 mt-1 w-48"
										>
											<button
												onclick={(event) => {
													handlePlayNext(track, event);
													activeMenuId = null;
												}}
												class="search-track-menu__item"
											>
												<ListVideo size={16} />
												Play Next
											</button>
											<button
												onclick={(event) => {
													handleAddToQueue(track, event);
													activeMenuId = null;
												}}
												class="search-track-menu__item"
											>
												<ListPlus size={16} />
												Add to Queue
											</button>
											<div class="search-track-menu__divider"></div>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getLongLink('track', track.id));
													activeMenuId = null;
												}}
												class="search-track-menu__item"
											>
												<Link2 size={16} />
												Share Link
											</button>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getShortLink('track', track.id));
													activeMenuId = null;
												}}
												class="search-track-menu__item"
											>
												<Copy size={16} />
												Share Short Link
											</button>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getEmbedCode('track', track.id));
													activeMenuId = null;
												}}
												class="search-track-menu__item"
											>
												<Code size={16} />
												Copy Embed Code
											</button>
										</div>
									{/if}
								</div>
							</div>
						{:else}
							<!-- Display for regular Track -->
							{#if asTrack(track).album.cover}
								<img
									src={losslessAPI.getCoverUrl(asTrack(track).album.cover, '160')}
									alt={track.title}
									class="h-12 w-12 rounded object-cover"
								/>
							{/if}
							<div class="min-w-0 flex-1">
								<h3 class="font-semibold text-sm leading-tight break-words whitespace-normal sm:text-base sm:truncate text-white group-hover:text-gray-100">
									{track.title}{asTrack(track).version ? ` (${asTrack(track).version})` : ''}
									{#if asTrack(track).explicit}
										<svg
											class="inline h-4 w-4 flex-shrink-0 align-middle"
											xmlns="http://www.w3.org/2000/svg"
											fill="currentColor"
											height="24"
											viewBox="0 0 24 24"
											width="24"
											focusable="false"
											aria-hidden="true"
											><path
												d="M20 2H4a2 2 0 00-2 2v16a2 2 0 002 2h16a2 2 0 002-2V4a2 2 0 00-2-2ZM8 6h8a1 1 0 110 2H9v3h5a1 1 0 010 2H9v3h7a1 1 0 010 2H8a1 1 0 01-1-1V7a1 1 0 011-1Z"
											></path></svg
										>
									{/if}
								</h3>
								<a
									href={`/artist/${asTrack(track).artist.id}`}
									class="inline-block truncate text-sm text-gray-400 hover:text-white hover:underline"
									data-sveltekit-preload-data
								>
									{formatArtists(asTrack(track).artists)}
								</a>
								<p class="text-xs text-gray-500">
									<a
										href={`/album/${asTrack(track).album.id}`}
										class="hover:text-white hover:underline"
										data-sveltekit-preload-data
									>
										{asTrack(track).album.title}
									</a>
									• {formatQualityLabel(track.audioQuality)}
								</p>
							</div>
							<div class="flex items-center gap-2 text-sm text-gray-400">
								<TrackDownloadButton
									isDownloading={$downloadingIds.has(track.id)}
									isCancelled={$cancelledIds.has(track.id)}
									onCancel={(event) => handleCancelDownload(track.id, event)}
									onDownload={(event) => handleDownloadWithFallback(track, event)}
									title={$downloadingIds.has(track.id) ? 'Cancel download' : `${downloadActionLabel} track`}
									ariaLabel={$downloadingIds.has(track.id)
										? `Cancel download for ${track.title}`
										: `${downloadActionLabel} ${track.title}`}
									class="rounded-full"
								/>
								<div class="relative">
									<button
										onclick={(event) => {
											event.stopPropagation();
											activeMenuId = activeMenuId === track.id ? null : track.id;
										}}
										class="search-track-menu__trigger"
										title="Queue actions"
										aria-label="Queue actions for {track.title}"
									>
										<MoreVertical size={18} />
									</button>
									{#if activeMenuId === track.id}
										<div
											class="search-track-menu track-menu-container absolute top-full right-0 z-10 mt-1 w-48"
										>
											<button
												onclick={(event) => {
													handlePlayNext(track, event);
													activeMenuId = null;
												}}
												class="search-track-menu__item"
											>
												<ListVideo size={16} />
												Play Next
											</button>
											<button
												onclick={(event) => {
													handleAddToQueue(track, event);
													activeMenuId = null;
												}}
												class="search-track-menu__item"
											>
												<ListPlus size={16} />
												Add to Queue
											</button>
											<div class="search-track-menu__divider"></div>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getLongLink('track', track.id));
													activeMenuId = null;
												}}
												class="search-track-menu__item"
											>
												<Link2 size={16} />
												Share Link
											</button>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getShortLink('track', track.id));
													activeMenuId = null;
												}}
												class="search-track-menu__item"
											>
												<Copy size={16} />
												Share Short Link
											</button>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getEmbedCode('track', track.id));
													activeMenuId = null;
												}}
												class="search-track-menu__item"
											>
												<Code size={16} />
												Copy Embed Code
											</button>
										</div>
									{/if}
								</div>
							</div>
						{/if}
						{#if !('isSonglinkTrack' in track && track.isSonglinkTrack)}
							<span class="search-track-row__duration">{losslessAPI.formatDuration(track.duration)}</span>
						{/if}
					</div>
				{/each}
			</div>
		{:else if $searchStore.activeTab === 'albums' && ($searchStore.results?.albums ?? []).length > 0}
			<div class="ui-media-grid ui-media-grid--albums">
				{#each ($searchStore.results?.albums ?? []) as album (album.id)}
					{@const albumDownloadState =
						albumDownloadStates[album.id] ??
						createDefaultAlbumDownloadState(album.numberOfTracks ?? 0)}
					{@const canCancelAlbumDownload = isAlbumQueueDownloadCancellable(albumDownloadState)}
					{@const albumInLibrary = albumLibraryPresence[album.id]?.exists === true}
					<EntityMediaCard
						type="album"
						href={`/album/${album.id}`}
						title={album.title}
						subtitle={album.artist?.name}
						meta={`${album.releaseDate ? `${album.releaseDate.split('-')[0]} • ` : ''}${displayTrackTotal(album.numberOfTracks)} track${displayTrackTotal(album.numberOfTracks) === 1 ? '' : 's'}`}
						class="search-media-card group"
					>
						{#snippet badge()}
							{#if albumInLibrary}
								<span class="search-media-card__badge" title="Already in local library">In Library</span>
							{/if}
						{/snippet}
						{#snippet action()}
							<button
								onclick={(event) =>
									canCancelAlbumDownload
										? cancelAlbumQueueDownload(album.id, event)
										: handleAlbumDownloadClick(album, event)}
								type="button"
								class="search-media-card__action-btn"
								disabled={albumDownloadState.status === 'submitting'}
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
							{#if album.videoCover}
								<video
									src={losslessAPI.getVideoCoverUrl(album.videoCover, '640')}
									poster={album.cover ? losslessAPI.getCoverUrl(album.cover, '640') : undefined}
									aria-label={album.title}
									class="search-media-card__image"
									autoplay
									loop
									muted
									playsinline
									preload="metadata"
								></video>
							{:else if album.cover}
								{@const coverCacheKey = getCoverCacheKey({
									coverId: album.cover,
									size: '640',
									proxy: false,
									overrideKey: `search:${album.id}`
								})}
								{@const coverCandidates = getUnifiedCoverCandidates({
									coverId: album.cover,
									size: '640',
									proxy: false,
									includeLowerSizes: true
								})}
								<CoverArt
									cacheKey={coverCacheKey}
									candidates={coverCandidates}
									alt={album.title}
									class="search-media-card__image"
								/>
							{:else}
								<div class="search-media-card__placeholder">
									<Disc size={24} />
								</div>
							{/if}
						{/snippet}
						{#snippet footer()}
							{#if albumDownloadState.status === 'queued'}
								<p class="search-media-status">Queued on server…</p>
							{:else if albumDownloadState.downloading}
								<p class="search-media-status">
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
								<p class="search-media-status search-media-status--success">Download completed.</p>
							{:else if albumDownloadState.status === 'cancelled'}
								<p class="search-media-status search-media-status--warning">Download stopped.</p>
							{:else if albumDownloadState.status === 'paused'}
								<p class="search-media-status search-media-status--warning">Download paused.</p>
							{:else if albumDownloadState.error}
								<p class="search-media-status search-media-status--error" role="alert">
									{albumDownloadState.error}
								</p>
							{:else if albumInLibrary}
								<p class="search-media-status search-media-status--success">
									{#if $downloadPreferencesStore.storage === 'server'}
										Already in local library. Redownload will overwrite.
									{:else}
										Already in local library. Browser redownloads may append (2).
									{/if}
								</p>
							{/if}
						{/snippet}
					</EntityMediaCard>
				{/each}
			</div>
		{:else if $searchStore.activeTab === 'artists' && ($searchStore.results?.artists ?? []).length > 0}
			<div class="ui-media-grid ui-media-grid--artists">
				{#each ($searchStore.results?.artists ?? []) as artist (artist.id)}
					<EntityMediaCard
						type="artist"
						href={`/artist/${artist.id}`}
						title={artist.name}
						subtitle={artist.type && artist.type.trim().length > 0 ? artist.type : 'Artist'}
						links={[{ href: `/artist/${artist.id}`, label: 'Open Artist' }]}
						class="search-media-card search-media-card--artist"
					>
						{#snippet artwork()}
							{#if artist.picture}
								<img
									src={losslessAPI.getArtistPictureUrl(artist.picture)}
									alt={artist.name}
									class="search-media-card__image"
								/>
							{:else}
								<div class="search-media-card__placeholder">
									<User size={40} />
								</div>
							{/if}
						{/snippet}
					</EntityMediaCard>
				{/each}
			</div>
		{:else if $searchStore.activeTab === 'playlists' && ($searchStore.results?.playlists ?? []).length > 0}
			<div class="ui-media-grid ui-media-grid--playlists">
				{#each ($searchStore.results?.playlists ?? []) as playlist (playlist.uuid)}
					<EntityMediaCard
						type="playlist"
						href={`/playlist/${playlist.uuid}`}
						title={playlist.title}
						subtitle={playlist.creator.name}
						meta={`${displayTrackTotal(playlist.numberOfTracks)} track${displayTrackTotal(playlist.numberOfTracks) === 1 ? '' : 's'}${playlist.duration ? ` • ${losslessAPI.formatDuration(playlist.duration)}` : ''}`}
						links={[
							{ href: `/playlist/${playlist.uuid}`, label: 'Open Playlist' },
							...(playlist.promotedArtists?.[0]
								? [{ href: `/artist/${playlist.promotedArtists[0].id}`, label: 'View Featured Artist' }]
								: [])
						]}
						class="search-media-card search-media-card--playlist"
					>
						{#snippet artwork()}
							{#if playlist.squareImage || playlist.image}
								<img
									src={losslessAPI.getCoverUrl(playlist.squareImage || playlist.image, '640')}
									alt={playlist.title}
									class="search-media-card__image"
								/>
							{:else}
								<div class="search-media-card__placeholder">
									<List size={24} />
								</div>
							{/if}
						{/snippet}
					</EntityMediaCard>
				{/each}
			</div>
			<!-- News Section -->
		{:else if !$searchStore.query.trim()}
			<ToolPanel
				eyebrow="Updates"
				title="News"
				subtitle="Recent changes to search, streaming, and downloads."
				panelRole="search-news"
			>
				<section class="search-news-grid">
					{#each newsItems as item, i (i)}
						<article class="search-news-card ui-surface-card">
							<div class="search-news-card__header">
								<div class="search-news-card__icon">
									<Newspaper size={18} />
								</div>
								<h3 class="search-news-card__title">{item.title}</h3>
							</div>
							<p class="search-news-card__body">{item.description}</p>
						</article>
					{/each}
				</section>
			</ToolPanel>
		{:else if isQueryATidalUrl && !$searchStore.isLoading}
			<div class="py-12 text-center text-gray-400">
				<div class="flex flex-col items-center gap-4">
					<Link2 size={48} class="text-white/85" />
					<p class="text-lg text-white">Tidal URL detected</p>
					<p class="text-sm">Click Search to load this content</p>
				</div>
			</div>
		{:else if $searchStore.query.trim() && !$searchStore.isLoading && !isQueryATidalUrl}
			<div class="py-12 text-center text-gray-400">
				<p>No results found...</p>
			</div>
		{/if}
	{/if}
	{/if}
</div>

<style>
	:global(.search-media-card) {
		gap: 0.58rem;
	}

	.search-media-card__badge {
		position: absolute;
		top: 0.78rem;
		left: 0.78rem;
		z-index: 20;
		padding: 0.2rem 0.44rem;
		border-radius: 999px;
		font-size: 0.56rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border: 1px solid var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		background: rgba(255, 255, 255, 0.14);
		color: rgba(245, 245, 245, 0.94);
	}

	.search-media-card__action-btn {
		position: absolute;
		top: 0.74rem;
		right: 0.74rem;
		z-index: 30;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		color: rgba(236, 236, 236, 0.92);
		cursor: pointer;
		transition:
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.search-media-card__action-btn:hover:not(:disabled) {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.search-media-card__action-btn:active:not(:disabled) {
		transform: translateY(var(--ui-press-y, 0px));
	}

	.search-media-card__action-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.search-media-card__image {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform var(--ui-motion-medium, 200ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	:global(.search-media-card:hover .search-media-card__image) {
		transform: scale(1.01);
	}

	.search-media-card__placeholder {
		display: flex;
		width: 100%;
		height: 100%;
		align-items: center;
		justify-content: center;
		color: rgba(163, 163, 163, 0.78);
		background: rgba(255, 255, 255, 0.05);
	}

	.search-media-status {
		margin: 0;
		font-size: 0.64rem;
		line-height: 1.35;
		color: rgba(212, 212, 212, 0.82);
	}

	.search-media-status--success {
		color: rgba(230, 230, 230, 0.9);
	}

	.search-media-status--warning {
		color: rgba(218, 218, 218, 0.88);
	}

	.search-media-status--error {
		color: rgba(206, 206, 206, 0.9);
	}

	:global(.search-media-card--artist .ui-media-card__body),
	:global(.search-media-card--artist .ui-media-card__links) {
		align-items: center;
		text-align: center;
	}

	.search-input-panel {
		padding: 0.82rem 0.92rem;
		gap: 0.52rem;
	}

	.search-input-panel--secondary {
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		box-shadow: none;
	}

	.search-input-panel__row {
		display: flex;
		align-items: center;
		gap: 0.52rem;
		padding: 0.18rem 0.24rem;
		border-radius: var(--ui-radius-sm, 8px);
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: rgba(10, 10, 10, 0.58);
	}

	.search-input-panel__input {
		width: 100%;
		min-width: 0;
		border: 0;
		background: transparent;
		padding: 0.34rem 0.2rem;
		font-size: 1rem;
		line-height: 1.4;
		color: rgba(245, 245, 245, 0.96);
		outline: none;
	}

	.search-input-panel__submit {
		flex-shrink: 0;
		min-width: 7.4rem;
	}

	.search-input-panel__toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.44rem;
		font-size: 0.86rem;
		color: rgba(212, 212, 212, 0.82);
	}

	.search-input-panel__toggle input[type='checkbox'] {
		width: 1rem;
		height: 1rem;
		border-radius: 0.2rem;
		accent-color: #f3f3f3;
	}

	.search-input-panel__toggle input[type='checkbox']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.search-input-panel__input::placeholder {
		color: rgb(156, 163, 175);
		opacity: 1;
	}

	.search-tab-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.48rem;
	}

	.search-tab-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.95rem;
		padding-inline: 0.75rem;
	}

	.search-track-row {
		padding: 0.58rem 0.66rem;
		gap: 0.6rem;
		box-shadow: none;
		transition:
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	.search-track-row:hover,
	.search-track-row:focus-within {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		background: var(--ui-surface-interactive, #171717);
	}

	.search-track-row:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.34);
		outline-offset: 2px;
	}

	.search-track-row__duration {
		font-size: 0.8rem;
		font-weight: 600;
		color: rgba(196, 196, 196, 0.86);
		white-space: nowrap;
	}

	.search-track-menu {
		border-radius: var(--ui-radius-sm, 8px);
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-raised, #121212);
		box-shadow: var(--ui-shadow-soft, 0 10px 28px rgba(0, 0, 0, 0.22));
		overflow: hidden;
	}

	.search-track-menu__trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		color: rgba(214, 214, 214, 0.84);
		cursor: pointer;
		transition:
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.search-track-menu__trigger:hover {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
		transform: translateY(var(--ui-lift-y, -1px));
		color: rgba(244, 244, 244, 0.95);
	}

	.search-track-menu__item {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.5rem;
		border: 0;
		background: transparent;
		padding: 0.52rem 0.72rem;
		text-align: left;
		font-size: 0.84rem;
		color: rgba(214, 214, 214, 0.86);
		transition:
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	.search-track-menu__item:hover {
		background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
		color: rgba(246, 246, 246, 0.96);
	}

	.search-track-menu__divider {
		margin: 0.24rem 0;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}

	.search-news-grid {
		display: grid;
		gap: 0.75rem;
	}

	@media (min-width: 700px) {
		.search-news-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.search-news-card {
		display: flex;
		flex-direction: column;
		gap: 0.58rem;
		padding: 0.9rem;
		box-shadow: none;
	}

	.search-news-card__header {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	.search-news-card__icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.95rem;
		height: 1.95rem;
		border-radius: var(--ui-radius-sm, 8px);
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		color: rgba(228, 228, 228, 0.9);
	}

	.search-news-card__title {
		margin: 0;
		font-size: 1.01rem;
		line-height: 1.3;
		color: rgba(242, 242, 242, 0.96);
	}

	.search-news-card__body {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.45;
		color: rgba(206, 206, 206, 0.84);
	}

	@media (prefers-reduced-motion: reduce) {
		.search-media-card__image,
		.search-media-card__action-btn,
		.search-track-menu__trigger,
		.search-news-card {
			transition: none;
		}

		:global(.search-media-card:hover .search-media-card__image),
		.search-media-card__action-btn:hover:not(:disabled),
		.search-track-menu__trigger:hover {
			transform: none;
		}
	}
</style>
