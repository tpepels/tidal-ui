import { get } from 'svelte/store';
import { tick } from 'svelte';
import type { Readable } from 'svelte/store';
import {
	losslessAPI,
	type DashManifestResult,
	type DashManifestWithMetadata,
	DASH_MANIFEST_UNAVAILABLE_CODE
} from '$lib/api';
import { API_CONFIG } from '$lib/config';
import { deriveTrackQuality } from '$lib/utils/audioQuality';
import type { AudioQuality, PlayableTrack, Track } from '$lib/types';
import { isSonglinkTrack } from '$lib/types';

type PlayerState = {
	currentTrack: PlayableTrack | null;
	queue: PlayableTrack[];
	queueIndex: number;
	quality: AudioQuality;
};

type TrackLoadControllerOptions = {
	playerStore: Readable<PlayerState>;
	getAudioElement: () => HTMLAudioElement | null;
	getCurrentTrackId: () => number | null;
	getSupportsLosslessPlayback: () => boolean;
	setStreamUrl: (url: string) => void;
	setBufferedPercent: (value: number) => void;
	setCurrentPlaybackQuality: (quality: AudioQuality | null) => void;
	setDashPlaybackActive: (value: boolean) => void;
	setLoading: (value: boolean) => void;
	setSampleRate: (value: number | null) => void;
	setBitDepth: (value: number | null) => void;
	setReplayGain: (value: number | null) => void;
	getPlaybackQuality?: () => AudioQuality;
	createSequence: () => number;
	getSequence: () => number;
	isHiResQuality: (quality: AudioQuality | undefined) => boolean;
	preloadThresholdSeconds: number;
	onDASHUnavailable?: (trackId: number) => void;
	onLoadComplete?: (streamUrl: string | null, quality: AudioQuality) => void;
	onLoadError?: (error: Error) => void;
	onFallbackRequested?: (quality: AudioQuality, reason: string) => void;
};

type ShakaPlayerInstance = {
	load: (uri: string) => Promise<void>;
	unload: () => Promise<void>;
	destroy: () => Promise<void>;
	attach?: (mediaElement: HTMLMediaElement) => Promise<void>;
	detach?: () => Promise<void>;
	getNetworkingEngine?: () => {
		registerRequestFilter: (
			callback: (type: unknown, request: { method: string; uris: string[] }) => void
		) => void;
	};
};

type ShakaNamespace = {
	Player: new () => ShakaPlayerInstance;
	polyfill?: {
		installAll?: () => void;
	};
};

type ShakaModule = { default?: ShakaNamespace; shaka?: ShakaNamespace };

const SHAKA_CDN_URL =
	import.meta.env.VITE_SHAKA_CDN_URL ??
	'https://cdn.jsdelivr.net/npm/shaka-player@4.11.7/dist/shaka-player.compiled.js';

export type TrackLoadController = {
	loadTrack: (track: PlayableTrack) => Promise<void>;
	loadStandardTrack: (track: Track, quality: AudioQuality, sequence: number) => Promise<void>;
	maybePreloadNextTrack: (remainingSeconds: number) => void;
	destroy: () => Promise<void>;
};

