<!--
	ARCHITECTURAL WARNING: This component has complex reactive effects that are prone to infinite loops.
	DO NOT MODIFY the $effect blocks without architectural review. Changes here can cause:
	- Infinite playback loops
	- Unresponsive UI
	- Battery drain on mobile devices

	If you need to modify playback logic, consider the state machine approach from the stabilization plan.
-->
<script lang="ts">
	console.log('[AudioPlayer] Component loading');
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { playerStoreAdapter as playerStore } from '$lib/stores/playerStoreAdapter';
	import { uiStore } from '$lib/stores/uiStore';
	import { lyricsStore } from '$lib/stores/lyrics';
	import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
	import { downloadUiStore, ffmpegBanner, activeTrackDownloads, erroredTrackDownloads } from '$lib/stores/downloadUi';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { buildTrackFilename } from '$lib/downloads';
	import { formatArtists } from '$lib/utils';
	import type { Track, AudioQuality, SonglinkTrack, PlayableTrack } from '$lib/types';
	import { isSonglinkTrack } from '$lib/types';
	import { convertToTidal, extractTidalInfo } from '$lib/utils/songlink';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { createMediaSessionController } from '$lib/controllers/mediaSessionController';
	import { createAudioElementController } from '$lib/controllers/audioElementController';
	import { createPlaybackFallbackController } from '$lib/controllers/playbackFallbackController';
	import { createTrackLoadController } from '$lib/controllers/trackLoadController';
	import { createPlaybackTransitions } from '$lib/controllers/playbackTransitions';
	import {
		Play,
		Pause,
		SkipForward,
		SkipBack,
		Volume2,
		VolumeX,
		ListMusic,
		Trash2,
		X,
		Shuffle,
		ScrollText,
		Download,
		LoaderCircle,
		Music
	} from 'lucide-svelte';




	let audioElement: HTMLAudioElement;
	let streamUrl = $state('');
let isMuted = $state(false);
let previousVolume = 0.8;
	let currentTrackId: number | null = null;
	let loadSequence = 0;
	let bufferedPercent = $state(0);
	let lastQualityTrackId: number | string | null = null;
	let lastQualityForTrack: AudioQuality | null = null;
	let currentPlaybackQuality = $state<AudioQuality | null>(null);
	let isDownloadingCurrentTrack = $state(false);


	const { onHeightChange = () => {}, headless = false } = $props<{
		onHeightChange?: (height: number) => void;
		headless?: boolean;
	}>();

	let containerElement = $state<HTMLDivElement | null>(null);
	let resizeObserver: ResizeObserver | null = null;
	let showQueuePanel = $state(false);

	const PRELOAD_THRESHOLD_SECONDS = 12;
	const hiResQualities = new Set<AudioQuality>(['HI_RES_LOSSLESS']);
	const sampleRateLabel = $derived(formatSampleRate($playerStore.sampleRate));
	const bitDepthLabel = $derived(formatBitDepth($playerStore.bitDepth));
	const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
	let dashPlaybackActive = false;
	let supportsLosslessPlayback = true;
	let resumeAfterFallback = false;
