<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { losslessAPI } from '$lib/api';
	import {
		isAlbumDownloadQueueActive,
		type AlbumDownloadStatus
	} from '$lib/controllers/albumDownloadUi';
	import CoverArt from '$lib/components/CoverArt.svelte';
	import TrackList from '$lib/components/TrackList.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import ActionPanel from '$lib/components/ui/ActionPanel.svelte';
	import DataGrid from '$lib/components/ui/DataGrid.svelte';
	import StateBlock from '$lib/components/ui/StateBlock.svelte';
	import type { Album, Track } from '$lib/types';
	import ArtistLinks from '$lib/components/ArtistLinks.svelte';
	import {
		ArrowLeft,
		Play,
		Pause,
		Calendar,
		Disc,
		Clock,
		Download,
		Shuffle,
		LoaderCircle,
		X
	} from 'lucide-svelte';
	import {
		machineCurrentTrack,
		machineIsPlaying,
		machineIsLoading,
		machineQueue
	} from '$lib/stores/playerDerived';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { browseState } from '$lib/stores/browseState';
	import { artistCacheStore } from '$lib/stores/artistCache';
	import { navigationHistoryStore } from '$lib/stores/navigationHistory';
	import { fetchAlbumLibraryStatus, repairAlbumInLibrary } from '$lib/utils/mediaLibraryClient';
	import { getCoverCacheKey, getUnifiedCoverCandidates } from '$lib/utils/coverPipeline';

	import { downloadAlbum } from '$lib/downloads';

	type MusicBrainzReleaseOption = {
		id: string;
		title?: string;
		artistCredit?: string;
		status?: string;
		country?: string;
		date?: string;
		trackCount?: number;
		barcode?: string;
	};

	let album = $state<Album | null>(null);
	let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isDownloadingAll = $state(false);
	let downloadedCount = $state(0);
	let activeRequestToken = 0;
	let albumLoadAbortController: AbortController | null = null;
	let trackedDownloadAlbumId: number | null = null;

	const isAlbumQueue = $derived(
		tracks.length > 0 &&
			$machineQueue.length === tracks.length &&
			$machineQueue.every((t, i) => t?.id === tracks[i]?.id)
	);
	const isAlbumPlaying = $derived(isAlbumQueue && ($machineIsPlaying || $machineIsLoading));
	let downloadError = $state<string | null>(null);
	const albumDownloadMode = $derived($downloadPreferencesStore.mode);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const experimentalMusicBrainzTaggingPreference = $derived(
		$userPreferencesStore.experimentalMusicBrainzTagging
	);
	const strictMusicBrainzMatchingPreference = $derived(
		$userPreferencesStore.strictMusicBrainzMatching
	);
	const downloadStoragePreference = $derived($downloadPreferencesStore.storage);
	type AlbumQueueStatus = AlbumDownloadStatus;
	let queueStatus = $state<AlbumQueueStatus>('idle');
	let queueJobId = $state<string | null>(null);
	let queueCompletedTracks = $state(0);
	let queueTotalTracks = $state(0);
	let queuePollInterval: ReturnType<typeof setInterval> | null = null;
	let queuePollToken = 0;
	let albumInLibrary = $state(false);
	let albumLibraryTrackCount = $state(0);
	let isRepairingAlbum = $state(false);
	let repairMessage = $state<string | null>(null);
	let musicBrainzReleaseOptions = $state<MusicBrainzReleaseOption[]>([]);
	let selectedMusicBrainzReleaseId = $state<string>('');
	let isMusicBrainzReleaseLookupLoading = $state(false);
	let musicBrainzReleaseLookupError = $state<string | null>(null);
	let hasMusicBrainzReleaseLookupAttempted = $state(false);
	let musicBrainzReleaseLookupToken = 0;
	const FORCE_OVERWRITE_CONFIRMATION =
		'This album is already in your local library. Redownload it and overwrite existing files?';
	const CLIENT_REDOWNLOAD_CONFIRMATION =
		'This album is already in your local library. Browser downloads cannot overwrite existing files and may append (2) to filenames. Continue anyway?';

	const hasActiveQueueDownload = $derived(
		queueStatus === 'submitting' || queueStatus === 'queued' || queueStatus === 'processing'
	);
	const isQueueDownloadCancellable = $derived(
		isAlbumDownloadQueueActive(queueStatus)
	);

	const albumId = $derived($page.params.id);

	$effect(() => {
		const parsedAlbumId = Number.parseInt(albumId ?? '', 10);
		if (!Number.isFinite(parsedAlbumId) || parsedAlbumId <= 0) {
			albumLoadAbortController?.abort();
			albumLoadAbortController = null;
			stopQueuePolling();
			musicBrainzReleaseLookupToken += 1;
			album = null;
			tracks = [];
			error = 'Invalid album id';
			isLoading = false;
			return;
		}
		if (trackedDownloadAlbumId !== parsedAlbumId) {
			trackedDownloadAlbumId = parsedAlbumId;
			stopQueuePolling();
			queueStatus = 'idle';
			queueJobId = null;
			queueCompletedTracks = 0;
			queueTotalTracks = 0;
			isDownloadingAll = false;
			downloadedCount = 0;
			downloadError = null;
			albumInLibrary = false;
			albumLibraryTrackCount = 0;
			isRepairingAlbum = false;
			repairMessage = null;
			musicBrainzReleaseLookupToken += 1;
			musicBrainzReleaseOptions = [];
			selectedMusicBrainzReleaseId = '';
			isMusicBrainzReleaseLookupLoading = false;
			musicBrainzReleaseLookupError = null;
			hasMusicBrainzReleaseLookupAttempted = false;
		}
		const requestToken = ++activeRequestToken;
		albumLoadAbortController?.abort();
		const controller = new AbortController();
		albumLoadAbortController = controller;
		void loadAlbum(parsedAlbumId, requestToken, controller);
	});

	onDestroy(() => {
		albumLoadAbortController?.abort();
		albumLoadAbortController = null;
		stopQueuePolling();
	});

	async function loadAlbum(id: number, requestToken: number, controller: AbortController) {
		try {
			isLoading = true;
			error = null;
			musicBrainzReleaseLookupToken += 1;
			musicBrainzReleaseOptions = [];
			selectedMusicBrainzReleaseId = '';
			isMusicBrainzReleaseLookupLoading = false;
			musicBrainzReleaseLookupError = null;
			hasMusicBrainzReleaseLookupAttempted = false;
			const { album: albumData, tracks: albumTracks } = await losslessAPI.getAlbum(id, {
				signal: controller.signal
			});
			if (requestToken !== activeRequestToken) {
				return;
			}
			album = albumData;
			tracks = albumTracks;

			// Update browse state to track what we're viewing
			// This does NOT affect playback - only UI display context
			browseState.setViewingAlbum(albumData);

			// Set breadcrumbs
			if (albumData.artist) {
				breadcrumbStore.setLabel(`/artist/${albumData.artist.id}`, albumData.artist.name);
			}
			breadcrumbStore.setCurrentLabel(albumData.title, `/album/${albumData.id}`);
			navigationHistoryStore.visitAlbum({
				id: albumData.id,
				title: albumData.title,
				artistName: albumData.artist?.name,
				cover: albumData.cover
			});

			if (albumData.cover) {
				const artistId = albumData.artist?.id;
				if (typeof artistId === 'number' && Number.isFinite(artistId)) {
					artistCacheStore.upsertAlbumCover(artistId, albumData.id, albumData.cover);
				}
				artistCacheStore.upsertAlbumCoverGlobally(albumData.id, albumData.cover);
			}

			const libraryStatus = await fetchAlbumLibraryStatus([
				{
					id: albumData.id,
					artistName: albumData.artist?.name,
					albumTitle: albumData.title,
					expectedTrackCount: albumTracks.length
				}
			]);
			if (requestToken !== activeRequestToken) {
				return;
			}
			const status = libraryStatus[albumData.id];
			albumInLibrary = status?.exists === true;
			albumLibraryTrackCount = status?.matchedTracks ?? 0;
		} catch (err) {
			if (requestToken === activeRequestToken) {
				if (err instanceof Error && err.name === 'AbortError') {
					return;
				}
				error = err instanceof Error ? err.message : 'Failed to load album';
				console.error('Failed to load album:', err);
			}
		} finally {
			if (requestToken === activeRequestToken) {
				isLoading = false;
			}
			if (albumLoadAbortController === controller) {
				albumLoadAbortController = null;
			}
		}
	}

	function formatMusicBrainzReleaseOption(release: MusicBrainzReleaseOption): string {
		const trackCountLabel =
			typeof release.trackCount === 'number' && Number.isFinite(release.trackCount) && release.trackCount > 0
				? `${Math.trunc(release.trackCount)} track${Math.trunc(release.trackCount) === 1 ? '' : 's'}`
				: undefined;
		const parts = [
			release.title?.trim() || 'Untitled release',
			trackCountLabel,
			release.artistCredit?.trim(),
			release.date?.trim(),
			release.country?.trim(),
			release.status?.trim()
		].filter((value): value is string => typeof value === 'string' && value.length > 0);
		return parts.join(' - ');
	}

	function resolveReleaseTrackCount(release: MusicBrainzReleaseOption): number | null {
		const count = Number(release.trackCount);
		if (!Number.isFinite(count) || count <= 0) {
			return null;
		}
		return Math.trunc(count);
	}

	function resolveMusicBrainzTargetTrackCount(): number | null {
		const albumTrackCount = Number(album?.numberOfTracks);
		if (Number.isFinite(albumTrackCount) && albumTrackCount > 0) {
			return Math.trunc(albumTrackCount);
		}
		if (tracks.length > 0) {
			return tracks.length;
		}
		return null;
	}

	function pickDefaultMusicBrainzReleaseId(
		releases: MusicBrainzReleaseOption[],
		targetTrackCount: number | null
	): string {
		if (releases.length === 0) {
			return '';
		}
		if (targetTrackCount === null) {
			return releases[0]?.id ?? '';
		}

		const exactTrackCountMatch = releases.find(
			(release) => resolveReleaseTrackCount(release) === targetTrackCount
		);
		if (exactTrackCountMatch) {
			return exactTrackCountMatch.id;
		}

		const atLeastTrackCountMatch = releases.find((release) => {
			const trackCount = resolveReleaseTrackCount(release);
			return trackCount !== null && trackCount >= targetTrackCount;
		});
		if (atLeastTrackCountMatch) {
			return atLeastTrackCountMatch.id;
		}

		return releases[0]?.id ?? '';
	}

	const selectedMusicBrainzRelease = $derived.by(() =>
		musicBrainzReleaseOptions.find((release) => release.id === selectedMusicBrainzReleaseId) ?? null
	);

	async function lookupMusicBrainzReleases(options?: { manual?: boolean }): Promise<void> {
		if (!album) {
			return;
		}
		const lookupToken = ++musicBrainzReleaseLookupToken;
		const activeAlbum = album;
		isMusicBrainzReleaseLookupLoading = true;
		musicBrainzReleaseLookupError = null;
		hasMusicBrainzReleaseLookupAttempted = true;
		try {
			const response = await fetch('/api/metadata/musicbrainz-release-search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					albumTitle: activeAlbum.title,
					artistName: activeAlbum.artist?.name,
					releaseDate: activeAlbum.releaseDate,
					upc: activeAlbum.upc,
					limit: 12
				})
			});
			const payload = (await response.json().catch(() => null)) as {
				success?: boolean;
				error?: string;
				releases?: MusicBrainzReleaseOption[];
			} | null;
			if (lookupToken !== musicBrainzReleaseLookupToken || album?.id !== activeAlbum.id) {
				return;
			}
			if (!response.ok || !payload?.success) {
				throw new Error(payload?.error || 'Failed to search MusicBrainz releases');
			}

			const releases = Array.isArray(payload.releases)
				? payload.releases.filter((release) => typeof release?.id === 'string' && release.id.length > 0)
				: [];
			musicBrainzReleaseOptions = releases;
			if (releases.length === 0) {
				selectedMusicBrainzReleaseId = '';
				return;
			}
			const existingSelection = selectedMusicBrainzReleaseId;
			const hasExistingSelection = releases.some((release) => release.id === existingSelection);
			const targetTrackCount = resolveMusicBrainzTargetTrackCount();
			const recommendedSelection = pickDefaultMusicBrainzReleaseId(releases, targetTrackCount);
			if (hasExistingSelection) {
				if (targetTrackCount !== null) {
					const selectedRelease = releases.find((release) => release.id === existingSelection) ?? null;
					const selectedTrackCount = selectedRelease
						? resolveReleaseTrackCount(selectedRelease)
						: null;
					const selectedIsTrackCompatible =
						selectedTrackCount !== null && selectedTrackCount >= targetTrackCount;
					if (!selectedIsTrackCompatible) {
						selectedMusicBrainzReleaseId = recommendedSelection;
					}
				}
				return;
			}
			selectedMusicBrainzReleaseId = recommendedSelection;
		} catch (lookupError) {
			const message =
				lookupError instanceof Error ? lookupError.message : 'Failed to search MusicBrainz releases';
			musicBrainzReleaseLookupError = message;
			if (!options?.manual) {
				console.warn('[MusicBrainz] Release lookup failed on album page:', message);
			}
		} finally {
			if (lookupToken === musicBrainzReleaseLookupToken) {
				isMusicBrainzReleaseLookupLoading = false;
			}
		}
	}

	$effect(() => {
		if (!album) {
			musicBrainzReleaseOptions = [];
			selectedMusicBrainzReleaseId = '';
			isMusicBrainzReleaseLookupLoading = false;
			musicBrainzReleaseLookupError = null;
			hasMusicBrainzReleaseLookupAttempted = false;
			return;
		}
		void lookupMusicBrainzReleases();
	});

	function handlePlayAll() {
		// Validate tracks array
		if (!Array.isArray(tracks) || tracks.length === 0) {
			console.warn('No tracks available to play');
			return;
		}

		try {
			playbackFacade.loadQueue(tracks, 0, { autoPlay: true });
		} catch (error) {
			console.error('Failed to play album:', error);
			// Could show error toast here
		}
	}

	function handleAlbumPlaybackToggle() {
		if (!Array.isArray(tracks) || tracks.length === 0) {
			console.warn('No tracks available to play');
			return;
		}

		if (isAlbumPlaying) {
			playbackFacade.pause();
			return;
		}

		if (isAlbumQueue) {
			const firstTrackId = tracks[0]?.id;
			if ($machineCurrentTrack?.id !== firstTrackId) {
				playbackFacade.loadQueue(tracks, 0, { autoPlay: true });
			} else {
				playbackFacade.play();
			}
			return;
		}

		handlePlayAll();
	}

	function shuffleTracks(list: Track[]): Track[] {
		const items = list.slice();
		for (let i = items.length - 1; i > 0; i -= 1) {
			const j = Math.floor(Math.random() * (i + 1));
			[items[i], items[j]] = [items[j]!, items[i]!];
		}
		return items;
	}

	function handleBackNavigation() {
		const target = breadcrumbStore.goBack($page.url.pathname, '/');
		void goto(target);
	}

	function handleShufflePlay() {
		if (tracks.length === 0) return;
		const shuffled = shuffleTracks(tracks);
		playbackFacade.loadQueue(shuffled, 0, { autoPlay: true });
	}

	function stopQueuePolling(): void {
		queuePollToken += 1;
		if (queuePollInterval) {
			clearInterval(queuePollInterval);
			queuePollInterval = null;
		}
	}

	function resolveQueueProgress(total: number, completed: number): { total: number; completed: number } {
		const safeTotal = Number.isFinite(total) && total > 0 ? total : Math.max(0, tracks.length);
		const safeCompleted = Number.isFinite(completed) && completed > 0 ? completed : 0;
		if (safeTotal > 0) {
			return { total: safeTotal, completed: Math.min(safeTotal, safeCompleted) };
		}
		return { total: safeTotal, completed: safeCompleted };
	}

	async function pollQueueJob(jobId: string, pollToken: number): Promise<void> {
		if (!jobId || pollToken !== queuePollToken) {
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
			if (!payload.success || !payload.job || pollToken !== queuePollToken) {
				return;
			}

			const total = Number(payload.job.trackCount);
			const completed = Number(payload.job.completedTracks);
			const fallbackCompleted = Number(payload.job.progress) * (queueTotalTracks || tracks.length || 0);
			const progress = resolveQueueProgress(total, Number.isFinite(completed) ? completed : fallbackCompleted);
			queueTotalTracks = progress.total;
			queueCompletedTracks = progress.completed;

			switch (payload.job.status) {
				case 'queued':
					queueStatus = 'queued';
					downloadError = null;
					break;
				case 'processing':
					queueStatus = 'processing';
					downloadError = null;
					break;
				case 'paused':
					queueStatus = 'paused';
					downloadError = null;
					stopQueuePolling();
					break;
				case 'completed':
					queueStatus = 'completed';
					queueCompletedTracks = progress.total || progress.completed;
					downloadError = null;
					stopQueuePolling();
					break;
				case 'cancelled':
					queueStatus = 'cancelled';
					downloadError = null;
					stopQueuePolling();
					break;
				case 'failed':
					queueStatus = 'failed';
					downloadError = payload.job.error ?? 'Album download failed.';
					stopQueuePolling();
					break;
				default:
					break;
			}
		} catch {
			// Keep showing optimistic queue state until next poll succeeds.
		}
	}

	function startQueuePolling(jobId: string): void {
		stopQueuePolling();
		const token = queuePollToken;
		void pollQueueJob(jobId, token);
		queuePollInterval = setInterval(() => {
			void pollQueueJob(jobId, token);
		}, 1000);
	}

	async function cancelQueueDownload(): Promise<void> {
		if (!queueJobId) {
			return;
		}
		try {
			const response = await fetch(`/api/download-queue/${queueJobId}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ action: 'cancel' })
			});
			if (!response.ok) {
				const body = await response.text();
				throw new Error(body || 'Failed to cancel download');
			}
			queueStatus = 'cancelled';
			downloadError = null;
			stopQueuePolling();
		} catch (cancelError) {
			downloadError =
				cancelError instanceof Error && cancelError.message
					? cancelError.message
					: 'Unable to stop this download right now.';
		}
	}

	async function resumeQueueDownload(): Promise<void> {
		if (!queueJobId) {
			return;
		}
		try {
			const response = await fetch(`/api/download-queue/${queueJobId}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ action: 'resume' })
			});
			if (!response.ok) {
				const body = await response.text();
				throw new Error(body || 'Failed to resume download');
			}
			queueStatus = 'queued';
			downloadError = null;
			startQueuePolling(queueJobId);
		} catch (resumeError) {
			downloadError =
				resumeError instanceof Error && resumeError.message
					? resumeError.message
					: 'Unable to resume this download right now.';
		}
	}

	async function handleDownloadAll() {
		if (!album || tracks.length === 0) {
			return;
		}

		if (isQueueDownloadCancellable) {
			await cancelQueueDownload();
			return;
		}
		if (queueStatus === 'paused') {
			await resumeQueueDownload();
			return;
		}
		let forceOverwrite = false;
		if (albumInLibrary && queueStatus !== 'failed' && queueStatus !== 'cancelled') {
			if (downloadStoragePreference === 'server') {
				forceOverwrite = window.confirm(FORCE_OVERWRITE_CONFIRMATION);
				if (!forceOverwrite) {
					return;
				}
			} else if (!window.confirm(CLIENT_REDOWNLOAD_CONFIRMATION)) {
				return;
			}
		}

		if (isDownloadingAll || hasActiveQueueDownload) {
			return;
		}

		queueStatus = 'submitting';
		queueJobId = null;
		queueCompletedTracks = 0;
		queueTotalTracks = 0;
		isDownloadingAll = true;
		downloadedCount = 0;
		downloadError = null;
		const quality = $downloadPreferencesStore.downloadQuality;
		const mode = albumDownloadMode;

		try {
			let failedCount = 0;
			const result = await downloadAlbum(
				album,
				quality,
				{
					onTotalResolved: (total) => {
						queueTotalTracks = total;
						downloadedCount = 0;
					},
					onTrackDownloaded: (completed) => {
						queueStatus = 'processing';
						downloadedCount = completed;
						queueCompletedTracks = completed;
					},
					onTrackFailed: (track, error, attempt) => {
						if (attempt >= 3) {
							failedCount++;
						}
					}
				},
				album.artist?.name,
				{
					mode,
					convertAacToMp3: convertAacToMp3Preference,
					experimentalMusicBrainzTagging: experimentalMusicBrainzTaggingPreference,
					strictMusicBrainzMatching: strictMusicBrainzMatchingPreference,
					musicBrainzReleaseId:
						experimentalMusicBrainzTaggingPreference && selectedMusicBrainzReleaseId
							? selectedMusicBrainzReleaseId
							: undefined,
					storage: downloadStoragePreference,
					forceOverwrite
				}
			);

			if (result.storage === 'server' && result.jobId) {
				queueStatus = 'queued';
				queueJobId = result.jobId;
				queueTotalTracks = result.totalTracks;
				queueCompletedTracks = 0;
				isDownloadingAll = false;
				startQueuePolling(result.jobId);
				return;
			}

			queueJobId = null;
			queueTotalTracks = result.totalTracks;
			queueCompletedTracks = result.completedTracks;

			if (failedCount > 0) {
				queueStatus = 'failed';
				downloadError = `Download completed. ${failedCount} track${failedCount > 1 ? 's' : ''} failed after 3 attempts.`;
			} else {
				queueStatus = 'completed';
			}
		} catch (err) {
			console.error('Failed to download album:', err);
			queueStatus = 'failed';
			downloadError =
				err instanceof Error && err.message
					? err.message
					: 'Failed to download one or more tracks.';
		} finally {
			if (!queueJobId) {
				isDownloadingAll = false;
			}
		}
	}

	function buildAlbumCoverUrl(coverId?: string | null): string | undefined {
		if (!coverId || typeof coverId !== 'string') {
			return undefined;
		}
		return `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/1280x1280.jpg`;
	}

	async function handleRepairAlbum(): Promise<void> {
		if (!album || tracks.length === 0 || isRepairingAlbum) {
			return;
		}
		isRepairingAlbum = true;
		repairMessage = null;
		downloadError = null;
		try {
			const quality = $downloadPreferencesStore.downloadQuality;
			const result = await repairAlbumInLibrary({
				albumId: album.id,
				artistName: album.artist?.name,
				albumTitle: album.title,
				quality,
				coverUrl: buildAlbumCoverUrl(album.cover),
				tracks: tracks.map((track) => ({
					trackId: track.id,
					trackTitle: track.version ? `${track.title} (${track.version})` : track.title,
					trackNumber: track.trackNumber,
					durationSeconds: track.duration
				}))
			});
			if (!result.success || !result.summary) {
				throw new Error(result.error || 'Album integrity scan failed');
			}
			if (result.summary.queued > 0) {
				repairMessage =
					`Queued ${result.summary.queued} repair download(s): ` +
					`${result.summary.corrupt} corrupt file(s) targeted.`;
			} else {
				repairMessage = 'Album integrity verified: all tracks are complete and healthy.';
			}
		} catch (error) {
			downloadError =
				error instanceof Error ? error.message : 'Failed to inspect and repair this album.';
		} finally {
			isRepairingAlbum = false;
		}
	}

	const totalDuration = $derived(tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0));
	const expectedTrackCount = $derived.by(() => {
		const count = Number(album?.numberOfTracks);
		if (!Number.isFinite(count) || count <= 0) {
			return null;
		}
		return Math.trunc(count);
	});
	const missingTrackNumbers = $derived.by(() => {
		if (!expectedTrackCount) {
			return [] as number[];
		}

		const observedTrackNumbers = new Set<number>();
		for (const track of tracks) {
			const trackNumber = Number(track.trackNumber);
			if (Number.isFinite(trackNumber) && trackNumber > 0) {
				observedTrackNumbers.add(Math.trunc(trackNumber));
			}
		}

		const missing: number[] = [];
		for (let expected = 1; expected <= expectedTrackCount; expected += 1) {
			if (!observedTrackNumbers.has(expected)) {
				missing.push(expected);
			}
		}
		return missing;
	});
	const hasIncompleteTrackList = $derived.by(
		() =>
			expectedTrackCount !== null &&
			(tracks.length < expectedTrackCount || missingTrackNumbers.length > 0)
	);
	const missingTrackLabel = $derived.by(() => missingTrackNumbers.map((number) => `#${number}`).join(', '));
