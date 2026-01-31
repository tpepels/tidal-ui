import { describe, expect, it, vi } from 'vitest';
import { createPlaybackFallbackController } from './playbackFallbackController';
import type { AudioQuality, PlayableTrack } from '$lib/types';

// Minimal mock track - using type assertion since we only need id for testing
const createMockTrack = (id: number): PlayableTrack =>
	({
		id,
		title: 'Test Track',
		duration: 180
	}) as PlayableTrack;

describe('playbackFallbackController', () => {
	const createMockOptions = () => ({
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
		createSequence: vi.fn(() => 1),
		setResumeAfterFallback: vi.fn(),
		onFallbackRequested: vi.fn()
	});

	describe('lossless fallback guards', () => {
		it('should return fallback result on first lossless error', () => {
			const options = createMockOptions();
			const controller = createPlaybackFallbackController(options);

			// Create a mock error event with MEDIA_ERR_SRC_NOT_SUPPORTED
			const mockAudioElement = {
				error: {
					code: 4,
					MEDIA_ERR_ABORTED: 1,
					MEDIA_ERR_NETWORK: 2,
					MEDIA_ERR_DECODE: 3,
					MEDIA_ERR_SRC_NOT_SUPPORTED: 4
				}
			};
			const mockEvent = {
				currentTarget: mockAudioElement
			} as unknown as Event;

			const result = controller.handleAudioError(mockEvent);

			expect(result).not.toBeNull();
			expect(result?.quality).toBe('HIGH');
			expect(result?.reason).toBe('lossless-playback');
		});

		it('should return null on second lossless error for same track', () => {
			const options = createMockOptions();
			const controller = createPlaybackFallbackController(options);

			const mockAudioElement = {
				error: {
					code: 4,
					MEDIA_ERR_ABORTED: 1,
					MEDIA_ERR_NETWORK: 2,
					MEDIA_ERR_DECODE: 3,
					MEDIA_ERR_SRC_NOT_SUPPORTED: 4
				}
			};
			const mockEvent = {
				currentTarget: mockAudioElement
			} as unknown as Event;

			// First error triggers fallback
			const firstResult = controller.handleAudioError(mockEvent);
			expect(firstResult).not.toBeNull();

			// Second error should be ignored
			const secondResult = controller.handleAudioError(mockEvent);
			expect(secondResult).toBeNull();
		});

		it('should allow fallback for a different track after reset', () => {
			const options = createMockOptions();
			const controller = createPlaybackFallbackController(options);

			const mockAudioElement = {
				error: {
					code: 4,
					MEDIA_ERR_ABORTED: 1,
					MEDIA_ERR_NETWORK: 2,
					MEDIA_ERR_DECODE: 3,
					MEDIA_ERR_SRC_NOT_SUPPORTED: 4
				}
			};
			const mockEvent = {
				currentTarget: mockAudioElement
			} as unknown as Event;

			// First track error triggers fallback
			const firstResult = controller.handleAudioError(mockEvent);
			expect(firstResult).not.toBeNull();

			// Reset for new track
			controller.resetForTrack(456);

			// New track error should trigger fallback
			options.getCurrentTrack.mockReturnValue(createMockTrack(456));
			const thirdResult = controller.handleAudioError(mockEvent);
			expect(thirdResult).not.toBeNull();
		});
	});

	describe('DASH fallback guards', () => {
		it('should return fallback result on first DASH error', () => {
			const options = createMockOptions();
			options.getDashPlaybackActive.mockReturnValue(true);
			const controller = createPlaybackFallbackController(options);

			const mockAudioElement = {
				error: {
					code: 3,
					MEDIA_ERR_ABORTED: 1,
					MEDIA_ERR_NETWORK: 2,
					MEDIA_ERR_DECODE: 3,
					MEDIA_ERR_SRC_NOT_SUPPORTED: 4
				}
			};
			const mockEvent = {
				currentTarget: mockAudioElement
			} as unknown as Event;

			const result = controller.handleAudioError(mockEvent);

			expect(result).not.toBeNull();
			expect(result?.quality).toBe('LOSSLESS');
			expect(result?.reason).toContain('dash-playback');
		});

		it('should return null on second DASH error for same track', () => {
			const options = createMockOptions();
			options.getDashPlaybackActive.mockReturnValue(true);
			const controller = createPlaybackFallbackController(options);

			const mockAudioElement = {
				error: {
					code: 3,
					MEDIA_ERR_ABORTED: 1,
					MEDIA_ERR_NETWORK: 2,
					MEDIA_ERR_DECODE: 3,
					MEDIA_ERR_SRC_NOT_SUPPORTED: 4
				}
			};
			const mockEvent = {
				currentTarget: mockAudioElement
			} as unknown as Event;

			// First error triggers fallback
			const firstResult = controller.handleAudioError(mockEvent);
			expect(firstResult).not.toBeNull();

			// Second error should be ignored
			const secondResult = controller.handleAudioError(mockEvent);
			expect(secondResult).toBeNull();
		});
	});

	describe('no fallback for non-lossless qualities', () => {
		it('should not fallback when playing streaming quality', () => {
			const options = createMockOptions();
			options.getPlayerQuality.mockReturnValue('HIGH');
			options.getCurrentPlaybackQuality.mockReturnValue('HIGH');
			const controller = createPlaybackFallbackController(options);

			const mockAudioElement = {
				error: {
					code: 4,
					MEDIA_ERR_ABORTED: 1,
					MEDIA_ERR_NETWORK: 2,
					MEDIA_ERR_DECODE: 3,
					MEDIA_ERR_SRC_NOT_SUPPORTED: 4
				}
			};
			const mockEvent = {
				currentTarget: mockAudioElement
			} as unknown as Event;

			const result = controller.handleAudioError(mockEvent);
			expect(result).toBeNull();
		});
	});

	describe('aborted errors are ignored', () => {
		it('should not fallback on MEDIA_ERR_ABORTED', () => {
			const options = createMockOptions();
			const controller = createPlaybackFallbackController(options);

			const mockAudioElement = {
				error: {
					code: 1,
					MEDIA_ERR_ABORTED: 1,
					MEDIA_ERR_NETWORK: 2,
					MEDIA_ERR_DECODE: 3,
					MEDIA_ERR_SRC_NOT_SUPPORTED: 4
				}
			};
			const mockEvent = {
				currentTarget: mockAudioElement
			} as unknown as Event;

			const result = controller.handleAudioError(mockEvent);
			expect(result).toBeNull();
		});
	});
});
