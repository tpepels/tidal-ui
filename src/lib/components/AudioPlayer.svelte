<!--
	Playback logic is owned by the playback state machine.
	Avoid adding store-driven playback effects here; route intent/events through playbackMachine actions.
-->
<script lang="ts">
	console.log('[AudioPlayer] Component loading');
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { playerStore } from '$lib/stores/player';
	import {
		machineCurrentTrack,
		machineIsPlaying,
		machineCurrentTime,
		machineDuration,
		machineVolume,
		machineQueue,
		machineQueueIndex,
		machineIsMuted
	} from '$lib/stores/playerDerived';
	import { lyricsStore } from '$lib/stores/lyrics';
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { formatArtists } from '$lib/utils/formatters';
	import { losslessAPI } from '$lib/api';
	import type { Track, AudioQuality, PlayableTrack } from '$lib/types';
	import { isSonglinkTrack } from '$lib/types';
	// Playback domain services
	import {
		handlePreviousTrack as handlePreviousTrackService,
		setVolume as setVolumeService,
		toggleMute as toggleMuteService
	} from '$lib/services/playback';
	// Orchestrators
	import { downloadOrchestrator } from '$lib/orchestrators';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { createMediaSessionController } from '$lib/controllers/mediaSessionController';
	import { createAudioElementController } from '$lib/controllers/audioElementController';
	import { createPlaybackTransitions } from '$lib/controllers/playbackTransitions';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { playerUiProjection } from '$lib/controllers/playerUiProjection';
	import { playbackMachine } from '$lib/stores/playbackMachine.svelte';
	import { detectAudioSupport } from '$lib/utils/audioSupport';
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
	let bufferedPercent = $state(0);
	let currentPlaybackQuality = $state<AudioQuality | null>(null);
	let isDownloadingCurrentTrack = $state(false);


	const { onHeightChange = () => {}, onVisibilityChange = () => {}, headless = false } = $props<{
		onHeightChange?: (height: number) => void;
		onVisibilityChange?: (visible: boolean) => void;
		headless?: boolean;
	}>();

	let containerElement = $state<HTMLDivElement | null>(null);
	let resizeObserver: ResizeObserver | null = null;
	let showQueuePanel = $state(false);

	const PRELOAD_THRESHOLD_SECONDS = 12;
	const hiResQualities = new Set<AudioQuality>(['HI_RES_LOSSLESS']);
	const sampleRateLabel = $derived(formatSampleRate($playerStore.sampleRate));
	const bitDepthLabel = $derived(formatBitDepth($playerStore.bitDepth));
	const machineStreamUrl = $derived(playbackMachine.streamUrl || streamUrl);
	const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
	let supportsLosslessPlayback = true;
	let streamingFallbackQuality: AudioQuality = 'HIGH';

	const mediaSessionController = createMediaSessionController(
		playerStore,
		() => audioElement,
		{
			onPlay: () => {
				requestPlay();
			},
			onPause: () => {
				requestPause();
			},
			onPrevious: () => {
				handlePrevious();
			},
			onNext: () => {
				playbackFacade.next();
			},
			onSeekTo: (time: number) => {
				if (!audioElement) return;
				const nextTime = Math.max(0, time);
				audioElement.currentTime = nextTime;
				playbackTransitions.seekTo(nextTime);
				playbackMachine.actions.seek(nextTime);
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
				playbackMachine.actions.seek(bounded);
			},
			onStop: () => {
				playbackFacade.pause();
				playbackTransitions.seekTo(0);
				playbackMachine.actions.seek(0);
			},
			onPlayRequest: () => {
				requestPlay();
			}
		}
	);

	const audioElementController = createAudioElementController({
		playerStore,
		getAudioElement: () => audioElement,
		onSetCurrentTime: (time) => playbackMachine.actions.updateTime(time),
		onSetDuration: (duration) => playbackMachine.actions.updateDuration(duration),
		onNextTrack: () => playbackFacade.next(),
		onBufferedPercentChange: (value) => {
			bufferedPercent = value;
		},
		onMaybePreloadNextTrack: (remaining) => {
			playbackMachine.maybePreloadNextTrack(remaining);
		},
		mediaSessionController
	});

	const playbackTransitions = createPlaybackTransitions(playerStore);

	function requestPlay() {
		playbackFacade.play();
	}

	function requestPause() {
		playbackFacade.pause();
	}

	function togglePlayback() {
		if (!$machineCurrentTrack) {
			return;
		}
		if ($machineIsPlaying) {
			requestPause();
		} else {
			requestPlay();
		}
	}

	let isSeeking = false;

	let seekBarElement = $state<HTMLButtonElement | null>(null);

	// -----------------------------
	// NEW: dismiss / auto-hide logic
	// -----------------------------
	let playerDismissed = $state(false);

	// Derived download task filters
	const activeDownloads = $derived($downloadUiStore.tasks.filter((task) => task.status === 'running'));
	const erroredDownloads = $derived($downloadUiStore.tasks.filter((task) => task.status === 'error'));
	const ffmpegBannerState = $derived($downloadUiStore.ffmpeg);
	const downloadActionLabel = $derived(
		$downloadPreferencesStore.storage === 'server' ? 'Save to server' : 'Download'
	);

  const hasTrack = $derived(Boolean($machineCurrentTrack));
  const currentTrackDownloadTask = $derived(activeDownloads.find(task => task.trackId === $machineCurrentTrack?.id));
  const currentTrackErrorTask = $derived(erroredDownloads.find(task => task.trackId === $machineCurrentTrack?.id));
  const hasOverlays = $derived(activeDownloads.length > 0 || ffmpegBannerState);

	// Show player when:
	// - not dismissed
	// - AND either a track exists OR overlays exist (downloads/ffmpeg banner)
	const shouldShowPlayer = $derived(!playerDismissed && (hasTrack || hasOverlays));

	function dismissPlayer() {
		playerDismissed = true;
		showQueuePanel = false;
		onVisibilityChange(false);
		onHeightChange(0);

	}

	function restorePlayer() {
		playerDismissed = false;
		onVisibilityChange(true);
	}

	// Auto-unhide when a track appears again
	$effect(() => {
		if (hasTrack) {
			playerDismissed = false;
		}
	});

	$effect(() => {
		if (!headless) {
			onVisibilityChange(shouldShowPlayer);
			if (!shouldShowPlayer) {
				onHeightChange(0);
			}
		}
	});
	// -----------------------------

	// Playback is controlled via playbackMachine; playerStore mirrors machine state for UI.

	$effect(() => {
		if (showQueuePanel && $machineQueue.length === 0) {
			showQueuePanel = false;
		}
	});

	$effect(() => {
		mediaSessionController.updateMetadata($machineCurrentTrack);
	});

	$effect(() => {
		const hasTrack = Boolean($machineCurrentTrack);
		mediaSessionController.updatePlaybackState(
			hasTrack ? ($machineIsPlaying ? 'playing' : 'paused') : 'none'
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
		playbackFacade.loadQueue($machineQueue, index);
		playbackFacade.play();
	}

	function removeFromQueue(index: number, event?: MouseEvent) {
		if (event) {
			event.stopPropagation();
		}
		playbackFacade.removeFromQueue(index);
	}

	function clearQueue() {
		playbackTransitions.clearQueue();
	}

	function handleShuffleQueue() {
		playbackFacade.shuffleQueue();
	}

	$effect(() => {
		if (audioElement) {
			const baseVolume = $machineVolume;
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

	function handleTimeUpdate() {
		audioElementController.handleTimeUpdate();
	}

	function handleAudioError(event: Event) {
		playbackMachine.actions.onAudioError(event);
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
		updateBufferedPercent();
		playbackMachine.actions.onAudioReady();

		const currentTime = get(machineCurrentTime);
		if (audioElement && currentTime > 0 && Math.abs(audioElement.currentTime - currentTime) > 1) {
			audioElement.currentTime = currentTime;
		}

		mediaSessionController.updatePositionState();
		const machineState = playbackMachine.state;
		if ($machineIsPlaying && machineState !== 'playing') {
			playbackMachine.actions.play();
		}
	}

	function handleAudioPlaying() {
		playbackMachine.actions.onAudioPlaying();
	}

	function handleAudioPaused() {
		playbackMachine.actions.onAudioPaused();
	}

	function handleAudioWaiting() {
		playbackMachine.actions.onAudioWaiting();
	}

	function getPercent(current: number, total: number): number {
		if (!Number.isFinite(total) || total <= 0) {
			return 0;
		}
		return Math.max(0, Math.min(100, (current / total) * 100));
	}

	function handlePrevious() {
		if (!audioElement) return;
		const currentTime = $machineCurrentTime;
		const queueIndex = $machineQueueIndex;
		handlePreviousTrackService(audioElement, {
			currentTime,
			queueIndex,
			onSetCurrentTime: (time) => playbackMachine.actions.updateTime(time),
			onPrevious: () => playbackFacade.previous()
		});
		mediaSessionController.updatePositionState();
	}

	function handleEnded() {
		audioElementController.handleEnded();
		playbackMachine.actions.onTrackEnd();
	}

	function handleSeek(event: MouseEvent | TouchEvent) {
		if (!seekBarElement || !audioElement) return;

		const rect = seekBarElement.getBoundingClientRect();
		const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
		const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const newTime = percent * $machineDuration;

		playbackMachine.actions.seek(newTime);
		mediaSessionController.updatePositionState();
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
		const clamped = setVolumeService(newVolume);
		playbackMachine.actions.updateVolume(clamped);
		if (clamped > 0 && $machineIsMuted) {
			playbackMachine.actions.updateMuted(false);
		}
	}

	function handleLyricsSeekEvent(event: Event) {
		const customEvent = event as CustomEvent<{ timeSeconds?: number }>;
		const targetSeconds = customEvent.detail?.timeSeconds;
		if (typeof targetSeconds !== 'number' || !audioElement) {
			return;
		}

		const shouldResume = !$machineIsPlaying;
		playbackMachine.actions.seek(targetSeconds);
		if (shouldResume) {
			playbackMachine.actions.play();
		}
		mediaSessionController.updatePositionState();
	}

	async function handleDownloadCurrentTrack() {
		const track = $machineCurrentTrack;
		if (!track || isDownloadingCurrentTrack) {
			return;
		}

		isDownloadingCurrentTrack = true;
		downloadUiStore.skipFfmpegCountdown();

		try {
			// Get subtitle from track (handle both Track and SonglinkTrack)
			const subtitle = isSonglinkTrack(track)
				? track.artistName
				: track.album?.title ?? track.artist?.name;

			await downloadOrchestrator.downloadTrack(track, {
				quality: $downloadPreferencesStore.downloadQuality,
				autoConvertSonglink: true,
				notificationMode: 'alert',
				subtitle
			});
		} finally {
			isDownloadingCurrentTrack = false;
		}
	}

	function toggleMuteHandler() {
		const result = toggleMuteService($machineVolume, $machineIsMuted);
		playbackMachine.actions.updateVolume(result.volume);
		playbackMachine.actions.updateMuted(result.isMuted);
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
		if (ffmpegBannerState.phase === 'ready') {
			const timeout = setTimeout(() => {
				downloadUiStore.dismissFfmpeg();
			}, 3200);
			return () => clearTimeout(timeout);
		}
	});

	onMount(() => {
		let detachLyricsSeek: (() => void) | null = null;

		playbackMachine.setLoadUiCallbacks({
			setStreamUrl: (value) => {
				streamUrl = value;
			},
			setBufferedPercent: (value) => {
				bufferedPercent = value;
			},
			setCurrentPlaybackQuality: (value) => {
				currentPlaybackQuality = value;
			},
			setSampleRate: (value) => playerUiProjection.setSampleRate(value),
			setBitDepth: (value) => playerUiProjection.setBitDepth(value),
			setReplayGain: (value) => playerUiProjection.setReplayGain(value),
			getSupportsLosslessPlayback: () => supportsLosslessPlayback,
			getStreamingFallbackQuality: () => streamingFallbackQuality,
			isHiResQuality: (quality) => (quality ? hiResQualities.has(quality) : false),
			isFirefox: () => isFirefox,
			preloadThresholdSeconds: PRELOAD_THRESHOLD_SECONDS
		});

		if (audioElement) {
			audioElement.volume = $machineVolume;
			playbackMachine.setAudioElement(audioElement);
		}

		if (typeof window !== 'undefined') {
			const probe = document.createElement('audio');
			const { supportsLosslessPlayback: detectedLossless, streamingFallbackQuality: fallbackQuality, flacSupported } =
				detectAudioSupport({
					canPlayType: probe.canPlayType?.bind(probe),
					isFirefox
				});

			streamingFallbackQuality = fallbackQuality;

			if (isFirefox && flacSupported) {
				console.info(
					'[AudioPlayer] Browser reported FLAC support but running on Firefox; forcing streaming fallback.'
				);
			}
			const previousSupport = supportsLosslessPlayback;
			supportsLosslessPlayback = detectedLossless;
			console.info(
				'[AudioPlayer] Browser lossless playback support detected:',
				supportsLosslessPlayback
			);
			if (previousSupport && !supportsLosslessPlayback) {
				const track = get(machineCurrentTrack);
				if (track) {
					console.info(
						'[AudioPlayer] Re-loading current track with streaming quality due to unsupported FLAC playback.'
					);
					// loadTrack() will automatically select a streaming quality when FLAC is not supported
					// without changing the UI quality setting
					playbackMachine.actions.loadTrack(track);
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
			const track = get(machineCurrentTrack);
			const isPlaying = get(machineIsPlaying);
			mediaSessionController.updateMetadata(track);
			mediaSessionController.updatePlaybackState(track ? (isPlaying ? 'playing' : 'paused') : 'none');
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
			playbackMachine.setAudioElement(null);
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
	src={machineStreamUrl || undefined}
	ontimeupdate={handleTimeUpdate}
	ondurationchange={handleDurationChange}
	onended={handleEnded}
	onloadeddata={handleLoadedData}
	onloadedmetadata={updateBufferedPercent}
	onplaying={handleAudioPlaying}
	onpause={handleAudioPaused}
	onwaiting={handleAudioWaiting}
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

					{#if $machineCurrentTrack}
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
									style="width: {getPercent($machineCurrentTime, $machineDuration)}%"
									aria-hidden="true"
								></div>
								<div
									class="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-blue-500 opacity-0 transition-opacity group-hover:opacity-100"
									style="left: {getPercent($machineCurrentTime, $machineDuration)}%"
									aria-hidden="true"
								></div>
							</button>
							<div class="mt-1 flex justify-between text-xs text-gray-400">
								<span>{formatTime($machineCurrentTime)}</span>
								<span>{formatTime($machineDuration)}</span>
							</div>
						</div>

						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							{#if $machineCurrentTrack}
								<div class="flex min-w-0 items-center gap-2 sm:gap-3 sm:flex-1">
									{#if !isSonglinkTrack($machineCurrentTrack)}
										{#if asTrack($machineCurrentTrack).album.videoCover}
											<video
												src={losslessAPI.getCoverUrl(asTrack($machineCurrentTrack).album.videoCover!, '640')}
												autoplay
												loop
												muted
												playsinline
												class="h-12 w-12 sm:h-16 sm:w-16 flex-shrink-0 rounded-md object-cover"
											></video>
										{:else if asTrack($machineCurrentTrack).album.cover}
											<LazyImage
												src={losslessAPI.getCoverUrl(asTrack($machineCurrentTrack).album.cover!, '640')}
												alt={$machineCurrentTrack.title}
												class="h-12 w-12 sm:h-16 sm:w-16 flex-shrink-0 rounded-md object-cover"
											/>
										{/if}
									{/if}
									<div class="min-w-0 flex-1">
										<h3 class="truncate font-semibold text-white text-sm sm:text-base">
											{$machineCurrentTrack.title}{!isSonglinkTrack($machineCurrentTrack) && asTrack($machineCurrentTrack).version ? ` (${asTrack($machineCurrentTrack).version})` : ''}
										</h3>
										{#if isSonglinkTrack($machineCurrentTrack)}
											<p class="truncate text-xs sm:text-sm text-gray-400">{$machineCurrentTrack.artistName}</p>
										{:else}
											<a
												href={`/artist/${asTrack($machineCurrentTrack).artist.id}`}
												class="truncate text-xs sm:text-sm text-gray-400 hover:text-blue-400 hover:underline inline-block"
												data-sveltekit-preload-data
											>
												{formatArtists(asTrack($machineCurrentTrack).artists)}
											</a>
											<p class="text-xs text-gray-500">
												<a
													href={`/album/${asTrack($machineCurrentTrack).album.id}`}
													class="hover:text-blue-400 hover:underline"
													data-sveltekit-preload-data
												>
													{asTrack($machineCurrentTrack).album.title}
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
										onclick={togglePlayback}
										class="rounded-full bg-white p-3 sm:p-2.5 md:p-3 text-gray-900 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60"
										aria-label={$machineIsPlaying ? 'Pause' : 'Play'}
										disabled={!$machineCurrentTrack}
									>
										{#if $machineIsPlaying}
											<Pause size={20} class="sm:w-5 sm:h-5 md:w-6 md:h-6" fill="currentColor" />
										{:else}
											<Play size={20} class="sm:w-5 sm:h-5 md:w-6 md:h-6" fill="currentColor" />
										{/if}
									</button>

									<button
										onclick={() => playbackFacade.next()}
										class="p-2 sm:p-1.5 md:p-2 text-gray-400 transition-colors hover:text-white disabled:opacity-50"
										disabled={$machineQueueIndex >= $machineQueue.length - 1}
										aria-label="Next track"
									>
										<SkipForward size={20} class="sm:w-4 sm:h-4 md:w-5 md:h-5" />
									</button>
								</div>

								<div class="flex items-center gap-0.5 sm:gap-2">
									<button
										onclick={toggleMuteHandler}
										class="player-toggle-button p-2 sm:hidden"
										aria-label={$machineIsMuted ? 'Unmute' : 'Mute'}
										type="button"
									>
										{#if $machineIsMuted || $machineVolume === 0}
											<VolumeX size={14} />
										{:else}
											<Volume2 size={14} />
										{/if}
									</button>
									<button
										onclick={handleDownloadCurrentTrack}
										class="player-toggle-button p-2 sm:p-1.5 md:p-2"
										aria-label={`${downloadActionLabel} current track`}
										type="button"
										disabled={!$machineCurrentTrack || isDownloadingCurrentTrack}
									>
										{#if isDownloadingCurrentTrack}
											<LoaderCircle size={16} class="sm:w-4 sm:h-4 md:w-[18px] md:h-[18px] animate-spin" />
										{:else}
											<Download size={16} class="sm:w-4 sm:h-4 md:w-[18px] md:h-[18px]" />
										{/if}
										<span class="hidden md:inline">{downloadActionLabel}</span>
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
										<span class="hidden md:inline">Queue ({$machineQueue.length})</span>
									</button>
								</div>

								<div class="hidden sm:flex items-center gap-2">
									<button
										onclick={toggleMuteHandler}
										class="p-2 sm:p-2 md:p-2 text-gray-400 transition-colors hover:text-white"
										aria-label={$machineIsMuted ? 'Unmute' : 'Mute'}
									>
										{#if $machineIsMuted || $machineVolume === 0}
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
										value={$machineVolume}
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
											{$machineQueue.length}
										</span>
									</div>
									<div class="flex items-center gap-2">
										<button
											onclick={handleShuffleQueue}
											class="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-blue-500 hover:text-blue-200 disabled:opacity-40"
											type="button"
											disabled={$machineQueue.length <= 1}
											aria-label="Shuffle queue"
										>
											<Shuffle size={14} />
											Shuffle Queue
										</button>
										<button
											onclick={clearQueue}
											class="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-red-500 hover:text-red-400"
											type="button"
											disabled={$machineQueue.length === 0}
											aria-label="Clear queue"
										>
											<Trash2 size={14} />
											Clear Queue
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

								{#if $machineQueue.length > 0}
									<ul class="max-h-60 space-y-2 overflow-y-auto pr-1">
										{#each $machineQueue as queuedTrack, index (queuedTrack.id)}
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
													class="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors {index === $machineQueueIndex ? 'bg-blue-500/10 text-white' : 'text-gray-200 hover:bg-gray-800/70'}"
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
		{#if $machineIsPlaying}
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
