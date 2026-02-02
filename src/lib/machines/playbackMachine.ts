/**
 * Playback State Machine
 *
 * Explicit finite state machine for audio playback to replace complex reactive effects.
 * This eliminates race conditions and makes playback behavior deterministic and testable.
 *
 * States:
 * - idle: No track loaded
 * - loading: Fetching stream URL / DASH manifest
 * - ready: Stream loaded, ready to play
 * - playing: Currently playing audio
 * - paused: Playback paused
 * - error: Playback failed
 *
 * Events (intents):
 * - LOAD_TRACK: Start loading a new track
 * - LOAD_COMPLETE: Stream URL ready
 * - LOAD_ERROR: Failed to load stream
 * - PLAY: User requests playback
 * - PAUSE: User requests pause
 * - AUDIO_ERROR: Audio element error
 * - TRACK_END: Playback reached end
 * - CHANGE_QUALITY: User changes quality setting
 */

import type { Track, AudioQuality, PlayableTrack } from '$lib/types';
import { isSonglinkTrack } from '$lib/types';

export type PlaybackState =
	| 'idle'
	| 'converting' // Songlink → TIDAL conversion
	| 'loading' // Fetching stream
	| 'ready' // Ready to play
	| 'playing'
	| 'paused'
	| 'buffering' // Playing but waiting for data
	| 'error';

export type PlaybackEvent =
	| { type: 'LOAD_TRACK'; track: PlayableTrack }
	| { type: 'SET_QUEUE'; queue: PlayableTrack[]; queueIndex: number }
	| { type: 'CONVERSION_COMPLETE'; track: Track }
	| { type: 'CONVERSION_ERROR'; error: Error }
	| { type: 'LOAD_COMPLETE'; streamUrl: string | null; quality: AudioQuality }
	| { type: 'LOAD_ERROR'; error: Error }
	| { type: 'PLAY' }
	| { type: 'PAUSE' }
	| { type: 'AUDIO_READY' }
	| { type: 'AUDIO_PLAYING' }
	| { type: 'AUDIO_PAUSED' }
	| { type: 'AUDIO_WAITING' }
	| { type: 'AUDIO_ERROR'; error: Event }
	| { type: 'TRACK_END' }
	| { type: 'CHANGE_QUALITY'; quality: AudioQuality }
	| { type: 'FALLBACK_REQUESTED'; quality: AudioQuality; reason: string }
	| { type: 'SEEK'; position: number };

/**
 * Generate a unique attempt ID for correlation and stale event detection.
 * Format: "att-{timestamp}-{random}"
 */