let pendingPlayAfterSource = false;

	function requestAudioPlayback(reason: string) {
		if (!audioElement) return;
		const promise = audioElement.play();
		if (promise?.catch) {
			promise.catch((error) => {
				console.error(`[AudioPlayer] play() failed during ${reason}`, error);
				playerStore.setLoading(false);
				// Stop trying to play if we keep failing
				if (reason === 'state machine play request') {
					console.warn('[AudioPlayer] Playback failed, pausing to prevent loops');
					uiStore.pausePlayback();
				}
				if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
					if (error.name === 'AbortError') {
						pendingPlayAfterSource = true;
					}
				}
			});
		}
	}

	const mediaSessionController = createMediaSessionController(
		playerStore,
		() => audioElement,
		{
			onPlay: () => {
				playbackTransitions.play();
			},
			onPause: () => {
				playbackTransitions.pause();
				audioElement?.pause();
			},
			onPrevious: () => {
				handlePrevious();
			},
			onNext: () => {
				playbackTransitions.next();
			},
			onSeekTo: (time: number) => {
				if (!audioElement) return;
				const nextTime = Math.max(0, time);
				audioElement.currentTime = nextTime;
				playbackTransitions.seekTo(nextTime);
			},
			onSeekBy: (delta: number) => {
				if (!audioElement) return;
				const tentative = audioElement.currentTime + delta;
				const duration = audioElement.duration;
				const bounded = Number.isFinite(duration)
					? Math.min(Math.max(0, tentative), Math.max(duration, 0))
					: Math.max(0, tentative);
				audioElement.currentTime = bounded;
				playbackTransitions.seekTo(bounded);
			},
			onStop: () => {
				playbackTransitions.pause();
				if (audioElement) {
					audioElement.pause();
					audioElement.currentTime = 0;
				}
				playbackTransitions.seekTo(0);
			},
			onPlayRequest: (reason: string) => {
				requestAudioPlayback(reason);
			}
		}
	);

	const trackLoadController = createTrackLoadController({
		playerStore,
		getAudioElement: () => audioElement,
		getCurrentTrackId: () => currentTrackId,
		getSupportsLosslessPlayback: () => supportsLosslessPlayback,
		setStreamUrl: (value) => {
			streamUrl = value;
		},
		setBufferedPercent: (value) => {
			bufferedPercent = value;
		},
		setCurrentPlaybackQuality: (value) => {
			currentPlaybackQuality = value;
		},
		setDashPlaybackActive: (value) => {
			dashPlaybackActive = value;
		},
		setLoading: (value) => {
			playerStore.setLoading(value);
		},
		setSampleRate: (value) => playerStore.setSampleRate(value),
		setBitDepth: (value) => playerStore.setBitDepth(value),
		setReplayGain: (value) => playerStore.setReplayGain(value),
		createSequence: () => ++loadSequence,
		getSequence: () => loadSequence,
		isHiResQuality: (quality) => (quality ? hiResQualities.has(quality) : false),
		preloadThresholdSeconds: PRELOAD_THRESHOLD_SECONDS
	});

	const audioElementController = createAudioElementController({
		playerStore,
		getAudioElement: () => audioElement,
		onSetCurrentTime: (time) => playbackTransitions.seekTo(time),
		onSetDuration: (duration) => playerStore.setDuration(duration),
		onNextTrack: () => playbackTransitions.next(),
		onBufferedPercentChange: (value) => {
			bufferedPercent = value;
		},
		onMaybePreloadNextTrack: (remaining) => {
			trackLoadController.maybePreloadNextTrack(remaining);
		},
		mediaSessionController
	});

	const playbackFallbackController = createPlaybackFallbackController({
		getCurrentTrack: () => $playerStore.currentTrack,
		getPlayerQuality: () => $playerStore.quality,
		getCurrentPlaybackQuality: () => currentPlaybackQuality,
		getIsPlaying: () => $playerStore.isPlaying,
		isFirefox: () => isFirefox,
		getDashPlaybackActive: () => dashPlaybackActive,
		setDashPlaybackActive: (value) => {
			dashPlaybackActive = value;
		},
		setLoading: (value) => {
			playerStore.setLoading(value);
		},
		loadStandardTrack: (track, quality, sequence) =>
			trackLoadController.loadStandardTrack(track, quality, sequence),
		createSequence: () => ++loadSequence,
		setResumeAfterFallback: (value) => {
			resumeAfterFallback = value;
		}
	});

	const playbackTransitions = createPlaybackTransitions(playerStore);

	let isSeeking = false;

	let seekBarElement = $state<HTMLButtonElement | null>(null);

	// -----------------------------
	// NEW: dismiss / auto-hide logic
	// -----------------------------
	let playerDismissed = $state(false);

  const hasTrack = $derived(Boolean($playerStore.currentTrack));
  const currentTrackDownloadTask = $derived($activeTrackDownloads.find(task => task.trackId === $playerStore.currentTrack?.id));
  const currentTrackErrorTask = $derived($erroredTrackDownloads.find(task => task.trackId === $playerStore.currentTrack?.id));
  const hasOverlays = $derived($activeTrackDownloads.length > 0 || $ffmpegBanner);

	// Show player when:
	// - not dismissed
	// - AND either a track exists OR overlays exist (downloads/ffmpeg banner)
	const shouldShowPlayer = $derived(!playerDismissed && (hasTrack || hasOverlays));

	function dismissPlayer() {
		playerDismissed = true;
		showQueuePanel = false;

		// Optional: if you want dismiss to stop playback, uncomment:
		// playerStore.pause();
		// playerStore.clearQueue(); // or playerStore.reset();
	}

	function restorePlayer() {
		playerDismissed = false;
	}

	// Auto-unhide when a track appears again
	$effect(() => {
		if (hasTrack) {
			playerDismissed = false;
		}
	});
	// -----------------------------

	async function convertSonglinkTrackToTidal(songlinkTrack: SonglinkTrack): Promise<Track> {

		if (songlinkTrack.tidalId) {
			try {
				const trackLookup = await losslessAPI.getTrack(songlinkTrack.tidalId);
				if (trackLookup?.track) {
					return trackLookup.track;
				}
			} catch (e) {
				console.warn('Failed to fetch track using pre-calculated tidalId, falling back to extraction', e);
			}
		}

		const tidalInfo = extractTidalInfo(songlinkTrack.songlinkData);

		if (!tidalInfo || tidalInfo.type !== 'track') {
			console.warn('No TIDAL track in Songlink data, attempting conversion...');
			const fallbackTidalInfo = await convertToTidal(songlinkTrack.sourceUrl, {
				userCountry: 'US',
				songIfSingle: true
			});

			if (!fallbackTidalInfo || fallbackTidalInfo.type !== 'track') {
				throw new Error(`Could not find TIDAL equivalent for: ${songlinkTrack.title}`);
			}

			const trackId = Number(fallbackTidalInfo.id);
			if (!Number.isFinite(trackId) || trackId <= 0) {
				throw new Error(
					`Invalid TIDAL track ID for: ${songlinkTrack.title} (got: ${fallbackTidalInfo.id})`
				);
			}

			const trackLookup = await losslessAPI.getTrack(trackId);
			if (!trackLookup?.track) {
				throw new Error(`Failed to fetch TIDAL track for: ${songlinkTrack.title}`);
			}

			return trackLookup.track;
		}

		const trackId = Number(tidalInfo.id);
		if (!Number.isFinite(trackId) || trackId <= 0) {
			console.warn(`Non-numeric TIDAL ID (${tidalInfo.id}), attempting fallback conversion...`);
			const fallbackTidalInfo = await convertToTidal(songlinkTrack.sourceUrl, {
				userCountry: 'US',
				songIfSingle: true
			});

			if (!fallbackTidalInfo || fallbackTidalInfo.type !== 'track') {
				throw new Error(`Could not find TIDAL equivalent for: ${songlinkTrack.title}`);
			}

			const fallbackId = Number(fallbackTidalInfo.id);
			if (!Number.isFinite(fallbackId) || fallbackId <= 0) {
				throw new Error(`No valid TIDAL track found for: ${songlinkTrack.title}`);
			}

			const trackLookup = await losslessAPI.getTrack(fallbackId);
			if (!trackLookup?.track) {
				throw new Error(`Failed to fetch TIDAL track for: ${songlinkTrack.title}`);
			}

			return trackLookup.track;
		}

		const trackLookup = await losslessAPI.getTrack(trackId);
		if (!trackLookup?.track) {
			throw new Error(`Failed to fetch TIDAL track for: ${songlinkTrack.title}`);
		}

		return trackLookup.track;
	}

	const convertingTracks = new Set<string>();

	$effect(() => {
		const current = $playerStore.currentTrack;
		if (current && isSonglinkTrack(current)) {

			if (convertingTracks.has(current.id)) {
				return;
			}

			convertingTracks.add(current.id);

			convertSonglinkTrackToTidal(current)
				.then((tidalTrack) => {
					const state = get(playerStore);
					if (
						state.currentTrack &&
						isSonglinkTrack(state.currentTrack) &&
						state.currentTrack.id === current.id
					) {
						playerStore.loadTrack(tidalTrack);
						// Conversion completed
					}
				})
				.catch((error) => {
					console.error('[Conversion Effect] Conversion FAILED:', error);
					alert(`Failed to play track: ${error instanceof Error ? error.message : 'Unknown error'}`);
				})
				.finally(() => {
					convertingTracks.delete(current.id);
				});
		}
	});

	$effect(() => {
		const current = $playerStore.currentTrack;
		if (!audioElement || !current) {
			if (!current) {
				currentTrackId = null;
				streamUrl = '';
				bufferedPercent = 0;
				dashPlaybackActive = false;
				lastQualityTrackId = null;
				lastQualityForTrack = null;
				currentPlaybackQuality = null;
			}
		} else if (current.id !== currentTrackId) {
			if (!isSonglinkTrack(current)) {
				currentTrackId = current.id;
				streamUrl = '';
				bufferedPercent = 0;
				dashPlaybackActive = false;
				lastQualityTrackId = current.id;
				lastQualityForTrack = $playerStore.quality;
				currentPlaybackQuality = null;
				loadTrack(current);
			}
		}
	});

	// Integrate with state machine for deterministic playback control
	let playbackAttemptCount = 0;

	// Subscribe to state machine changes and handle playback
	const unsubscribePlayback = uiStore.subscribeToPlayback((state, previousState) => {
		if (state.status === 'playing' && previousState.status !== 'playing' && audioElement) {
			// State machine transitioned to playing - start playback
			playbackAttemptCount++;
			console.info(`[AudioPlayer] State machine requested play (attempt ${playbackAttemptCount})`);
			requestAudioPlayback('state machine play request');

			// Reset counter after too many attempts
			if (playbackAttemptCount > 5) {
				console.warn('[AudioPlayer] Too many playback attempts, resetting counter');
				playbackAttemptCount = 0;
			}
		} else if (state.status === 'paused' && audioElement) {
			// State machine transitioned to paused - pause audio
			audioElement.pause();
			playbackAttemptCount = 0; // Reset on pause
		}
	});

	// Cleanup subscription on destroy
	onDestroy(() => {
		unsubscribePlayback();
	});

	$effect(() => {
		const track = $playerStore.currentTrack;
		if (!audioElement || !track) {
			return;
		}
		const quality = $playerStore.quality;
		if (lastQualityTrackId === track.id && lastQualityForTrack === quality) {
			return;
		}
		lastQualityTrackId = track.id;
		lastQualityForTrack = quality;
		loadTrack(track);
	});

	$effect(() => {
		if (showQueuePanel && $playerStore.queue.length === 0) {
			showQueuePanel = false;
		}
	});

	$effect(() => {
		mediaSessionController.updateMetadata($playerStore.currentTrack);
	});

	$effect(() => {
		const hasTrack = Boolean($playerStore.currentTrack);
		mediaSessionController.updatePlaybackState(
			hasTrack ? ($playerStore.isPlaying ? 'playing' : 'paused') : 'none'
		);
	});

	function toggleQueuePanel() {
		showQueuePanel = !showQueuePanel;
	}

	function closeQueuePanel() {
		showQueuePanel = false;
	}

	function playFromQueue(index: number) {
		console.info('[AudioPlayer] playFromQueue called for index', index);
		playbackTransitions.playFromQueueIndex(index);
		if (audioElement && audioElement.paused) {
			requestAudioPlayback('queue play');
		}
	}

	function removeFromQueue(index: number, event?: MouseEvent) {
		if (event) {
			event.stopPropagation();
		}
		playerStore.removeFromQueue(index);
	}

	function clearQueue() {
		playbackTransitions.clearQueue();
	}

	function handleShuffleQueue() {
		playerStore.shuffleQueue();
	}

	$effect(() => {
		if (audioElement) {
			const baseVolume = $playerStore.volume;
			const replayGain = $playerStore.replayGain;

			if (replayGain !== null && typeof replayGain === 'number') {
				const gainFactor = Math.pow(10, replayGain / 20);
				const adjusted = baseVolume * gainFactor;
				audioElement.volume = Math.min(1, Math.max(0, adjusted));
			} else {
				audioElement.volume = baseVolume;
			}
		}
	});

	$effect(() => {
		if ($playerStore.isPlaying && !$playerStore.isLoading && audioElement) {
			console.info('[AudioPlayer] store requested play; ensuring audio element is playing');
			requestAudioPlayback('store play request');
		} else if (!$playerStore.isPlaying && audioElement) {
			audioElement.pause();
		}
	});

	async function loadTrack(track: PlayableTrack) {
		const trackId = typeof track?.id === 'number' || typeof track?.id === 'string' ? track.id : null;
		if (trackId !== null) {
			playbackFallbackController.resetForTrack(trackId);
		}
		await trackLoadController.loadTrack(track);
	}

	function handleTimeUpdate() {
		audioElementController.handleTimeUpdate();
	}

	function handleAudioError(event: Event) {
		playbackFallbackController.handleAudioError(event);
	}

	function handleDurationChange() {
		audioElementController.handleDurationChange();
	}

	function updateBufferedPercent() {
		audioElementController.updateBufferedPercent();
	}

	function handleProgress() {
		audioElementController.handleProgress();
	}

	function handleLoadedData() {
		playerStore.setLoading(false);
		updateBufferedPercent();

		const state = get(playerStore);
		if (audioElement && state.currentTime > 0 && Math.abs(audioElement.currentTime - state.currentTime) > 1) {
			audioElement.currentTime = state.currentTime;
		}

		mediaSessionController.updatePositionState();
		if (audioElement && $playerStore.isPlaying && audioElement.paused) {
			const shouldResume = resumeAfterFallback || pendingPlayAfterSource || $playerStore.isPlaying;
			resumeAfterFallback = false;
			pendingPlayAfterSource = false;
			if (shouldResume) {
				requestAudioPlayback('source loaded');
			}
		}
	}

	function getPercent(current: number, total: number): number {
		if (!Number.isFinite(total) || total <= 0) {
			return 0;
		}
		return Math.max(0, Math.min(100, (current / total) * 100));
	}

	function handlePrevious() {
		if (audioElement && (audioElement.currentTime > 5 || $playerStore.queueIndex <= 0)) {
			audioElement.currentTime = 0;
			playbackTransitions.seekTo(0);
			mediaSessionController.updatePositionState();
		} else {
			playbackTransitions.previous();
		}
	}

	function handleEnded() {
		audioElementController.handleEnded();
	}

	function handleSeek(event: MouseEvent | TouchEvent) {
		if (!seekBarElement) return;

		const rect = seekBarElement.getBoundingClientRect();
		const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
		const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const newTime = percent * $playerStore.duration;

		if (audioElement) {
			audioElement.currentTime = newTime;
			playbackTransitions.seekTo(newTime);
			mediaSessionController.updatePositionState();
		}
	}

	function handleSeekStart(event: MouseEvent | TouchEvent) {
		event.preventDefault();
		isSeeking = true;
		handleSeek(event);

		const handleMove = (e: MouseEvent | TouchEvent) => {
			if (isSeeking) {
				handleSeek(e);
			}
		};

		const handleEnd = () => {
			isSeeking = false;
			document.removeEventListener('mousemove', handleMove as EventListener);
			document.removeEventListener('mouseup', handleEnd);
			document.removeEventListener('touchmove', handleMove as EventListener);
			document.removeEventListener('touchend', handleEnd);
		};

		document.addEventListener('mousemove', handleMove as EventListener);
		document.addEventListener('mouseup', handleEnd);
		document.addEventListener('touchmove', handleMove as EventListener);
		document.addEventListener('touchend', handleEnd);
	}

	function handleVolumeChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const newVolume = parseFloat(target.value);
		playerStore.setVolume(newVolume);
		if (newVolume > 0 && isMuted) {
			isMuted = false;
		}
	}

	function handleLyricsSeekEvent(event: Event) {
		const customEvent = event as CustomEvent<{ timeSeconds?: number }>;
		const targetSeconds = customEvent.detail?.timeSeconds;
		if (typeof targetSeconds !== 'number' || !audioElement) {
			return;
		}

		const seekSeconds = Math.max(0, targetSeconds);
		audioElement.currentTime = seekSeconds;
		playbackTransitions.seekTo(seekSeconds);
		mediaSessionController.updatePositionState();

		const state = get(playerStore);
		if (!state.isPlaying) {
			console.info('[AudioPlayer] Lyrics seek requested playback; resuming audio');
			playbackTransitions.play();
		}

		requestAudioPlayback('lyrics seek');
	}

	async function handleDownloadCurrentTrack() {
		const track = $playerStore.currentTrack;
		if (!track || isDownloadingCurrentTrack || isSonglinkTrack(track)) {
			return;
		}

		const quality = $playerStore.quality;
		const convertAacToMp3 = $userPreferencesStore.convertAacToMp3;
		const downloadCoverSeperately = $userPreferencesStore.downloadCoversSeperately;
		const filename = buildTrackFilename(
			track.album,
			track,
			quality,
			formatArtists(track.artists),
			convertAacToMp3
		);

		const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename, {
			subtitle: track.album?.title ?? track.artist?.name
		});

		isDownloadingCurrentTrack = true;
		downloadUiStore.skipFfmpegCountdown();

		try {
			await losslessAPI.downloadTrack(track.id, quality, filename, {
				signal: controller.signal,
				onProgress: (progress: TrackDownloadProgress) => {
					if (progress.stage === 'downloading') {
						downloadUiStore.updateTrackProgress(taskId, progress.receivedBytes, progress.totalBytes);
					} else {
						downloadUiStore.updateTrackStage(taskId, progress.progress);
					}
				},
				onFfmpegCountdown: ({ totalBytes }) => {
					if (typeof totalBytes === 'number') {
						downloadUiStore.startFfmpegCountdown(totalBytes, { autoTriggered: false });
					} else {
						downloadUiStore.startFfmpegCountdown(0, { autoTriggered: false });
					}
				},
				onFfmpegStart: () => downloadUiStore.startFfmpegLoading(),
				onFfmpegProgress: (value) => downloadUiStore.updateFfmpegProgress(value),
				onFfmpegComplete: () => downloadUiStore.completeFfmpeg(),
				onFfmpegError: (error) => downloadUiStore.errorFfmpeg(error),
				ffmpegAutoTriggered: false,
				convertAacToMp3,
				downloadCoverSeperately
			});
			downloadUiStore.completeTrackDownload(taskId);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				downloadUiStore.completeTrackDownload(taskId);
			} else {
				console.error('Failed to download track:', error);
				const fallbackMessage = 'Failed to download track. Please try again.';
				const message = error instanceof Error && error.message ? error.message : fallbackMessage;
				downloadUiStore.errorTrackDownload(taskId, message);
				alert(message);
			}
		} finally {
			isDownloadingCurrentTrack = false;
		}
	}

	function toggleMute() {
		if (isMuted) {
			playerStore.setVolume(previousVolume);
			isMuted = false;
		} else {
			previousVolume = $playerStore.volume;
			playerStore.setVolume(0);
			isMuted = true;
		}
	}

	function formatTime(seconds: number): string {
		if (isNaN(seconds)) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function formatQualityLabel(quality?: string): string {
		if (!quality) return '—';
		const normalized = quality.toUpperCase();
		if (normalized === 'LOSSLESS') {
			return 'CD';
		}
		if (normalized === 'HI_RES_LOSSLESS') {
			return 'Hi-Res';
		}
		return quality;
	}

	function formatSampleRate(value?: number | null): string | null {
		if (!Number.isFinite(value ?? NaN) || !value || value <= 0) {
			return null;
		}
		const kilohertz = value / 1000;
		const precision = kilohertz >= 100 || Math.abs(kilohertz - Math.round(kilohertz)) < 0.05 ? 0 : 1;
		const formatted = kilohertz.toFixed(precision).replace(/\.0$/, '');
		return `${formatted} kHz`;
	}

	function formatBitDepth(value?: number | null): string | null {
		if (!Number.isFinite(value ?? NaN) || !value || value <= 0) {
			return null;
		}
		return `${value}-bit`;
	}





	$effect(() => {
		if ($ffmpegBanner.phase === 'ready') {
			const timeout = setTimeout(() => {
				downloadUiStore.dismissFfmpeg();
			}, 3200);
			return () => clearTimeout(timeout);
		}
	});

	onMount(() => {
		let detachLyricsSeek: (() => void) | null = null;

		if (audioElement) {
			audioElement.volume = $playerStore.volume;
		}

		if (typeof window !== 'undefined') {
			const probe = document.createElement('audio');
			const support = probe.canPlayType?.('audio/flac');
			const supportedByCodec = Boolean(support);
			if (isFirefox && supportedByCodec) {
				console.info(
					'[AudioPlayer] Browser reported FLAC support but running on Firefox; forcing streaming fallback.'
				);
			}
			const previousSupport = supportsLosslessPlayback;
			supportsLosslessPlayback = supportedByCodec && !isFirefox;
			console.info(
				'[AudioPlayer] Browser lossless playback support detected:',
				supportsLosslessPlayback
			);
			if (previousSupport && !supportsLosslessPlayback) {
				const state = get(playerStore);
				if (state.currentTrack) {
					console.info(
						'[AudioPlayer] Re-loading current track with LOSSLESS quality due to unsupported FLAC playback.'
					);
					// loadTrack() will automatically use LOSSLESS quality for playback when FLAC is not supported
					// without changing the UI quality setting
					loadTrack(state.currentTrack);
				}
			}
		}

		if (containerElement) {
			notifyContainerHeight();
			resizeObserver = new ResizeObserver(() => {
				notifyContainerHeight();
			});
			resizeObserver.observe(containerElement);
		}

		mediaSessionController.registerHandlers();
		{
			const state = get(playerStore);
			mediaSessionController.updateMetadata(state.currentTrack);
			mediaSessionController.updatePlaybackState(
				state.currentTrack ? (state.isPlaying ? 'playing' : 'paused') : 'none'
			);
			mediaSessionController.updatePositionState();
		}

		if (typeof window !== 'undefined') {
			const listener = (event: Event) => handleLyricsSeekEvent(event);
			window.addEventListener('lyrics:seek', listener as EventListener);
			detachLyricsSeek = () => {
				window.removeEventListener('lyrics:seek', listener as EventListener);
			};
		}

		return () => {
			resizeObserver?.disconnect();
			mediaSessionController.cleanup();
			detachLyricsSeek?.();
			trackLoadController.destroy().catch((error) => {
				console.debug('Shaka cleanup failed', error);
			});
		};
	});

	function notifyContainerHeight() {
		if (typeof onHeightChange === 'function' && containerElement) {
			const height = containerElement.offsetHeight ?? 0;
			onHeightChange(height);
			if (typeof document !== 'undefined') {
				document.documentElement.style.setProperty('--player-height', `${height}px`);
			}
		}
	}

	function asTrack(track: PlayableTrack): Track {
		return track as Track;
	}
</script>

<audio
	bind:this={audioElement}
	src={streamUrl}
	ontimeupdate={handleTimeUpdate}
	ondurationchange={handleDurationChange}
	onended={handleEnded}
	onloadeddata={handleLoadedData}
	onloadedmetadata={updateBufferedPercent}
	onprogress={handleProgress}
	onerror={handleAudioError}
	class="hidden"
></audio>

{#if !headless && shouldShowPlayer}
	<div
		class="audio-player-backdrop fixed inset-x-0 bottom-0 z-50 px-4 pt-16 pb-5 sm:px-6 sm:pt-16 sm:pb-6"
		bind:this={containerElement}
	>
		<div class="relative mx-auto w-full max-w-screen-2xl">


			<div class="audio-player-glass overflow-hidden rounded-2xl border shadow-2xl">
				<div class="relative px-4 pb-3 pt-8">
					<!-- NEW: dismiss (X) button -->
					<button
						onclick={dismissPlayer}
						class="absolute right-2 top-2 z-10 rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
						aria-label="Hide player"
						type="button"
					>
						<X size={16} />
					</button>

					{#if $playerStore.currentTrack}
						<div class="mb-3">
							<button
								bind:this={seekBarElement}
								onmousedown={handleSeekStart}
								ontouchstart={handleSeekStart}
								class="group relative h-1 w-full cursor-pointer overflow-hidden rounded-full bg-gray-700"
								type="button"
								aria-label="Seek position"
							>
								<div
									class="pointer-events-none absolute inset-y-0 left-0 bg-blue-400/30 transition-all"
									style="width: {bufferedPercent}%"
									aria-hidden="true"
								></div>
								<div
									class="pointer-events-none absolute inset-y-0 left-0 bg-blue-500 transition-all"
									style="width: {getPercent($playerStore.currentTime, $playerStore.duration)}%"
									aria-hidden="true"
								></div>
								<div
									class="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-blue-500 opacity-0 transition-opacity group-hover:opacity-100"
									style="left: {getPercent($playerStore.currentTime, $playerStore.duration)}%"
									aria-hidden="true"
								></div>
							</button>
							<div class="mt-1 flex justify-between text-xs text-gray-400">
								<span>{formatTime($playerStore.currentTime)}</span>
								<span>{formatTime($playerStore.duration)}</span>
							</div>
						</div>

						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							{#if $playerStore.currentTrack}
								<div class="flex min-w-0 items-center gap-2 sm:gap-3 sm:flex-1">
									{#if !isSonglinkTrack($playerStore.currentTrack)}
										{#if asTrack($playerStore.currentTrack).album.videoCover}
											<video
												src={losslessAPI.getCoverUrl(asTrack($playerStore.currentTrack).album.videoCover!, '640')}
												autoplay
												loop
												muted
												playsinline
												class="h-12 w-12 sm:h-16 sm:w-16 flex-shrink-0 rounded-md object-cover"
											></video>
										{:else if asTrack($playerStore.currentTrack).album.cover}
											<LazyImage
												src={losslessAPI.getCoverUrl(asTrack($playerStore.currentTrack).album.cover!, '640')}
												alt={$playerStore.currentTrack.title}
												class="h-12 w-12 sm:h-16 sm:w-16 flex-shrink-0 rounded-md object-cover"
											/>
										{/if}
									{/if}
									<div class="min-w-0 flex-1">
										<h3 class="truncate font-semibold text-white text-sm sm:text-base">
											{$playerStore.currentTrack.title}{!isSonglinkTrack($playerStore.currentTrack) && asTrack($playerStore.currentTrack).version ? ` (${asTrack($playerStore.currentTrack).version})` : ''}
										</h3>
										{#if isSonglinkTrack($playerStore.currentTrack)}
											<p class="truncate text-xs sm:text-sm text-gray-400">{$playerStore.currentTrack.artistName}</p>
										{:else}
											<a
												href={`/artist/${asTrack($playerStore.currentTrack).artist.id}`}
												class="truncate text-xs sm:text-sm text-gray-400 hover:text-blue-400 hover:underline inline-block"
												data-sveltekit-preload-data
											>
												{formatArtists(asTrack($playerStore.currentTrack).artists)}
											</a>
											<p class="text-xs text-gray-500">
												<a
													href={`/album/${asTrack($playerStore.currentTrack).album.id}`}
													class="hover:text-blue-400 hover:underline"
													data-sveltekit-preload-data
												>
													{asTrack($playerStore.currentTrack).album.title}
												</a>
												{#if currentPlaybackQuality}
													<span class="mx-0.5 sm:mx-1" aria-hidden="true">•</span>
													<span class="text-xs sm:text-sm">{formatQualityLabel(currentPlaybackQuality)}</span>
												{/if}
												{#if bitDepthLabel}
													<span class="mx-0.5 sm:mx-1 text-gray-600" aria-hidden="true">•</span>
													<span class="text-xs sm:text-sm">{bitDepthLabel}</span>
												{/if}
												{#if sampleRateLabel}
													<span class="mx-0.5 sm:mx-1 text-gray-600" aria-hidden="true">•</span>
													<span class="text-xs sm:text-sm">{sampleRateLabel}</span>
												{/if}
											</p>
										{/if}
									</div>
								</div>
							{/if}

							<div class="flex flex-nowrap items-center justify-between gap-1 sm:gap-4">
								<div class="flex items-center justify-center gap-0.5 sm:gap-2">
									<button
										onclick={handlePrevious}
										class="p-2 sm:p-1.5 md:p-2 text-gray-400 transition-colors hover:text-white disabled:opacity-50"
										disabled={false}
										aria-label="Previous track"
									>
										<SkipBack size={20} class="sm:w-4 sm:h-4 md:w-5 md:h-5" />
									</button>

									<button
										onclick={() => playbackTransitions.togglePlay()}
										class="rounded-full bg-white p-3 sm:p-2.5 md:p-3 text-gray-900 transition-transform hover:scale-105"
										aria-label={$playerStore.isPlaying ? 'Pause' : 'Play'}
									>
										{#if $playerStore.isPlaying}
											<Pause size={20} class="sm:w-5 sm:h-5 md:w-6 md:h-6" fill="currentColor" />
										{:else}
											<Play size={20} class="sm:w-5 sm:h-5 md:w-6 md:h-6" fill="currentColor" />
										{/if}
									</button>

									<button
										onclick={() => playbackTransitions.next()}
										class="p-2 sm:p-1.5 md:p-2 text-gray-400 transition-colors hover:text-white disabled:opacity-50"
										disabled={$playerStore.queueIndex >= $playerStore.queue.length - 1}
										aria-label="Next track"
									>
										<SkipForward size={20} class="sm:w-4 sm:h-4 md:w-5 md:h-5" />
									</button>
								</div>

								<div class="flex items-center gap-0.5 sm:gap-2">
									<button
										onclick={toggleMute}
										class="player-toggle-button p-2 sm:hidden"
										aria-label={isMuted ? 'Unmute' : 'Mute'}
										type="button"
									>
										{#if isMuted || $playerStore.volume === 0}
											<VolumeX size={14} />
										{:else}
											<Volume2 size={14} />
										{/if}
									</button>
									<button
										onclick={handleDownloadCurrentTrack}
										class="player-toggle-button p-2 sm:p-1.5 md:p-2"
										aria-label="Download current track"
										type="button"
										disabled={!$playerStore.currentTrack || isDownloadingCurrentTrack}
									>
										{#if isDownloadingCurrentTrack}
											<LoaderCircle size={16} class="sm:w-4 sm:h-4 md:w-[18px] md:h-[18px] animate-spin" />
										{:else}
											<Download size={16} class="sm:w-4 sm:h-4 md:w-[18px] md:h-[18px]" />
										{/if}
										<span class="hidden md:inline">Download</span>
									</button>
									<button
										onclick={() => lyricsStore.toggle()}
										class="player-toggle-button p-2 sm:p-1.5 md:p-2 {$lyricsStore.open ? 'player-toggle-button--active' : ''}"
										aria-label={$lyricsStore.open ? 'Hide lyrics popup' : 'Show lyrics popup'}
										aria-expanded={$lyricsStore.open}
										type="button"
									>
										<ScrollText size={16} class="sm:w-4 sm:h-4 md:w-[18px] md:h-[18px]" />
										<span class="hidden md:inline">Lyrics</span>
									</button>
									<button
										onclick={toggleQueuePanel}
										class="player-toggle-button p-2 sm:p-1.5 md:p-2 {showQueuePanel ? 'player-toggle-button--active' : ''}"
										aria-label="Toggle queue panel"
										aria-expanded={showQueuePanel}
										type="button"
									>
										<ListMusic size={16} class="sm:w-4 sm:h-4 md:w-[18px] md:h-[18px]" />
										<span class="hidden md:inline">Queue ({$playerStore.queue.length})</span>
									</button>
								</div>

								<div class="hidden sm:flex items-center gap-2">
									<button
										onclick={toggleMute}
										class="p-2 sm:p-2 md:p-2 text-gray-400 transition-colors hover:text-white"
										aria-label={isMuted ? 'Unmute' : 'Mute'}
									>
										{#if isMuted || $playerStore.volume === 0}
											<VolumeX size={20} />
										{:else}
											<Volume2 size={20} />
										{/if}
									</button>
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={$playerStore.volume}
										oninput={handleVolumeChange}
										class="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-700 accent-white"
										aria-label="Volume"
									/>
								</div>
							</div>
						</div>

						{#if currentTrackDownloadTask}
							<div class="download-progress-in-player mt-3">
								<div class="flex items-center gap-3">
									<div class="flex-1">
										<div class="text-xs text-gray-400 mb-1">Downloading "{currentTrackDownloadTask.title}"</div>
										<div class="download-progress-bar">
											<div
												class="download-progress-bar-fill"
												style="width: {Math.max(0, Math.min(100, currentTrackDownloadTask.progress * 100))}%"
											></div>
										</div>
									</div>
									<span class="text-xs font-medium text-gray-300">{Math.round(currentTrackDownloadTask.progress * 100)}%</span>
								</div>
							</div>
						{/if}

						{#if currentTrackErrorTask}
							<div class="download-error-in-player mt-3">
								<div class="flex items-center gap-3">
									<div class="flex-1">
										<div class="text-xs text-red-400 mb-1">Download failed: {currentTrackErrorTask.error}</div>
									</div>
									<button
										onclick={() => {
											downloadUiStore.dismissTrackTask(currentTrackErrorTask.id);
											handleDownloadCurrentTrack();
										}}
										class="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
									>
										Retry
									</button>
								</div>
							</div>
						{/if}

						{#if showQueuePanel}
							<div
								class="queue-panel mt-4 space-y-3 rounded-2xl border p-4 text-sm shadow-inner"
								transition:slide={{ duration: 220, easing: cubicOut }}
							>
								<div class="flex items-center justify-between gap-2">
									<div class="flex items-center gap-2 text-gray-300">
										<ListMusic size={18} />
										<span class="font-medium">Playback Queue</span>
										<span class="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
											{$playerStore.queue.length}
										</span>
									</div>
									<div class="flex items-center gap-2">
										<button
											onclick={handleShuffleQueue}
											class="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-blue-500 hover:text-blue-200 disabled:opacity-40"
											type="button"
											disabled={$playerStore.queue.length <= 1}
										>
											<Shuffle size={14} />
											Shuffle
										</button>
										<button
											onclick={clearQueue}
											class="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-red-500 hover:text-red-400"
											type="button"
											disabled={$playerStore.queue.length === 0}
										>
											<Trash2 size={14} />
											Clear
										</button>
										<button
											onclick={closeQueuePanel}
											class="rounded-full p-1 text-gray-400 transition-colors hover:text-white"
											aria-label="Close queue panel"
										>
											<X size={16} />
										</button>
									</div>
								</div>

								{#if $playerStore.queue.length > 0}
									<ul class="max-h-60 space-y-2 overflow-y-auto pr-1">
										{#each $playerStore.queue as queuedTrack, index (queuedTrack.id)}
											<li>
												<div
													onclick={() => playFromQueue(index)}
													onkeydown={(event) => {
														if (event.key === 'Enter' || event.key === ' ') {
															event.preventDefault();
															playFromQueue(index);
														}
													}}
													tabindex="0"
													role="button"
													class="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors {index === $playerStore.queueIndex ? 'bg-blue-500/10 text-white' : 'text-gray-200 hover:bg-gray-800/70'}"
												>
													<span class="w-6 text-xs font-semibold text-gray-500 group-hover:text-gray-300">
														{index + 1}
													</span>
													<div class="min-w-0 flex-1">
														<p class="truncate text-sm font-medium">
															{queuedTrack.title}{!isSonglinkTrack(queuedTrack) && asTrack(queuedTrack).version ? ` (${asTrack(queuedTrack).version})` : ''}
														</p>
														{#if isSonglinkTrack(queuedTrack)}
															<p class="truncate text-xs text-gray-400">{queuedTrack.artistName}</p>
														{:else}
															<a
																href={`/artist/${asTrack(queuedTrack).artist.id}`}
																onclick={(e) => e.stopPropagation()}
																class="truncate text-xs text-gray-400 hover:text-blue-400 hover:underline inline-block"
																data-sveltekit-preload-data
															>
																{formatArtists(asTrack(queuedTrack).artists)}
															</a>
														{/if}
													</div>
													<button
														onclick={(event) => removeFromQueue(index, event)}
														class="rounded-full p-1 text-gray-500 transition-colors hover:text-red-400"
														aria-label={`Remove ${queuedTrack.title} from queue`}
														type="button"
													>
														<X size={14} />
													</button>
												</div>
											</li>
										{/each}
									</ul>
								{:else}
									<p class="rounded-lg border border-dashed border-gray-700 bg-gray-900/70 px-3 py-8 text-center text-gray-400">
										Queue is empty
									</p>
								{/if}
							</div>
						{/if}


					{:else}
						<div class="flex h-20 items-center justify-center text-sm text-gray-400">Nothing is playing</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

{#if !headless && playerDismissed && hasTrack}
	<button class="playback-indicator" type="button" onclick={restorePlayer} aria-label="Show player - music is playing">
		{#if $playerStore.isPlaying}
			<div class="playback-indicator-pulse"></div>
		{/if}
		<Music size={16} />
	</button>
{/if}

<style>
	.audio-player-glass {
		background: rgba(11, 16, 26, 0.98);
		border-color: rgba(148, 163, 184, 0.2);
		backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		box-shadow: 0 30px 80px rgba(2, 6, 23, 0.6), 0 4px 18px rgba(15, 23, 42, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
		transition: border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease;
	}

	.queue-panel {
		background: rgba(11, 16, 26, 0.98);
		border-color: rgba(148, 163, 184, 0.2);
		backdrop-filter: blur(var(--perf-blur-medium, 28px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-medium, 28px)) saturate(var(--perf-saturate, 160%));
		box-shadow: 0 8px 24px rgba(2, 6, 23, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05);
		transition: border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease;
	}


	.audio-player-backdrop {
		isolation: isolate;
	}

	.audio-player-backdrop::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 0;
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		mask: linear-gradient(to bottom, transparent 0%, black 25%);
	}

	.audio-player-backdrop > * {
		position: relative;
		z-index: 1;
	}

	input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		background: white;
		border-radius: 50%;
		cursor: pointer;
	}

	input[type='range']::-moz-range-thumb {
		width: 12px;
		height: 12px;
		background: white;
		border-radius: 50%;
		cursor: pointer;
		border: none;
	}







	button.rounded-full {
		transition: border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1), color 0.2s ease, background 0.2s ease;
	}

	button.rounded-full:hover {
		border-color: var(--bloom-accent, rgba(59, 130, 246, 0.7)) !important;
	}

	.player-toggle-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-radius: 9999px;
		border: 1px solid rgba(148, 163, 184, 0.25);
		background: transparent;
		backdrop-filter: blur(16px) saturate(140%);
		-webkit-backdrop-filter: blur(16px) saturate(140%);
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		color: rgba(209, 213, 219, 0.85);
		transition: border-color 200ms ease, color 200ms ease, box-shadow 200ms ease;
	}

	.player-toggle-button:hover {
		border-color: var(--bloom-accent, rgba(96, 165, 250, 0.6));
		color: rgba(255, 255, 255, 0.95);
	}

.player-toggle-button--active {
		border-color: var(--bloom-accent, rgba(96, 165, 250, 0.7));
		color: rgba(255, 255, 255, 0.98);
		box-shadow: inset 0 0 20px rgba(96, 165, 250, 0.15);
	}



	.playback-indicator {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		background: rgba(11, 16, 26, 0.9);
		border: 1px solid rgba(148, 163, 184, 0.3);
		color: rgba(226, 232, 240, 0.9);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		backdrop-filter: blur(8px);
		transition: all 0.2s ease;
		cursor: pointer;
	}

	.playback-indicator:hover {
		background: rgba(15, 23, 42, 0.95);
		border-color: rgba(148, 163, 184, 0.5);
		transform: scale(1.05);
	}

	.playback-indicator-pulse {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: rgba(59, 130, 246, 0.3);
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 0.6;
			transform: scale(1);
		}
		50% {
			opacity: 0.3;
			transform: scale(1.2);
		}
	}

	@media (min-width: 640px) {
		.playback-indicator {
			bottom: 1.5rem;
			right: 1.5rem;
		}
	}

	.download-progress-bar {
		width: 100%;
		height: 4px;
		background: rgba(255, 255, 255, 0.2);
		border-radius: 2px;
		overflow: hidden;
	}

	.download-progress-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #3b82f6, #06b6d4);
		border-radius: 2px;
		transition: width 0.3s ease;
	}
</style>
