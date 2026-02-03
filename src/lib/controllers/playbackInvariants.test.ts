/**
 * Playback System Invariant Tests
 *
 * These tests verify critical invariants that must ALWAYS hold true:
 * 1. Fallback guards prevent duplicate fallback attempts
 * 2. AbortErrors from play() interruption are properly detected
 * 3. State machine transitions are idempotent for duplicate events
 *
 * CRITICAL BUGS PREVENTED:
 * - Duplicate FALLBACK_REQUESTED events causing state machine corruption
 * - AbortErrors being treated as real playback errors
 * - Race conditions when rapidly switching tracks
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlaybackFallbackController } from './playbackFallbackController';
import type { AudioQuality, PlayableTrack } from '$lib/types';

/**
 * Exact copy of production isPlayAbortError from playbackMachineEffects.ts
 * This must stay in sync with the production implementation.
 */
const isPlayAbortError = (error: unknown): boolean => {
	if (!(error instanceof Error)) return false;
	return (
		error.name === 'AbortError' &&
		error.message.includes('interrupted by a new load request')
	);
};

const createMockTrack = (id: number): PlayableTrack =>
	({
		id,
		title: 'Test Track',
		duration: 180
	}) as PlayableTrack;

describe('Playback System Invariants', () => {
	describe('Fallback Guard Invariants', () => {
		const createMockOptions = () => {
			return {
				getCurrentTrack: vi.fn(() => createMockTrack(123)),
				getPlayerQuality: vi.fn(() => 'LOSSLESS' as AudioQuality),
				getCurrentPlaybackQuality: vi.fn(() => 'LOSSLESS' as AudioQuality),
				getIsPlaying: vi.fn(() => true),
				getSupportsLosslessPlayback: vi.fn(() => true),
				getStreamingFallbackQuality: vi.fn(() => 'HIGH' as AudioQuality),
				isFirefox: vi.fn(() => false),
				getDashPlaybackActive: vi.fn(() => false),
				setDashPlaybackActive: vi.fn(),
				setLoading: vi.fn(),
				loadStandardTrack: vi.fn().mockResolvedValue(undefined),
				getAttemptId: vi.fn(() => 'attempt-1'),
				isAttemptCurrent: vi.fn(() => true),
				setResumeAfterFallback: vi.fn(),
				onFallbackRequested: vi.fn()
			};
		};

		const createMediaError = (code: number) => ({
			error: {
				code,
				MEDIA_ERR_ABORTED: 1,
				MEDIA_ERR_NETWORK: 2,
				MEDIA_ERR_DECODE: 3,
				MEDIA_ERR_SRC_NOT_SUPPORTED: 4
			}
		});

		/**
		 * INVARIANT: At most one fallback attempt per track per error type.
		 * This prevents infinite fallback loops and state machine corruption.
		 */
		it('INVARIANT: maximum one lossless fallback per track', () => {
			const options = createMockOptions();
			const controller = createPlaybackFallbackController(options);
			const mockEvent = {
				currentTarget: createMediaError(4) // SRC_NOT_SUPPORTED
			} as unknown as Event;

			// First error should trigger fallback
			const result1 = controller.planFallback(mockEvent);
			expect(result1).not.toBeNull();
			expect(result1?.reason).toBe('lossless-playback');

			// Second, third, fourth... errors should all be ignored
			for (let i = 0; i < 10; i++) {
				const result = controller.planFallback(mockEvent);
				expect(result).toBeNull();
			}
		});

		/**
		 * INVARIANT: At most one DASH fallback per track.
		 */
		it('INVARIANT: maximum one DASH fallback per track', () => {
			const options = createMockOptions();
			options.getDashPlaybackActive.mockReturnValue(true);
			const controller = createPlaybackFallbackController(options);
			const mockEvent = {
				currentTarget: createMediaError(3) // DECODE error
			} as unknown as Event;

			// First error should trigger fallback
			const result1 = controller.planFallback(mockEvent);
			expect(result1).not.toBeNull();
			expect(result1?.reason).toContain('dash-playback');

			// All subsequent errors should be ignored
			for (let i = 0; i < 10; i++) {
				const result = controller.planFallback(mockEvent);
				expect(result).toBeNull();
			}
		});

		/**
		 * INVARIANT: Track change resets fallback guards.
		 * Users should be able to play different tracks without prior failures affecting them.
		 */
		it('INVARIANT: new track resets fallback guards', () => {
			const options = createMockOptions();
			const controller = createPlaybackFallbackController(options);
			const mockEvent = {
				currentTarget: createMediaError(4)
			} as unknown as Event;

			// First track fails, fallback triggered
			const result1 = controller.planFallback(mockEvent);
			expect(result1).not.toBeNull();

			// Second error on same track is ignored
			expect(controller.planFallback(mockEvent)).toBeNull();

			// Switch to new track
			controller.resetForTrack(456);
			options.getCurrentTrack.mockReturnValue(createMockTrack(456));

			// New track can trigger fallback
			const result2 = controller.planFallback(mockEvent);
			expect(result2).not.toBeNull();
		});

		/**
		 * INVARIANT: Non-lossless tracks never trigger fallback.
		 * There's nothing to fall back to.
		 */
		it('INVARIANT: streaming quality never triggers lossless fallback', () => {
			const options = createMockOptions();
			options.getPlayerQuality.mockReturnValue('HIGH');
			options.getCurrentPlaybackQuality.mockReturnValue('HIGH');
			const controller = createPlaybackFallbackController(options);
			const mockEvent = {
				currentTarget: createMediaError(4)
			} as unknown as Event;

			// Error should NOT trigger fallback
			const result = controller.planFallback(mockEvent);
			expect(result).toBeNull();
		});

		/**
		 * INVARIANT: MEDIA_ERR_ABORTED never triggers fallback.
		 * This is a normal browser event, not a playback error.
		 */
		it('INVARIANT: MEDIA_ERR_ABORTED never triggers fallback', () => {
			const options = createMockOptions();
			const controller = createPlaybackFallbackController(options);
			const mockEvent = {
				currentTarget: createMediaError(1) // ABORTED
			} as unknown as Event;

			const result = controller.planFallback(mockEvent);
			expect(result).toBeNull();
		});
	});

	describe('AbortError Detection Invariants', () => {
		/**
		 * Helper to create an AbortError that matches browser behavior.
		 * In browsers, DOMException properly sets .name, but in Node.js it may not.
		 */
		const createAbortError = (message: string): Error => {
			const error = new Error(message);
			error.name = 'AbortError';
			return error;
		};

		/**
		 * INVARIANT: play() AbortError with correct message is correctly identified.
		 * When audio.load() is called while play() promise is pending,
		 * the browser throws AbortError. This is expected behavior, not an error.
		 */
		it('INVARIANT: AbortError from play() interruption is detected', () => {
			const abortError = createAbortError('The play() request was interrupted by a new load request');
			expect(isPlayAbortError(abortError)).toBe(true);
		});

		it('INVARIANT: AbortError with different message is NOT detected', () => {
			// This tests the specificity of our check - generic AbortErrors should not match
			const genericAbortError = createAbortError('The operation was aborted');
			expect(isPlayAbortError(genericAbortError)).toBe(false);
		});

		it('INVARIANT: regular errors are not detected as AbortError', () => {
			expect(isPlayAbortError(new Error('Network error'))).toBe(false);
			expect(isPlayAbortError(new TypeError('Cannot read property'))).toBe(false);
			expect(isPlayAbortError(new RangeError('Out of bounds'))).toBe(false);
		});

		it('INVARIANT: Error with AbortError message but wrong name is not detected', () => {
			const fakeAbortError = new Error('interrupted by a new load request');
			fakeAbortError.name = 'NotAbortError';
			expect(isPlayAbortError(fakeAbortError)).toBe(false);
		});

		it('INVARIANT: non-Error objects are not AbortError', () => {
			expect(isPlayAbortError('AbortError')).toBe(false);
			expect(isPlayAbortError(null)).toBe(false);
			expect(isPlayAbortError(undefined)).toBe(false);
			expect(isPlayAbortError({ name: 'AbortError' })).toBe(false);
		});
	});

	describe('State Consistency Invariants', () => {
		/**
		 * INVARIANT: onFallbackRequested is called exactly once per fallback.
		 * This ensures the state machine receives exactly one FALLBACK_REQUESTED event.
		 */
		it('INVARIANT: onFallbackRequested called exactly once per fallback', () => {
			const options = {
				getCurrentTrack: vi.fn(() => createMockTrack(123)),
				getPlayerQuality: vi.fn(() => 'LOSSLESS' as AudioQuality),
				getCurrentPlaybackQuality: vi.fn(() => 'LOSSLESS' as AudioQuality),
				getIsPlaying: vi.fn(() => true),
				getSupportsLosslessPlayback: vi.fn(() => true),
				getStreamingFallbackQuality: vi.fn(() => 'HIGH' as AudioQuality),
				isFirefox: vi.fn(() => false),
				getDashPlaybackActive: vi.fn(() => false),
				setDashPlaybackActive: vi.fn(),
				setLoading: vi.fn(),
				loadStandardTrack: vi.fn().mockResolvedValue(undefined),
				getAttemptId: vi.fn(() => 'attempt-1'),
				isAttemptCurrent: vi.fn(() => true),
				setResumeAfterFallback: vi.fn(),
				onFallbackRequested: vi.fn()
			};
			const controller = createPlaybackFallbackController(options);
			const mockEvent = {
				currentTarget: {
					error: {
						code: 4,
						MEDIA_ERR_ABORTED: 1,
						MEDIA_ERR_NETWORK: 2,
						MEDIA_ERR_DECODE: 3,
						MEDIA_ERR_SRC_NOT_SUPPORTED: 4
					}
				}
			} as unknown as Event;

			// Trigger multiple errors
			const plan1 = controller.planFallback(mockEvent);
			const plan2 = controller.planFallback(mockEvent);
			const plan3 = controller.planFallback(mockEvent);

			if (plan1) {
				void controller.executeFallback(plan1, 'attempt-1');
			}
			if (plan2) {
				void controller.executeFallback(plan2, 'attempt-1');
			}
			if (plan3) {
				void controller.executeFallback(plan3, 'attempt-1');
			}

			// Callback should only be called once
			expect(options.onFallbackRequested).toHaveBeenCalledTimes(1);
			expect(options.onFallbackRequested).toHaveBeenCalledWith('HIGH', 'lossless-playback');
		});

		/**
		 * INVARIANT: loadStandardTrack called exactly once per fallback.
		 * Duplicate load calls cause race conditions.
		 */
		it('INVARIANT: loadStandardTrack called exactly once per fallback', async () => {
			const options = {
				getCurrentTrack: vi.fn(() => createMockTrack(123)),
				getPlayerQuality: vi.fn(() => 'LOSSLESS' as AudioQuality),
				getCurrentPlaybackQuality: vi.fn(() => 'LOSSLESS' as AudioQuality),
				getIsPlaying: vi.fn(() => true),
				getSupportsLosslessPlayback: vi.fn(() => true),
				getStreamingFallbackQuality: vi.fn(() => 'HIGH' as AudioQuality),
				isFirefox: vi.fn(() => false),
				getDashPlaybackActive: vi.fn(() => false),
				setDashPlaybackActive: vi.fn(),
				setLoading: vi.fn(),
				loadStandardTrack: vi.fn().mockResolvedValue(undefined),
				getAttemptId: vi.fn(() => 'attempt-1'),
				isAttemptCurrent: vi.fn(() => true),
				setResumeAfterFallback: vi.fn(),
				onFallbackRequested: vi.fn()
			};
			const controller = createPlaybackFallbackController(options);
			const mockEvent = {
				currentTarget: {
					error: {
						code: 4,
						MEDIA_ERR_ABORTED: 1,
						MEDIA_ERR_NETWORK: 2,
						MEDIA_ERR_DECODE: 3,
						MEDIA_ERR_SRC_NOT_SUPPORTED: 4
					}
				}
			} as unknown as Event;

			// Trigger multiple errors rapidly
			const plan1 = controller.planFallback(mockEvent);
			const plan2 = controller.planFallback(mockEvent);
			const plan3 = controller.planFallback(mockEvent);

			if (plan1) {
				void controller.executeFallback(plan1, 'attempt-1');
			}
			if (plan2) {
				void controller.executeFallback(plan2, 'attempt-1');
			}
			if (plan3) {
				void controller.executeFallback(plan3, 'attempt-1');
			}

			// Wait for async operations
			await new Promise((resolve) => setTimeout(resolve, 10));

			// loadStandardTrack should only be called once
			expect(options.loadStandardTrack).toHaveBeenCalledTimes(1);
		});
	});
});