const generateAttemptId = (): string =>
	`att-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export interface PlaybackContext {
	currentTrack: PlayableTrack | null;
	queue: PlayableTrack[];
	queueIndex: number;
	streamUrl: string | null;
	/**
	 * The user's requested/preferred quality setting.
	 * This is what the user selected in preferences.
	 */
	quality: AudioQuality;
	/**
	 * The actual quality currently being played.
	 * May differ from `quality` after fallback (e.g., LOSSLESS → HIGH).
	 * Null when not actively playing a stream.
	 */
	effectiveQuality: AudioQuality | null;
	currentTime: number;
	duration: number;
	volume: number;
	isMuted: boolean;
	error: Error | null;
	loadRequestId: number; // Request token for loads
	/**
	 * Unique identifier for the current playback attempt.
	 * Used to detect and ignore stale async events from previous attempts.
	 * Generated fresh on each LOAD_TRACK or FALLBACK_REQUESTED event.
	 */
	attemptId: string;
	autoPlay: boolean;
	/**
	 * True when loading due to fallback recovery after an error.
	 * Used by UI sync to avoid showing "playing" during error recovery.
	 */
	isRecovering: boolean;
}

export interface PlaybackMachineState {
	state: PlaybackState;
	context: PlaybackContext;
}

/**
 * State transition function
 * Pure function that returns new state based on current state and event
 */
export function transition(
	current: PlaybackMachineState,
	event: PlaybackEvent
): PlaybackMachineState {
	const { state, context } = current;

	switch (event.type) {
		case 'LOAD_TRACK': {
			// Always allow loading a new track
			// Generate new attemptId to invalidate any in-flight async operations from previous track
			const newAttemptId = generateAttemptId();
			return {
				state: isSonglinkTrack(event.track) ? 'converting' : 'loading',
				context: {
					...context,
					currentTrack: event.track,
					streamUrl: null,
					// Reset effectiveQuality until new stream loads
					effectiveQuality: null,
					error: null,
					loadRequestId: context.loadRequestId + 1,
					attemptId: newAttemptId,
					autoPlay: context.autoPlay || state === 'playing' || state === 'buffering',
					// Clear recovery flag on new track load
					isRecovering: false
				}
			};
		}

		case 'SET_QUEUE': {
			const nextTrack =
				event.queueIndex >= 0 && event.queueIndex < event.queue.length
					? event.queue[event.queueIndex] ?? null
					: null;
			return {
				state,
				context: {
					...context,
					queue: event.queue,
					queueIndex: event.queueIndex,
					currentTrack: nextTrack ?? null
				}
			};
		}

		case 'CONVERSION_COMPLETE': {
			if (state !== 'converting') return current;
			return {
				state: 'loading',
				context: {
					...context,
					currentTrack: event.track
				}
			};
		}

		case 'CONVERSION_ERROR': {
			if (state !== 'converting') return current;
			return {
				state: 'error',
				context: {
					...context,
					error: event.error
				}
			};
		}

		case 'LOAD_COMPLETE': {
			const nextContext = {
				...context,
				streamUrl: event.streamUrl,
				// effectiveQuality is what's actually playing (may differ from user preference after fallback)
				effectiveQuality: event.quality,
				error: null,
				// Clear recovery flag - load succeeded, playback can proceed normally
				isRecovering: false
			};
			if (state === 'loading') {
				return {
					state: context.autoPlay ? 'playing' : 'ready',
					context: nextContext
				};
			}
			if (state === 'playing' || state === 'paused' || state === 'buffering') {
				return {
					state,
					context: nextContext
				};
			}
			return current;
		}

		case 'LOAD_ERROR': {
			if (state !== 'loading') return current;
			return {
				state: 'error',
				context: {
					...context,
					error: event.error
				}
			};
		}

		case 'PLAY': {
			// Can only play from ready, paused, or buffering states
			if (state === 'ready' || state === 'paused' || state === 'buffering') {
				return {
					state: 'playing',
					context: {
						...context,
						autoPlay: true,
						isRecovering: false
					}
				};
			}
			if (state === 'loading' || state === 'converting') {
				return {
					state,
					context: {
						...context,
						autoPlay: true
					}
				};
			}
			if (state === 'error' && context.currentTrack) {
				// Generate new attemptId for retry attempt
				const retryAttemptId = generateAttemptId();
				return {
					state: 'loading',
					context: {
						...context,
						streamUrl: null,
						// Reset effectiveQuality until retry loads
						effectiveQuality: null,
						error: null,
						loadRequestId: context.loadRequestId + 1,
						attemptId: retryAttemptId,
						autoPlay: true,
						// Mark as recovering when retrying from error state
						isRecovering: true
					}
				};
			}
			return current;
		}

		case 'PAUSE': {
			if (state === 'playing' || state === 'buffering') {
				return {
					state: 'paused',
					context: {
						...context,
						autoPlay: false
					}
				};
			}
			if (state === 'loading' || state === 'converting' || state === 'ready') {
				return {
					state,
					context: {
						...context,
						autoPlay: false
					}
				};
			}
			return current;
		}

		case 'AUDIO_READY': {
			if (state === 'loading') {
				return {
					state: context.autoPlay ? 'playing' : 'ready',
					context
				};
			}
			return current;
		}

		case 'AUDIO_PLAYING': {
			// Acknowledge audio element is playing
			if (state === 'playing' || state === 'buffering') {
				return {
					state: 'playing',
					context
				};
			}
			return current;
		}

		case 'AUDIO_PAUSED': {
			if (state === 'playing') {
				return {
					state: 'paused',
					context
				};
			}
			return current;
		}

		case 'AUDIO_WAITING': {
			if (state === 'playing') {
				return {
					state: 'buffering',
					context
				};
			}
			return current;
		}

		case 'AUDIO_ERROR': {
			return {
				state: 'error',
				context: {
					...context,
					error: new Error('Audio playback error')
				}
			};
		}

		case 'TRACK_END': {
			if (state === 'playing') {
				return {
					state: 'idle',
					context: {
						...context,
						currentTime: 0,
						autoPlay: false
					}
				};
			}
			return current;
		}

		case 'CHANGE_QUALITY': {
			// User explicitly changes quality preference - update both quality and reset effectiveQuality
			if (context.currentTrack && state !== 'idle') {
				return {
					state: 'loading',
					context: {
						...context,
						quality: event.quality,
						// Reset effectiveQuality until new stream loads
						effectiveQuality: null,
						streamUrl: null,
						loadRequestId: context.loadRequestId + 1
					}
				};
			}
			// Just update preference if no track loaded
			return {
				state,
				context: {
					...context,
					quality: event.quality
				}
			};
		}

		case 'FALLBACK_REQUESTED': {
			if (!context.currentTrack) {
				return current;
			}
			// Generate new attemptId to invalidate any in-flight async operations from previous quality attempt
			const fallbackAttemptId = generateAttemptId();
			// NOTE: Do NOT change `quality` here - that's the user's preference.
			// The fallback quality will be set as `effectiveQuality` when LOAD_COMPLETE fires.
			return {
				state: 'loading',
				context: {
					...context,
					// Reset effectiveQuality until fallback stream loads
					effectiveQuality: null,
					streamUrl: null,
					error: null,
					loadRequestId: context.loadRequestId + 1,
					attemptId: fallbackAttemptId,
					autoPlay: true,
					// Mark as recovering so UI doesn't show "playing" during fallback load
					isRecovering: true
				}
			};
		}

		case 'SEEK': {
			return {
				state,
				context: {
					...context,
					currentTime: event.position
				}
			};
		}

		default:
			return current;
	}
}

/**
 * Creates initial machine state
 */
export function createInitialState(quality: AudioQuality = 'HIGH'): PlaybackMachineState {
	return {
		state: 'idle',
		context: {
			currentTrack: null,
			queue: [],
			queueIndex: -1,
			streamUrl: null,
			quality,
			effectiveQuality: null,
			currentTime: 0,
			duration: 0,
			volume: 0.8,
			isMuted: false,
			error: null,
			loadRequestId: 0,
			attemptId: generateAttemptId(),
			autoPlay: false,
			isRecovering: false
		}
	};
}

/**
 * Side effect coordinator
 * Maps state transitions to side effects (API calls, audio element control, etc.)
 */
export type SideEffect =
	| { type: 'CONVERT_SONGLINK'; track: PlayableTrack; attemptId: string }
	| { type: 'LOAD_STREAM'; track: Track; quality: AudioQuality; requestId: number; attemptId: string }
	| { type: 'SET_AUDIO_SRC'; url: string; attemptId: string }
	| { type: 'PLAY_AUDIO' }
	| { type: 'PAUSE_AUDIO' }
	| { type: 'SEEK_AUDIO'; position: number }
	| { type: 'SHOW_ERROR'; error: Error }
	| { type: 'SYNC_PLAYER_TRACK'; track: Track }
	| { type: 'HANDLE_AUDIO_ERROR'; error: Event; attemptId: string };

/**
 * Derives side effects from state transitions
 */
export function deriveSideEffects(
	prev: PlaybackMachineState,
	next: PlaybackMachineState,
	event: PlaybackEvent
): SideEffect[] {
	const effects: SideEffect[] = [];

	// State entry effects
	const loadCompleteWithUrl = event.type === 'LOAD_COMPLETE' && Boolean(event.streamUrl);

	if (prev.state !== next.state) {
		switch (next.state) {
			case 'converting':
				if (next.context.currentTrack && isSonglinkTrack(next.context.currentTrack)) {
					effects.push({
						type: 'CONVERT_SONGLINK',
						track: next.context.currentTrack,
						attemptId: next.context.attemptId
					});
				}
				break;

			case 'loading':
				if (
					next.context.currentTrack &&
					!isSonglinkTrack(next.context.currentTrack) &&
					event.type !== 'FALLBACK_REQUESTED'
				) {
					effects.push({
						type: 'LOAD_STREAM',
						track: next.context.currentTrack,
						quality: next.context.quality,
						requestId: next.context.loadRequestId,
						attemptId: next.context.attemptId
					});
				}
				break;

			case 'ready':
				if (!loadCompleteWithUrl && next.context.streamUrl) {
					effects.push({
						type: 'SET_AUDIO_SRC',
						url: next.context.streamUrl,
						attemptId: next.context.attemptId
					});
				}
				break;

			case 'playing':
				if (!loadCompleteWithUrl) {
					effects.push({ type: 'PLAY_AUDIO' });
				}
				break;

			case 'paused':
				effects.push({ type: 'PAUSE_AUDIO' });
				break;

			case 'error':
				if (next.context.error) {
					effects.push({ type: 'SHOW_ERROR', error: next.context.error });
				}
				break;
		}
	}

	// Event-specific effects
	if (event.type === 'CONVERSION_COMPLETE') {
		effects.push({ type: 'SYNC_PLAYER_TRACK', track: event.track });
	}
	if (event.type === 'LOAD_COMPLETE' && event.streamUrl) {
		effects.push({
			type: 'SET_AUDIO_SRC',
			url: event.streamUrl,
			attemptId: next.context.attemptId
		});
		if (next.state === 'playing' || next.state === 'buffering') {
			effects.push({ type: 'PLAY_AUDIO' });
		}
	}
	if (event.type === 'SEEK') {
		effects.push({ type: 'SEEK_AUDIO', position: event.position });
	}
	if (event.type === 'AUDIO_ERROR') {
		effects.push({
			type: 'HANDLE_AUDIO_ERROR',
			error: event.error,
			attemptId: next.context.attemptId
		});
	}

	return effects;
}