</script>

<svelte:head>
	<title>{album?.title || 'Album'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="ui-page flex items-center justify-center py-24" data-ui-archetype="detail" data-ui-route="album">
		<LoaderCircle size={16} class="h-16 w-16 animate-spin text-white/80" />
	</div>
{:else if error}
	<div class="ui-page py-12" data-ui-archetype="detail" data-ui-route="album">
		<div class="ui-surface-card border-red-500/40 bg-red-950/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-200">Error Loading Album</h2>
			<p class="text-red-100/85">{error}</p>
			<a
				href="/"
				class="ui-action-button mt-4 inline-flex"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if album}
	<div
		class="ui-page space-y-6 pb-32 pt-4 lg:pb-40"
		data-ui-archetype="detail"
		data-ui-route="album"
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

		<!-- Album Header -->
		<div class="flex flex-col gap-8 md:flex-row" data-ui-block="entity-hero">
			<!-- Album Cover -->
			{#if album.videoCover || album.cover}
				<div
					class="aspect-square w-full flex-shrink-0 overflow-hidden rounded-xl border border-white/12 bg-white/5 md:w-80"
				>
					{#if album.videoCover}
						<video
							src={losslessAPI.getVideoCoverUrl(album.videoCover, '640')}
							poster={album.cover ? losslessAPI.getCoverUrl(album.cover, '640') : undefined}
							aria-label={album.title}
							class="h-full w-full object-cover"
							autoplay
							loop
							muted
							playsinline
							preload="metadata"
						></video>
					{:else}
						{@const coverCacheKey = getCoverCacheKey({
							coverId: album.cover,
							size: '640',
							proxy: false,
							overrideKey: `album:${album.id}`
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
							class="h-full w-full object-cover"
							loading="eager"
						/>
					{/if}
				</div>
			{/if}

			<!-- Album Info -->
			<div class="flex flex-1 flex-col justify-end">
				<p class="mb-2 text-base text-gray-400">ALBUM</p>
				<h1 class="mb-4 text-4xl font-bold md:text-6xl">{album.title}</h1>
				<div class="mb-4 flex items-center gap-1">
					{#if album.explicit}
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
					{#if album.artist}
						<div class="text-left text-xl text-gray-300">
							<ArtistLinks artists={[album.artist]} />
						</div>
					{/if}
				</div>

				<div class="mb-6 flex flex-wrap items-center gap-4 text-base text-gray-400">
					{#if album.releaseDate}
						<div class="flex items-center gap-1">
							<Calendar size={16} />
							{new Date(album.releaseDate).getFullYear()}
						</div>
					{/if}
					{#if tracks.length > 0 || album.numberOfTracks}
						<div class="flex items-center gap-1">
							<Disc size={16} />
							{tracks.length || album.numberOfTracks} tracks
						</div>
					{/if}
					{#if totalDuration > 0}
						<div class="flex items-center gap-1">
							<Clock size={16} />
							{losslessAPI.formatDuration(totalDuration)} total
						</div>
					{/if}
					{#if album.mediaMetadata?.tags}
						{#each album.mediaMetadata.tags as tag (tag)}
							<div class="ui-meta-pill">
								{tag}
							</div>
						{/each}
					{/if}
				</div>
				{#if hasIncompleteTrackList}
					<p class="mb-4 ui-action-status" data-tone="warning">
						Tracklist may be incomplete from source metadata: showing {tracks.length}/{expectedTrackCount}
						tracks{#if missingTrackLabel} (missing {missingTrackLabel}){/if}.
					</p>
				{/if}
				<div data-ui-block="context-metadata">
					<ActionPanel className="mb-6" panelRole="musicbrainz-release">
					<svelte:fragment slot="header">
						<div class="ui-action-subpanel__header">
						<p class="ui-action-panel__intent">MusicBrainz Release Metadata</p>
						<button
							type="button"
							onclick={() => lookupMusicBrainzReleases({ manual: true })}
							class="ui-chip-button ui-chip-button--compact"
							disabled={isMusicBrainzReleaseLookupLoading}
						>
							{#if isMusicBrainzReleaseLookupLoading}
								Refreshing…
							{:else}
								Refresh Matches
							{/if}
						</button>
						</div>
					</svelte:fragment>
					{#if isMusicBrainzReleaseLookupLoading && musicBrainzReleaseOptions.length === 0}
						<p class="ui-action-status">Searching MusicBrainz releases…</p>
					{:else if musicBrainzReleaseOptions.length > 0}
						<label class="ui-action-panel__intent" for="musicbrainz-release-select">
							Selected Release
						</label>
						<select
							id="musicbrainz-release-select"
							class="ui-select w-full"
							bind:value={selectedMusicBrainzReleaseId}
						>
							{#each musicBrainzReleaseOptions as release, index (release.id)}
								<option value={release.id}>
									{release.id === selectedMusicBrainzReleaseId
										? 'Selected - '
										: index === 0
											? 'Best Score - '
											: ''}{formatMusicBrainzReleaseOption(release)}
								</option>
							{/each}
						</select>
						{#if selectedMusicBrainzRelease}
							<DataGrid>
								{#if selectedMusicBrainzRelease.trackCount}
									<div class="ui-data-point">
										<p class="ui-data-point__label">Track Count</p>
										<p class="ui-data-point__value">{selectedMusicBrainzRelease.trackCount}</p>
									</div>
								{/if}
								{#if selectedMusicBrainzRelease.date}
									<div class="ui-data-point">
										<p class="ui-data-point__label">Release Date</p>
										<p class="ui-data-point__value">{selectedMusicBrainzRelease.date}</p>
									</div>
								{/if}
								{#if selectedMusicBrainzRelease.country}
									<div class="ui-data-point">
										<p class="ui-data-point__label">Country</p>
										<p class="ui-data-point__value">{selectedMusicBrainzRelease.country}</p>
									</div>
								{/if}
								{#if selectedMusicBrainzRelease.status}
									<div class="ui-data-point">
										<p class="ui-data-point__label">Status</p>
										<p class="ui-data-point__value">{selectedMusicBrainzRelease.status}</p>
									</div>
								{/if}
								{#if selectedMusicBrainzRelease.barcode}
									<div class="ui-data-point">
										<p class="ui-data-point__label">Barcode</p>
										<p class="ui-data-point__value">{selectedMusicBrainzRelease.barcode}</p>
									</div>
								{/if}
								<div class="ui-data-point">
									<p class="ui-data-point__label">Release MBID</p>
									<p class="ui-data-point__value">{selectedMusicBrainzRelease.id}</p>
								</div>
							</DataGrid>
							<p class="ui-action-status">
								<a
									href={`https://musicbrainz.org/release/${selectedMusicBrainzRelease.id}`}
									target="_blank"
									rel="noreferrer"
									class="text-gray-300 underline decoration-dotted underline-offset-2 transition-colors hover:text-white"
								>
									Open release in MusicBrainz
								</a>
							</p>
						{/if}
					{:else if hasMusicBrainzReleaseLookupAttempted}
						<p class="ui-action-status">No MusicBrainz release matches found for this album.</p>
					{/if}
					{#if musicBrainzReleaseLookupError}
						<p class="ui-action-status" data-tone="error">{musicBrainzReleaseLookupError}</p>
					{/if}
					<p class="ui-action-status">
						{#if experimentalMusicBrainzTaggingPreference}
							The selected release is used for MusicBrainz tagging when downloading this album.
						{:else}
							Enable experimental MusicBrainz tagging in Settings to apply this release when downloading.
						{/if}
					</p>
					</ActionPanel>
				</div>

				{#if tracks.length > 0}
					<div data-ui-block="primary-actions">
					<ActionPanel
						intent="Album Actions"
						summary="Play, shuffle, download, and maintain this album from one action surface."
						intentful={true}
						panelRole="album-actions"
					>
						<div class="ui-action-row ui-action-row--progressive">
							<button
								onclick={handleAlbumPlaybackToggle}
								class="ui-action-button ui-action-button--primary"
								aria-label={isAlbumPlaying ? 'Pause album' : 'Play album'}
							>
								{#if isAlbumPlaying}
									<Pause size={16} fill="currentColor" />
									Pause
								{:else}
									<Play size={16} fill="currentColor" />
									Play Album
								{/if}
							</button>
							<button
								onclick={handleShufflePlay}
								class="ui-action-button"
							>
								<Shuffle size={16} />
								Shuffle Album
							</button>
							<button
								onclick={handleDownloadAll}
								class="ui-action-button"
								disabled={queueStatus === 'submitting'}
								aria-label={isQueueDownloadCancellable ? 'Stop album download' : 'Download album'}
								aria-busy={hasActiveQueueDownload || isDownloadingAll}
							>
								{#if isQueueDownloadCancellable}
									<X size={16} />
									Stop Download
								{:else if queueStatus === 'submitting'}
									<LoaderCircle size={16} class="animate-spin" />
									Queueing…
								{:else if isDownloadingAll}
									<LoaderCircle size={16} class="animate-spin" />
									Downloading {downloadedCount}/{tracks.length}
								{:else}
									<Download size={16} />
									{queueStatus === 'failed'
										? 'Retry Download'
										: queueStatus === 'paused'
											? 'Resume Download'
										: queueStatus === 'cancelled'
											? 'Resume Download'
											: queueStatus === 'completed'
												? 'Download Again'
												: albumInLibrary && queueStatus === 'idle'
													? 'Redownload Album'
												: 'Download Album'}
								{/if}
							</button>
							{#if albumInLibrary}
								<button
									onclick={handleRepairAlbum}
									class="ui-action-button"
									disabled={isRepairingAlbum}
									aria-busy={isRepairingAlbum}
								>
									{#if isRepairingAlbum}
										<LoaderCircle size={16} class="animate-spin" />
										Checking Integrity…
									{:else}
										Repair Corrupt Files
									{/if}
								</button>
							{/if}
							<ShareButton type="album" id={album.id} variant="secondary" />
						</div>
						{#if queueStatus === 'queued'}
							<p class="ui-action-status" data-tone="info">
								Queued on server. Open Download Manager for live progress.
							</p>
						{:else if queueStatus === 'processing'}
							<p class="ui-action-status" data-tone="info">
								Downloading on server
								{#if queueTotalTracks > 0}
									({queueCompletedTracks}/{queueTotalTracks} tracks)
								{/if}
								…
							</p>
						{:else if queueStatus === 'completed'}
							<p class="ui-action-status" data-tone="success">Album download completed.</p>
						{:else if queueStatus === 'cancelled'}
							<p class="ui-action-status" data-tone="warning">Album download stopped.</p>
						{:else if queueStatus === 'paused'}
							<p class="ui-action-status" data-tone="warning">Album download paused.</p>
						{:else if albumInLibrary}
							<p class="ui-action-status" data-tone="success">
								{#if downloadStoragePreference === 'server'}
									Already in local library ({albumLibraryTrackCount} track{albumLibraryTrackCount === 1 ? '' : 's'} found). Click "Redownload Album" to overwrite.
								{:else}
									Already in local library ({albumLibraryTrackCount} track{albumLibraryTrackCount === 1 ? '' : 's'} found). Browser redownloads may append (2) to filenames.
								{/if}
							</p>
						{/if}
						{#if repairMessage}
							<p class="ui-action-status" data-tone="success">{repairMessage}</p>
						{/if}
						{#if downloadError}
							<p class="ui-action-status" data-tone="error">{downloadError}</p>
						{/if}
					</ActionPanel>
					</div>
				{/if}
			</div>
		</div>

		<!-- Tracks -->
		<div class="mt-8 space-y-4" data-ui-block="main-content">
			<h2 class="text-2xl font-bold">Tracks</h2>
			{#if tracks.length === 0}
				<StateBlock
					kind="empty"
					title="No tracks available"
					message="Try refreshing this album or search for individual songs."
				/>
			{:else}
				<TrackList {tracks} showAlbum={false} />
			{/if}
		</div>
		<div data-ui-block="secondary-content">
			{#if album.copyright}
				<p class="pt-2 text-sm text-gray-500">{album.copyright}</p>
			{/if}
		</div>
	</div>
{/if}
