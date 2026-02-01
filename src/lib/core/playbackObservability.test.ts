import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	startPlaybackOperation,
	getCurrentPlaybackOperation,
	getPlaybackOperation,
	getRecentPlaybackOperations,
	getPlaybackStats,
	clearPlaybackOperations,
	playbackLogger
} from './playbackObservability';

// Mock the dependencies
vi.mock('./logger', () => ({
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
		getCorrelationId: vi.fn(() => null)
	},
	LogLevel: {
		ERROR: 0,
		WARN: 1,
		INFO: 2,
		DEBUG: 3,
		TRACE: 4
	}
}));

vi.mock('./errorTracker', () => ({
	trackError: vi.fn()
}));

vi.mock('./performance', () => ({
	recordMetric: vi.fn()
}));

describe('Playback Observability', () => {
	beforeEach(() => {
		clearPlaybackOperations();
		vi.clearAllMocks();
	});

	describe('startPlaybackOperation', () => {
		it('should create an operation with unique ID', () => {
			const op = startPlaybackOperation(123, {
				trackTitle: 'Test Track',
				artistName: 'Test Artist',
				quality: 'LOSSLESS'
			});

			expect(op.id).toBeDefined();
			expect(op.id).toMatch(/^pb-\d+-[a-z0-9]+$/);
			expect(op.trackId).toBe(123);
		});

		it('should set the current operation', () => {
			startPlaybackOperation(456, { trackTitle: 'Another Track' });

			const current = getCurrentPlaybackOperation();
			expect(current).not.toBeNull();
			expect(current?.trackId).toBe(456);
		});

		it('should track operation in recent operations', () => {
			startPlaybackOperation(789, { trackTitle: 'Track' });

			const recent = getRecentPlaybackOperations();
			expect(recent).toHaveLength(1);
			expect(recent[0].trackId).toBe(789);
		});
	});

	describe('PlaybackOperationLogger', () => {
		it('should log load complete event', () => {
			const op = startPlaybackOperation(100, { quality: 'HIGH' });

			op.loadComplete('LOSSLESS', 'https://example.com/stream.flac');

			const summary = op.getSummary();
			expect(summary.status).toBe('playing');
			expect(summary.finalQuality).toBe('LOSSLESS');
		});

		it('should track fallback attempts', () => {
			const op = startPlaybackOperation(200, { requestedQuality: 'HI_RES_LOSSLESS' });

			op.fallbackStarted('HI_RES_LOSSLESS', 'LOSSLESS', 'decode error');

			const summary = op.getSummary();
			expect(summary.status).toBe('fallback');
			expect(summary.fallbackAttempts).toHaveLength(1);
			expect(summary.fallbackAttempts[0].fromQuality).toBe('HI_RES_LOSSLESS');
			expect(summary.fallbackAttempts[0].toQuality).toBe('LOSSLESS');
			expect(summary.fallbackAttempts[0].reason).toBe('decode error');
		});

		it('should mark fallback as successful on completion', () => {
			const op = startPlaybackOperation(300, { requestedQuality: 'LOSSLESS' });

			op.fallbackStarted('LOSSLESS', 'HIGH', 'source not supported');
			op.fallbackComplete('HIGH', true);

			const summary = op.getSummary();
			expect(summary.status).toBe('playing');
			expect(summary.fallbackAttempts[0].success).toBe(true);
		});

		it('should mark fallback as failed with error', () => {
			const op = startPlaybackOperation(400, { requestedQuality: 'LOSSLESS' });

			op.fallbackStarted('LOSSLESS', 'HIGH', 'decode error');
			op.fallbackComplete('HIGH', false, 'Network error');

			const summary = op.getSummary();
			expect(summary.status).toBe('error');
			expect(summary.fallbackAttempts[0].success).toBe(false);
			expect(summary.fallbackAttempts[0].error).toBe('Network error');
		});

		it('should track audio errors', () => {
			const op = startPlaybackOperation(500, {});

			op.audioError(4, 'MEDIA_ERR_SRC_NOT_SUPPORTED', true);

			const summary = op.getSummary();
			expect(summary.status).toBe('error');
			expect(summary.events.some((e) => e.context.errorCode === 4)).toBe(true);
		});

		it('should track recovery lifecycle', () => {
			const op = startPlaybackOperation(600, {});

			op.recoveryStarted('decode error fallback');
			op.recoveryComplete(true);

			const summary = op.getSummary();
			expect(summary.status).toBe('playing');
		});

		it('should track playback state changes', () => {
			const op = startPlaybackOperation(700, {});

			op.playing();
			op.paused();
			op.seeked(60);
			op.buffering(50);

			const summary = op.getSummary();
			const phases = summary.events.map((e) => e.phase);
			expect(phases).toContain('playing');
			expect(phases).toContain('paused');
			expect(phases).toContain('buffering');
		});

		it('should complete operation successfully', () => {
			const op = startPlaybackOperation(800, {});

			op.loadComplete('HIGH');
			op.playing();
			op.complete('Track finished');

			const summary = op.getSummary();
			expect(summary.status).toBe('completed');
			expect(summary.totalDuration).toBeDefined();
		});

		it('should fail operation with error', () => {
			const op = startPlaybackOperation(900, {});

			op.fail(new Error('Network timeout'));

			const summary = op.getSummary();
			expect(summary.status).toBe('error');
			expect(summary.finalError).toBe('Network timeout');
		});
	});

	describe('getPlaybackOperation', () => {
		it('should return operation by ID', () => {
			const created = startPlaybackOperation(1000, {});

			const retrieved = getPlaybackOperation(created.id);

			expect(retrieved).not.toBeNull();
			expect(retrieved?.trackId).toBe(1000);
		});

		it('should return null for non-existent ID', () => {
			const result = getPlaybackOperation('non-existent');
			expect(result).toBeNull();
		});
	});

	describe('getRecentPlaybackOperations', () => {
		it('should return all operations', () => {
			startPlaybackOperation(1, {});
			startPlaybackOperation(2, {});
			startPlaybackOperation(3, {});

			const recent = getRecentPlaybackOperations();

			expect(recent).toHaveLength(3);
			// All three should be present (order may vary when created in same millisecond)
			const trackIds = recent.map((op) => op.trackId);
			expect(trackIds).toContain(1);
			expect(trackIds).toContain(2);
			expect(trackIds).toContain(3);
		});

		it('should filter by status', () => {
			const op1 = startPlaybackOperation(10, {});
			op1.complete();

			const op2 = startPlaybackOperation(20, {});
			op2.fail('Error');

			startPlaybackOperation(30, {});

			const completed = getRecentPlaybackOperations({ status: 'completed' });
			const failed = getRecentPlaybackOperations({ status: 'error' });

			expect(completed).toHaveLength(1);
			expect(failed).toHaveLength(1);
		});

		it('should respect limit', () => {
			for (let i = 0; i < 10; i++) {
				startPlaybackOperation(i, {});
			}

			const limited = getRecentPlaybackOperations({ limit: 5 });
			expect(limited).toHaveLength(5);
		});
	});

	describe('getPlaybackStats', () => {
		it('should calculate correct statistics', () => {
			const op1 = startPlaybackOperation(100, {});
			op1.complete();

			const op2 = startPlaybackOperation(200, {});
			op2.complete();

			const op3 = startPlaybackOperation(300, {});
			op3.fail('Error');

			const op4 = startPlaybackOperation(400, {});
			op4.fallbackStarted('LOSSLESS', 'HIGH', 'decode error');
			op4.fallbackComplete('HIGH', true);

			const stats = getPlaybackStats();

			expect(stats.total).toBe(4);
			expect(stats.completed).toBe(3); // 2 completed + 1 playing after successful fallback
			expect(stats.failed).toBe(1);
			expect(stats.fallbackAttempts).toBe(1);
			expect(stats.fallbackSuccessRate).toBe(100);
		});

		it('should track fallback reasons', () => {
			const op1 = startPlaybackOperation(500, {});
			op1.fallbackStarted('HI_RES', 'LOSSLESS', 'decode error');

			const op2 = startPlaybackOperation(600, {});
			op2.fallbackStarted('LOSSLESS', 'HIGH', 'source not supported');

			const op3 = startPlaybackOperation(700, {});
			op3.fallbackStarted('LOSSLESS', 'HIGH', 'decode error');

			const stats = getPlaybackStats();

			expect(stats.fallbackReasons['decode error']).toBe(2);
			expect(stats.fallbackReasons['source not supported']).toBe(1);
		});

		it('should handle empty operations', () => {
			const stats = getPlaybackStats();

			expect(stats.total).toBe(0);
			expect(stats.successRate).toBe(0);
			expect(stats.fallbackSuccessRate).toBe(0);
		});
	});

	describe('playbackLogger standalone', () => {
		it('should log without throwing', () => {
			expect(() => {
				playbackLogger.debug('debug message');
				playbackLogger.info('info message');
				playbackLogger.warn('warn message');
				playbackLogger.error('error message');
			}).not.toThrow();
		});
	});

	describe('multiple operations', () => {
		it('should track multiple concurrent operations', () => {
			const op1 = startPlaybackOperation(1001, { trackTitle: 'Track 1' });
			const op2 = startPlaybackOperation(1002, { trackTitle: 'Track 2' });

			// op2 should be current since it was started last
			const current = getCurrentPlaybackOperation();
			expect(current?.trackId).toBe(1002);

			// Both operations should be retrievable
			const retrieved1 = getPlaybackOperation(op1.id);
			const retrieved2 = getPlaybackOperation(op2.id);

			expect(retrieved1).not.toBeNull();
			expect(retrieved2).not.toBeNull();
		});

		it('should clear current operation on complete/fail', () => {
			const op = startPlaybackOperation(1003, {});
			expect(getCurrentPlaybackOperation()).not.toBeNull();

			op.complete();

			// After completing, current should be cleared
			expect(getCurrentPlaybackOperation()).toBeNull();
		});
	});
});