export const createTrackLoadController = (
	options: TrackLoadControllerOptions
): TrackLoadController => {
	const streamCache = new Map<
		string,
		{ url: string; replayGain: number | null; sampleRate: number | null; bitDepth: number | null }
	>();
	let preloadingCacheKey: string | null = null;
	const dashManifestCache = new Map<string, DashManifestWithMetadata>();
	let hiResObjectUrl: string | null = null;
	let shakaNamespace: ShakaNamespace | null = null;
	let shakaPlayer: ShakaPlayerInstance | null = null;
	let shakaAttachedElement: HTMLMediaElement | null = null;
	let shakaNetworkingConfigured = false;

	const getCacheKey = (trackId: number, quality: AudioQuality) => `${trackId}:${quality}`;

	/**
	 * Helper to check if a sequence is still valid before and after an async operation.
	 * Returns true if the sequence is still current, false if it was invalidated.
	 */
	const isSequenceValid = (sequence: number): boolean => sequence === options.getSequence();

	/**
	 * Executes state updates only if the sequence is still valid.
	 * Prevents partial state updates from stale operations.
	 */
	const withSequenceCheck = <T>(sequence: number, updates: () => T): T | null => {
		if (!isSequenceValid(sequence)) {
			console.debug('[TrackLoadController] Skipping update for stale sequence', {
				sequence,
				current: options.getSequence()
			});
			return null;
		}
		return updates();
	};

	const revokeHiResObjectUrl = () => {
		if (hiResObjectUrl) {
			URL.revokeObjectURL(hiResObjectUrl);
			hiResObjectUrl = null;
		}
	};

	const destroy = async () => {
		revokeHiResObjectUrl();
		if (shakaPlayer) {
			try {
				if (shakaPlayer.detach) {
					await shakaPlayer.detach();
				}
				await shakaPlayer.destroy();
			} catch (error) {
				console.debug('Failed to destroy Shaka player', error);
			}
			shakaPlayer = null;
			shakaAttachedElement = null;
		}
		shakaNetworkingConfigured = false;
		options.setDashPlaybackActive(false);
	};

	const ensureShakaPlayer = async (): Promise<ShakaPlayerInstance> => {
		const audioElement = options.getAudioElement();
		if (!audioElement) {
			throw new Error('Audio element not ready for Shaka initialization');
		}
		if (!shakaNamespace) {
			const module = await import(/* @vite-ignore */ SHAKA_CDN_URL);
			const resolved =
				(module as ShakaModule).default ??
				(module as ShakaModule).shaka ??
				(window as typeof window & { shaka?: ShakaNamespace }).shaka;
			shakaNamespace = resolved ?? null;
			if (shakaNamespace?.polyfill?.installAll) {
				try {
					shakaNamespace.polyfill.installAll();
				} catch (error) {
					console.debug('Shaka polyfill installation failed', error);
				}
			}
		}
		if (!shakaNamespace) {
			throw new Error('Shaka namespace unavailable');
		}
		if (!shakaPlayer) {
			shakaPlayer = new shakaNamespace.Player();
			const networking = shakaPlayer.getNetworkingEngine?.();
			if (networking && !shakaNetworkingConfigured) {
				networking.registerRequestFilter((type, request) => {
					if (request.method === 'HEAD') {
						request.method = 'GET';
					}
					if (Array.isArray(request.uris)) {
						request.uris = request.uris.map((uri) => {
							if (uri.startsWith('blob:') || uri.startsWith('data:') || uri.includes('/api/proxy')) {
								return uri;
							}
							return API_CONFIG.useProxy && API_CONFIG.proxyUrl
								? `${API_CONFIG.proxyUrl}?url=${encodeURIComponent(uri)}`
								: uri;
						});
					}
				});
				shakaNetworkingConfigured = true;
			}
		}
		audioElement.crossOrigin = 'anonymous';
		if (shakaPlayer.attach && shakaAttachedElement !== audioElement) {
			await shakaPlayer.attach(audioElement);
			shakaAttachedElement = audioElement;
		}
		return shakaPlayer!;
	};

	const pruneDashManifestCache = () => {
		const keepKeys = new Set<string>();
		const dashQuality: AudioQuality = 'HI_RES_LOSSLESS';
		const current = get(options.playerStore).currentTrack;
		if (current && !isSonglinkTrack(current)) {
			keepKeys.add(getCacheKey(current.id, dashQuality));
		}
		const { queue, queueIndex } = get(options.playerStore);
		const nextTrack = queue[queueIndex + 1];
		if (nextTrack && !isSonglinkTrack(nextTrack)) {
			keepKeys.add(getCacheKey(nextTrack.id, dashQuality));
		}
		for (const key of dashManifestCache.keys()) {
			if (!keepKeys.has(key)) {
				dashManifestCache.delete(key);
			}
		}
	};

	const cacheFlacFallback = (trackId: number, result: DashManifestResult | DashManifestWithMetadata) => {
		const manifestResult = 'result' in result ? result.result : result;
		const trackInfo = 'trackInfo' in result ? result.trackInfo : null;

		if (manifestResult.kind !== 'flac') {
			return;
		}
		const fallbackUrl = manifestResult.urls.find(
			(candidate) => typeof candidate === 'string' && candidate.length > 0
		);
		if (!fallbackUrl) {
			return;
		}
		const proxied = API_CONFIG.useProxy && API_CONFIG.proxyUrl
			? `${API_CONFIG.proxyUrl}?url=${encodeURIComponent(fallbackUrl)}`
			: fallbackUrl;
		streamCache.set(getCacheKey(trackId, 'LOSSLESS'), {
			url: proxied,
			replayGain: trackInfo?.replayGain ?? null,
			sampleRate: trackInfo?.sampleRate ?? null,
			bitDepth: trackInfo?.bitDepth ?? null
		});
	};

	const resolveStream = async (
		track: Track,
		overrideQuality?: AudioQuality
	): Promise<{
		url: string;
		replayGain: number | null;
		sampleRate: number | null;
		bitDepth: number | null;
	}> => {
		const baseQuality = options.getPlaybackQuality?.() ?? get(options.playerStore).quality;
		const quality = overrideQuality ?? baseQuality;
		if (options.isHiResQuality(quality)) {
			throw new Error('Attempted to resolve hi-res stream via standard resolver');
		}
		const cacheKey = getCacheKey(track.id, quality);
		const cached = streamCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const data = await losslessAPI.getStreamData(track.id, quality);
		const url = API_CONFIG.useProxy && API_CONFIG.proxyUrl
			? `${API_CONFIG.proxyUrl}?url=${encodeURIComponent(data.url)}`
			: data.url;
		const entry = {
			url,
			replayGain: data.replayGain,
			sampleRate: data.sampleRate,
			bitDepth: data.bitDepth
		};
		streamCache.set(cacheKey, entry);
		return entry;
	};

	const pruneStreamCache = () => {
		const quality = options.getPlaybackQuality?.() ?? get(options.playerStore).quality;
		const keepKeys = new Set<string>();
		const baseQualities: AudioQuality[] = options.isHiResQuality(quality) ? ['LOSSLESS'] : [quality];
		const current = get(options.playerStore).currentTrack;
		if (current && !isSonglinkTrack(current)) {
			for (const base of baseQualities) {
				keepKeys.add(getCacheKey(current.id, base));
			}
		}
		const { queue, queueIndex } = get(options.playerStore);
		const nextTrack = queue[queueIndex + 1];
		if (nextTrack && !isSonglinkTrack(nextTrack)) {
			for (const base of baseQualities) {
				keepKeys.add(getCacheKey(nextTrack.id, base));
			}
		}

		for (const key of streamCache.keys()) {
			if (!keepKeys.has(key)) {
				streamCache.delete(key);
			}
		}
	};

	const preloadDashManifest = async (track: Track) => {
		const cacheKey = getCacheKey(track.id, 'HI_RES_LOSSLESS');
		if (dashManifestCache.has(cacheKey) || preloadingCacheKey === cacheKey) {
			const cached = dashManifestCache.get(cacheKey);
			if (cached) {
				cacheFlacFallback(track.id, cached.result);
			}
			return;
		}

		preloadingCacheKey = cacheKey;
		try {
			const result = await losslessAPI.getDashManifestWithMetadata(track.id, 'HI_RES_LOSSLESS');
			dashManifestCache.set(cacheKey, result);
			cacheFlacFallback(track.id, result.result);
			pruneDashManifestCache();
		} catch (error) {
			console.warn('Failed to preload dash manifest:', error);
		} finally {
			if (preloadingCacheKey === cacheKey) {
				preloadingCacheKey = null;
			}
		}
	};

	const preloadNextTrack = async (track: Track) => {
		const cacheKey = getCacheKey(track.id, 'HI_RES_LOSSLESS');
		if (dashManifestCache.has(cacheKey) || preloadingCacheKey === cacheKey) {
			return;
		}
		await preloadDashManifest(track);
	};

	const maybePreloadNextTrack = (remainingSeconds: number) => {
		if (remainingSeconds > options.preloadThresholdSeconds) {
			return;
		}
		const { queue, queueIndex } = get(options.playerStore);
		const nextTrack = queue[queueIndex + 1];
		if (!nextTrack || isSonglinkTrack(nextTrack)) {
			return;
		}
		const dashKey = getCacheKey(nextTrack.id, 'HI_RES_LOSSLESS');
		if (dashManifestCache.has(dashKey) || preloadingCacheKey === dashKey) {
			return;
		}
		void preloadNextTrack(nextTrack);
	};

	const loadStandardTrack = async (track: Track, quality: AudioQuality, sequence: number) => {
		try {
			await destroy();
			options.setDashPlaybackActive(false);
			const { url, replayGain, sampleRate, bitDepth } = await resolveStream(track, quality);

			// Use sequence check to prevent partial state updates from stale operations
			const updated = withSequenceCheck(sequence, () => {
				options.setStreamUrl(url);
				options.setCurrentPlaybackQuality(quality);
				options.setReplayGain(replayGain);
				options.setSampleRate(sampleRate);
				options.setBitDepth(bitDepth);
				options.onLoadComplete?.(url, quality);
				return true;
			});

			if (!updated) {
				console.info('[AudioPlayer] Ignoring stale stream load', {
					trackId: track.id,
					sequence,
					current: options.getSequence()
				});
				return;
			}

			pruneStreamCache();
			const audioElement = options.getAudioElement();
			if (audioElement) {
				await tick();
				audioElement.crossOrigin = 'anonymous';
				audioElement.load();
			}
			options.setLoading(false);
		} catch (error) {
			console.error('[AudioPlayer] Failed to load standard track:', error);
			options.onLoadError?.(error instanceof Error ? error : new Error('Failed to load track'));
			if (isSequenceValid(sequence)) {
				options.setLoading(false);
			}
		}
	};

	const loadDashTrack = async (
		track: Track,
		quality: AudioQuality,
		sequence: number
	): Promise<DashManifestWithMetadata> => {
		const cacheKey = getCacheKey(track.id, quality);
		let cached = dashManifestCache.get(cacheKey);
		if (!cached) {
			cached = await losslessAPI.getDashManifestWithMetadata(track.id, quality);
			dashManifestCache.set(cacheKey, cached);
		}
		const { result: manifestResult, trackInfo } = cached;
		cacheFlacFallback(track.id, manifestResult);
		if (manifestResult.kind === 'flac') {
			options.setDashPlaybackActive(false);
			return cached;
		}
		revokeHiResObjectUrl();
		const blob = new Blob([manifestResult.manifest], {
			type: manifestResult.contentType ?? 'application/dash+xml'
		});
		hiResObjectUrl = URL.createObjectURL(blob);
		const player = await ensureShakaPlayer();

		// Check sequence validity before continuing with playback setup
		if (!isSequenceValid(sequence)) {
			console.debug('[TrackLoadController] Aborting DASH load for stale sequence');
			return cached;
		}

		const audioElement = options.getAudioElement();
		if (audioElement) {
			audioElement.pause();
			audioElement.removeAttribute('src');
			audioElement.load();
		}
		await player.unload();
		await player.load(hiResObjectUrl);

		// Use sequence check to apply all state updates atomically
		withSequenceCheck(sequence, () => {
			options.setDashPlaybackActive(true);
			options.setStreamUrl('');
			options.setCurrentPlaybackQuality('HI_RES_LOSSLESS');
			options.onLoadComplete?.(null, 'HI_RES_LOSSLESS');

			if (options.getCurrentTrackId() === track.id) {
				options.setSampleRate(trackInfo.sampleRate);
				options.setBitDepth(trackInfo.bitDepth);
				if (trackInfo.replayGain !== null) {
					options.setReplayGain(trackInfo.replayGain);
				}
			}
		});

		pruneDashManifestCache();
		return cached;
	};

	const loadTrack = async (track: PlayableTrack) => {
		if (!track) {
			console.error('loadTrack called with null/undefined track');
			return;
		}

		if (isSonglinkTrack(track)) {
			console.error('Attempted to load SonglinkTrack directly - this should not happen!', track);
			return;
		}

		const tidalTrack = track as Track;
		if (!tidalTrack || typeof tidalTrack !== 'object') {
			console.error('Invalid track object:', tidalTrack);
			return;
		}
		if (!tidalTrack.id) {
			console.error('Track missing ID:', tidalTrack);
			return;
		}

		const trackId = Number(tidalTrack.id);
		if (!Number.isFinite(trackId) || trackId <= 0) {
			console.error('Invalid track ID - must be numeric:', tidalTrack.id);
			return;
		}

		options.setBufferedPercent(0);
		options.setCurrentPlaybackQuality(null);
		const sequence = options.createSequence();
		options.setLoading(true);
		let requestedQuality = options.getPlaybackQuality?.() ?? get(options.playerStore).quality;

		if (options.isHiResQuality(requestedQuality) && !options.getSupportsLosslessPlayback()) {
			requestedQuality = 'LOSSLESS';
		}

		const trackBestQuality = deriveTrackQuality(tidalTrack);
		if (options.isHiResQuality(requestedQuality) && trackBestQuality && !options.isHiResQuality(trackBestQuality)) {
			requestedQuality = trackBestQuality;
		}

		try {
			if (options.isHiResQuality(requestedQuality)) {
				try {
					const hiResQuality: AudioQuality = 'HI_RES_LOSSLESS';
					const dashResult = await loadDashTrack(tidalTrack, hiResQuality, sequence);
					if (dashResult.result.kind === 'dash') {
						return;
					}
				} catch (dashError) {
					const coded = dashError as { code?: string };
					if (coded?.code === DASH_MANIFEST_UNAVAILABLE_CODE) {
						dashManifestCache.delete(getCacheKey(tidalTrack.id, 'HI_RES_LOSSLESS'));
						options.onDASHUnavailable?.(tidalTrack.id);
					}
					console.warn('DASH playback failed, falling back to lossless stream.', dashError);
				}
				options.onFallbackRequested?.('LOSSLESS', 'dash-fallback');
				await loadStandardTrack(tidalTrack, 'LOSSLESS', sequence);
				return;
			}

			// For standard qualities, go directly to stream resolution without DASH attempt
			// This avoids unnecessary latency and simplifies the fallback chain
			await loadStandardTrack(tidalTrack, requestedQuality, sequence);
		} catch (error) {
			console.error('Failed to load track:', error);
			options.onLoadError?.(error instanceof Error ? error : new Error('Failed to load track'));
			if (
				sequence === options.getSequence() &&
				requestedQuality !== 'LOSSLESS' &&
				!options.isHiResQuality(requestedQuality)
			) {
				try {
					options.onFallbackRequested?.('LOSSLESS', 'retry-lossless');
					await loadStandardTrack(tidalTrack, 'LOSSLESS', sequence);
				} catch (fallbackError) {
					console.error('Secondary lossless fallback failed:', fallbackError);
				}
			} else if (sequence === options.getSequence() && requestedQuality === 'LOSSLESS') {
				console.warn(
					'[AudioPlayer] Lossless load failed; attempting streaming fallback for track',
					tidalTrack.id
				);
				try {
					options.onFallbackRequested?.('HIGH', 'lossless-fallback');
					await loadStandardTrack(tidalTrack, 'HIGH', sequence);
				} catch (fallbackError) {
					console.error(
						'[AudioPlayer] Streaming fallback after lossless load failure also failed',
						fallbackError
					);
				}
			}
		} finally {
			if (sequence === options.getSequence()) {
				options.setLoading(false);
			}
		}
	};

	return {
		loadTrack,
		loadStandardTrack,
		maybePreloadNextTrack,
		destroy
	};
};
