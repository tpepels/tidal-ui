import { get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { losslessAPI } from '$lib/api';
import type { PlayableTrack } from '$lib/types';
import { isSonglinkTrack } from '$lib/types';
import { formatArtists } from '$lib/utils/formatters';

type PlayerState = {
	currentTrack: PlayableTrack | null;
	isPlaying: boolean;
	duration: number;
};

type MediaSessionHandlers = {
	onPlay: () => void;
	onPause: () => void;
	onPrevious: () => void;
	onNext: () => void;
	onSeekTo: (time: number) => void;
	onSeekBy: (delta: number) => void;
	onStop: () => void;
	onPlayRequest: (reason: string) => void;
};

type MediaSessionController = {
	registerHandlers: () => void;
	updateMetadata: (track: PlayableTrack | null) => void;
	updatePlaybackState: (state: 'playing' | 'paused' | 'none') => void;
	updatePositionState: () => void;
	cleanup: () => void;
};

const getMediaSessionArtwork = (track: PlayableTrack): MediaImage[] => {
	if (isSonglinkTrack(track)) {
		if (!track.songlinkData?.entitiesByUniqueId) {
			return [];
		}

		const entity = track.songlinkData.entitiesByUniqueId[track.id];
		if (!entity?.thumbnailUrl) {
			return [];
		}

		return [
			{
				src: entity.thumbnailUrl,
				sizes: '640x640',
				type: 'image/jpeg'
			}
		];
	}

	if (!track.album?.cover) {
		return [];
	}

	const sizes = ['80', '160', '320', '640', '1280'] as const;
	const artwork: MediaImage[] = [];

	for (const size of sizes) {
		const src = losslessAPI.getCoverUrl(track.album.cover, size);
		if (src) {
			artwork.push({
				src,
				sizes: `${size}x${size}`,
				type: 'image/jpeg'
			});
		}
	}

	return artwork;
};

export const createMediaSessionController = (
	playbackState: Readable<PlayerState>,
	getAudioElement: () => HTMLMediaElement | null,
	handlers: MediaSessionHandlers
): MediaSessionController => {
	const canUseMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
	let mediaSessionTrackId: number | string | null = null;
	let lastKnownPlaybackState: 'none' | 'paused' | 'playing' = 'none';

	const updateMetadata = (track: PlayableTrack | null) => {
		if (!canUseMediaSession) return;

		if (!track) {
			mediaSessionTrackId = null;
			lastKnownPlaybackState = 'none';
			try {
				navigator.mediaSession.metadata = null;
				navigator.mediaSession.playbackState = 'none';
			} catch (error) {
				console.debug('Media Session reset failed', error);
			}
			return;
		}

		if (mediaSessionTrackId === track.id) {
			return;
		}

		mediaSessionTrackId = track.id;

		try {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: track.title,
				artist: isSonglinkTrack(track) ? track.artistName : formatArtists(track.artists),
				album: isSonglinkTrack(track) ? '' : track.album?.title ?? '',
				artwork: getMediaSessionArtwork(track)
			});
		} catch (error) {
			console.debug('Unable to set Media Session metadata', error);
		}

		updatePositionState();
	};

	const updatePlaybackState = (state: 'playing' | 'paused' | 'none') => {
		if (!canUseMediaSession) return;
		if (lastKnownPlaybackState === state) return;
		lastKnownPlaybackState = state;

		try {
			navigator.mediaSession.playbackState = state;
		} catch (error) {
			console.debug('Unable to set Media Session playback state', error);
		}
	};

	const updatePositionState = () => {
		if (
			!canUseMediaSession ||
			!getAudioElement() ||
			typeof navigator.mediaSession.setPositionState !== 'function'
		) {
			return;
		}

		const audioElement = getAudioElement();
		if (!audioElement) return;

		const durationFromAudio = audioElement.duration;
		const storeState = get(playbackState);
		const duration = Number.isFinite(durationFromAudio) ? durationFromAudio : storeState.duration;
		const playbackRate = audioElement.playbackRate ?? 1;
		if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
			return;
		}

		try {
			navigator.mediaSession.setPositionState({
				duration: Number.isFinite(duration) ? duration : 0,
				playbackRate,
				position: audioElement.currentTime
			});
		} catch (error) {
			console.debug('Unable to set Media Session position state', error);
		}
	};

	const registerHandlers = () => {
		if (!canUseMediaSession) return;

		const safeSetActionHandler = (
			action: MediaSessionAction,
			handler: MediaSessionActionHandler | null
		) => {
			try {
				navigator.mediaSession.setActionHandler(action, handler);
			} catch (error) {
				console.debug(`Media Session action ${action} unsupported`, error);
			}
		};

		safeSetActionHandler('play', async () => {
			handlers.onPlay();
			handlers.onPlayRequest('media session play');
			updatePlaybackState('playing');
			updatePositionState();
		});

		safeSetActionHandler('pause', () => {
			handlers.onPause();
			updatePlaybackState('paused');
			updatePositionState();
		});

		safeSetActionHandler('previoustrack', () => {
			handlers.onPrevious();
		});

		safeSetActionHandler('nexttrack', () => {
			handlers.onNext();
		});

		safeSetActionHandler('seekforward', (details) => {
			const offset = details.seekOffset ?? 10;
			handlers.onSeekBy(offset);
			updatePositionState();
		});

		safeSetActionHandler('seekbackward', (details) => {
			const offset = details.seekOffset ?? 10;
			handlers.onSeekBy(-offset);
			updatePositionState();
		});

		safeSetActionHandler('seekto', (details) => {
			if (details.seekTime === undefined) return;
			handlers.onSeekTo(details.seekTime);
			updatePositionState();
		});

		safeSetActionHandler('stop', () => {
			handlers.onStop();
			updatePlaybackState('paused');
			updatePositionState();
		});
	};

	const cleanup = () => {
		if (!canUseMediaSession) return;
		const actions: MediaSessionAction[] = [
			'play',
			'pause',
			'previoustrack',
			'nexttrack',
			'seekforward',
			'seekbackward',
			'seekto',
			'stop'
		];
		for (const action of actions) {
			try {
				navigator.mediaSession.setActionHandler(action, null);
			} catch (error) {
				console.debug(`Media Session action ${action} unsupported`, error);
			}
		}

		mediaSessionTrackId = null;
		lastKnownPlaybackState = 'none';

		try {
			navigator.mediaSession.metadata = null;
			navigator.mediaSession.playbackState = 'none';
		} catch (error) {
			console.debug('Failed to clean up Media Session', error);
		}
	};

	return {
		registerHandlers,
		updateMetadata,
		updatePlaybackState,
		updatePositionState,
		cleanup
	};
};
