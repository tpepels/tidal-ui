import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	createDownloadOperationLogger,
	getDownloadOperationLogger,
	downloadLogger,
	getRecentOperations,
	getOperation,
	getDownloadStats,
	clearOperations
} from './observability';

describe('Server Observability', () => {
	beforeEach(() => {
		clearOperations();
	});

	describe('createDownloadOperationLogger', () => {
		it('should create an operation logger with unique correlation ID', () => {
			const logger = createDownloadOperationLogger('upload-123', {
				trackId: 456,
				quality: 'LOSSLESS',
				artistName: 'Test Artist',
				trackTitle: 'Test Track'
			});

			expect(logger.correlationId).toBeDefined();
			expect(logger.correlationId).toMatch(/^dl-\d+-[a-z0-9]+$/);
		});

		it('should track the operation in recent operations', () => {
			const logger = createDownloadOperationLogger('upload-456', {
				trackId: 789,
				quality: 'HIGH'
			});

			const operations = getRecentOperations();
			expect(operations).toHaveLength(1);
			expect(operations[0].uploadId).toBe('upload-456');
			expect(operations[0].trackId).toBe(789);
			expect(operations[0].status).toBe('in_progress');
		});

		it('should support phase tracking', () => {
			const logger = createDownloadOperationLogger('upload-789', { trackId: 100 });

			logger.startPhase('metadata', 'Registering metadata');
			logger.startPhase('chunk', 'Processing chunks');
			logger.startPhase('finalize', 'Finalizing upload');

			const operation = getOperation('upload-789');
			expect(operation?.events.length).toBeGreaterThanOrEqual(3);
		});

		it('should track chunk progress', () => {
			const logger = createDownloadOperationLogger('upload-chunk', { trackId: 200 });

			logger.chunkProgress(0, 5, 0, 10000000);
			logger.chunkProgress(1, 5, 2000000, 10000000);
			logger.chunkProgress(2, 5, 4000000, 10000000);

			const operation = getOperation('upload-chunk');
			const chunkEvents = operation?.events.filter((e) => e.phase === 'chunk') ?? [];
			expect(chunkEvents.length).toBeGreaterThanOrEqual(3);
		});

		it('should mark operation as completed on success', () => {
			const logger = createDownloadOperationLogger('upload-complete', { trackId: 300 });

			logger.complete({ action: 'overwrite' });

			const operation = getOperation('upload-complete');
			expect(operation?.status).toBe('completed');
			expect(operation?.totalDuration).toBeDefined();
		});

		it('should mark operation as failed on error', () => {
			const logger = createDownloadOperationLogger('upload-fail', { trackId: 400 });

			logger.fail('Disk full', { errorCode: 'DISK_FULL' });

			const operation = getOperation('upload-fail');
			expect(operation?.status).toBe('failed');
			expect(operation?.finalError).toBe('Disk full');
		});

		it('should track retry attempts', () => {
			const logger = createDownloadOperationLogger('upload-retry', { trackId: 500 });

			logger.retry(1, 'Network timeout');
			logger.retry(2, 'Network timeout');
			logger.retry(3, 'Network timeout');

			const operation = getOperation('upload-retry');
			const retryEvents = operation?.events.filter((e) =>
				e.message.includes('Retry')
			) ?? [];
			expect(retryEvents.length).toBe(3);
		});
	});

	describe('getDownloadOperationLogger', () => {
		it('should return existing operation logger', () => {
			const original = createDownloadOperationLogger('existing-upload', {
				trackId: 600,
				quality: 'LOSSLESS'
			});

			const retrieved = getDownloadOperationLogger('existing-upload');

			expect(retrieved).not.toBeNull();
			expect(retrieved?.correlationId).toBe(original.correlationId);
		});

		it('should return null for non-existent operation', () => {
			const result = getDownloadOperationLogger('non-existent');
			expect(result).toBeNull();
		});
	});

	describe('getRecentOperations', () => {
		it('should return all operations', () => {
			createDownloadOperationLogger('upload-1', { trackId: 1 });
			createDownloadOperationLogger('upload-2', { trackId: 2 });
			createDownloadOperationLogger('upload-3', { trackId: 3 });

			const operations = getRecentOperations();

			expect(operations).toHaveLength(3);
			// All three should be present (order may vary when created in same millisecond)
			const uploadIds = operations.map((op) => op.uploadId);
			expect(uploadIds).toContain('upload-1');
			expect(uploadIds).toContain('upload-2');
			expect(uploadIds).toContain('upload-3');
		});

		it('should filter by status', () => {
			const logger1 = createDownloadOperationLogger('complete-upload', { trackId: 1 });
			logger1.complete();

			const logger2 = createDownloadOperationLogger('failed-upload', { trackId: 2 });
			logger2.fail('Error');

			createDownloadOperationLogger('in-progress-upload', { trackId: 3 });

			const completed = getRecentOperations({ status: 'completed' });
			const failed = getRecentOperations({ status: 'failed' });
			const inProgress = getRecentOperations({ status: 'in_progress' });

			expect(completed).toHaveLength(1);
			expect(failed).toHaveLength(1);
			expect(inProgress).toHaveLength(1);
		});

		it('should respect limit parameter', () => {
			for (let i = 0; i < 10; i++) {
				createDownloadOperationLogger(`upload-${i}`, { trackId: i });
			}

			const limited = getRecentOperations({ limit: 5 });
			expect(limited).toHaveLength(5);
		});
	});

	describe('getDownloadStats', () => {
		it('should calculate correct statistics', () => {
			const logger1 = createDownloadOperationLogger('stat-1', { trackId: 1 });
			logger1.complete();

			const logger2 = createDownloadOperationLogger('stat-2', { trackId: 2 });
			logger2.complete();

			const logger3 = createDownloadOperationLogger('stat-3', { trackId: 3 });
			logger3.fail('Error');

			createDownloadOperationLogger('stat-4', { trackId: 4 });

			const stats = getDownloadStats();

			expect(stats.total).toBe(4);
			expect(stats.completed).toBe(2);
			expect(stats.failed).toBe(1);
			expect(stats.inProgress).toBe(1);
			expect(stats.successRate).toBe(50);
		});

		it('should handle empty operations', () => {
			const stats = getDownloadStats();

			expect(stats.total).toBe(0);
			expect(stats.successRate).toBe(0);
			expect(stats.avgDurationMs).toBe(0);
		});
	});

	describe('downloadLogger standalone functions', () => {
		it('should log without throwing', () => {
			expect(() => {
				downloadLogger.error('Test error', { uploadId: 'test' });
				downloadLogger.warn('Test warning', { uploadId: 'test' });
				downloadLogger.info('Test info', { uploadId: 'test' });
				downloadLogger.debug('Test debug', { uploadId: 'test' });
				downloadLogger.trace('Test trace', { uploadId: 'test' });
			}).not.toThrow();
		});
	});

	describe('operation summary', () => {
		it('should return accurate summary', () => {
			const logger = createDownloadOperationLogger('summary-test', {
				trackId: 999,
				quality: 'HI_RES_LOSSLESS',
				artistName: 'Artist',
				trackTitle: 'Title'
			});

			logger.startPhase('init');
			logger.chunkProgress(0, 10, 0, 100000);
			logger.chunkProgress(5, 10, 50000, 100000);
			logger.complete();

			const summary = logger.getSummary();

			expect(summary.uploadId).toBe('summary-test');
			expect(summary.trackId).toBe(999);
			expect(summary.quality).toBe('HI_RES_LOSSLESS');
			expect(summary.status).toBe('completed');
			expect(summary.events.length).toBeGreaterThan(0);
		});
	});
});
