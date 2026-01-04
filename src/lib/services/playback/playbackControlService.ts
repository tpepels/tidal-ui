/**
 * Playback Control Service
 *
 * Handles playback operations, seeking, volume control, and audio element management.
 * Provides a clean interface for playback operations that were previously
 * scattered across the AudioPlayer component.
 */

/**
 * Requests audio playback with error recovery
 * Handles the common play → pause → play pattern needed for certain browser states
 */
export async function requestAudioPlayback(audioElement: HTMLAudioElement): Promise<void> {
	if (!audioElement) {
		throw new Error('Audio element not available');
	}

	try {
		await audioElement.play();
	} catch (err) {
		// Some browsers require pause before play in certain states
		console.warn('[PlaybackControl] First play attempt failed, retrying with pause:', err);
		try {
			audioElement.pause();
			await audioElement.play();
		} catch (retryErr) {
			console.error('[PlaybackControl] Playback failed after retry:', retryErr);
			throw retryErr;
		}
	}
}

export interface SeekOptions {
	duration?: number | null;
	onSetCurrentTime?: (time: number) => void;
}

export interface PreviousTrackOptions extends SeekOptions {
	currentTime: number;
	queueIndex: number;
	onPrevious?: () => void;
}

export interface VolumeOptions {
	onSetVolume?: (volume: number) => void;
}

/**
 * Seeks to a specific position in the current track
 */
export function seekToPosition(
	audioElement: HTMLAudioElement,
	position: number,
	options?: SeekOptions
): void {
	if (!audioElement) {
		console.warn('[PlaybackControl] Cannot seek: audio element not available');
		return;
	}

	const duration = options?.duration ?? 0;
	if (!duration || duration === 0) {
		console.warn('[PlaybackControl] Cannot seek: duration not available');
		return;
	}

	const clampedPosition = Math.max(0, Math.min(position, duration));
	audioElement.currentTime = clampedPosition;
	options?.onSetCurrentTime?.(clampedPosition);

	console.log('[PlaybackControl] Seeked to position:', clampedPosition);
}

/**
 * Handles "previous track" logic with smart restart behavior
 * If more than 5 seconds into track, restart current track
 * Otherwise, go to previous track in queue
 */
export function handlePreviousTrack(audioElement: HTMLAudioElement, options: PreviousTrackOptions): void {
	const resetToStart = () => {
		if (!audioElement) {
			console.warn('[PlaybackControl] Cannot seek: audio element not available');
			return;
		}
		audioElement.currentTime = 0;
		options.onSetCurrentTime?.(0);
	};

	// If more than 5 seconds in, restart current track
	if (options.currentTime > 5) {
		resetToStart();
		return;
	}

	// If at start of queue, restart current track
	if (options.queueIndex <= 0) {
		resetToStart();
		return;
	}

	// Go to previous track
	options.onPrevious?.();
}

/**
 * Adjusts volume and updates store
 */
export function setVolume(volume: number, options?: VolumeOptions): number {
	const clampedVolume = Math.max(0, Math.min(1, volume));
	options?.onSetVolume?.(clampedVolume);
	return clampedVolume;
}

/**
 * Toggles mute state
 */
export function toggleMute(
	currentVolume: number,
	isMuted: boolean
): { isMuted: boolean; volume: number; previousVolume: number } {
	if (isMuted) {
		// Unmute: restore previous volume (or default to 1.0)
		const newVolume = currentVolume || 1.0;
		return {
			isMuted: false,
			volume: newVolume,
			previousVolume: currentVolume
		};
	} else {
		// Mute: save current volume and set to 0
		return {
			isMuted: true,
			volume: 0,
			previousVolume: currentVolume
		};
	}
}
