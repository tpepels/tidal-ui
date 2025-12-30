/**
 * Playback Control Service
 *
 * Handles playback operations, seeking, volume control, and audio element management.
 * Provides a clean interface for playback operations that were previously
 * scattered across the AudioPlayer component.
 */

import { playerStore } from '$lib/stores/player';
import { get } from 'svelte/store';

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

/**
 * Seeks to a specific position in the current track
 */
export function seekToPosition(audioElement: HTMLAudioElement, position: number): void {
	if (!audioElement) {
		console.warn('[PlaybackControl] Cannot seek: audio element not available');
		return;
	}

	const duration = get(playerStore).duration;
	if (!duration || duration === 0) {
		console.warn('[PlaybackControl] Cannot seek: duration not available');
		return;
	}

	const clampedPosition = Math.max(0, Math.min(position, duration));
	audioElement.currentTime = clampedPosition;
	playerStore.setCurrentTime(clampedPosition);

	console.log('[PlaybackControl] Seeked to position:', clampedPosition);
}

/**
 * Handles "previous track" logic with smart restart behavior
 * If more than 5 seconds into track, restart current track
 * Otherwise, go to previous track in queue
 */
export function handlePreviousTrack(audioElement: HTMLAudioElement): void {
	const state = get(playerStore);
	const currentTime = state.currentTime;
	const queueIndex = state.queueIndex;

	// If more than 5 seconds in, restart current track
	if (currentTime > 5) {
		seekToPosition(audioElement, 0);
		return;
	}

	// If at start of queue, restart current track
	if (queueIndex <= 0) {
		seekToPosition(audioElement, 0);
		return;
	}

	// Go to previous track
	playerStore.previous();
}

/**
 * Adjusts volume and updates store
 */
export function setVolume(volume: number): void {
	const clampedVolume = Math.max(0, Math.min(1, volume));
	playerStore.setVolume(clampedVolume);
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

/**
 * Handles seeking from external sources (e.g., lyrics panel)
 */
export function handleExternalSeek(
	audioElement: HTMLAudioElement,
	timeSeconds: number,
	shouldResume: boolean = true
): void {
	const state = get(playerStore);

	if (timeSeconds >= 0 && timeSeconds <= state.duration) {
		seekToPosition(audioElement, timeSeconds);

		// Resume playback if requested and not already playing
		if (shouldResume && !state.isPlaying) {
			requestAudioPlayback(audioElement).catch((err) => {
				console.error('[PlaybackControl] Failed to resume after seek:', err);
			});
		}
	}
}
