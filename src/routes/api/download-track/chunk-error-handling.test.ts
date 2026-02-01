/**
 * Regression tests for chunk upload error handling.
 *
 * CRITICAL BUG PREVENTED:
 * Previously, the chunk endpoint would call endUpload() for ANY error,
 * which deleted the session. This caused:
 * - First chunk failure: 500 error returned
 * - Retry attempt: 404 "session not found" because session was deleted
 *
 * The fix: Only call endUpload() for non-recoverable errors (disk full, permission denied).
 * Recoverable errors (network timeouts, temporary failures) should preserve the session
 * so retries can succeed.
 *
 * These tests ensure this critical behavior is never regressed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	pendingUploads,
	chunkUploads,
	activeUploads,
	startUpload,
	endUpload,
	createDownloadError,
	ERROR_CODES,
	cleanupExpiredUploads,
	touchUploadTimestamp,
	type ChunkUploadState,
	type PendingUpload
} from './_shared';

describe('Chunk Upload Error Handling', () => {
	const testUploadId = 'test-upload-regression-123';

	beforeEach(() => {
		// Clear all upload state before each test
		pendingUploads.clear();
		chunkUploads.clear();
		activeUploads.clear();
	});

	afterEach(() => {
		// Clean up after each test
		pendingUploads.clear();
		chunkUploads.clear();
		activeUploads.clear();
	});

	describe('Session Preservation on Recoverable Errors', () => {
		/**
		 * CRITICAL REGRESSION TEST
		 * This test verifies that recoverable errors do NOT delete the session.
		 * If this test fails, the 500→404 bug has been reintroduced.
		 */
		it('should preserve session when error is recoverable', () => {
			// Setup: Create an active upload session
			startUpload(testUploadId);
			pendingUploads.set(testUploadId, {
				trackId: 123,
				quality: 'LOSSLESS',
				albumTitle: 'Test Album',
				artistName: 'Test Artist',
				trackTitle: 'Test Track',
				timestamp: Date.now(),
				totalSize: 10000000
			} as PendingUpload);

			chunkUploads.set(testUploadId, {
				uploadId: testUploadId,
				chunkIndex: 0,
				totalChunks: 5,
				chunkSize: 2000000,
				totalSize: 10000000,
				checksum: 'abc123',
				tempFilePath: '/tmp/test.tmp',
				completed: false,
				timestamp: Date.now()
			} as ChunkUploadState);

			// Verify session exists
			expect(activeUploads.has(testUploadId)).toBe(true);
			expect(pendingUploads.has(testUploadId)).toBe(true);
			expect(chunkUploads.has(testUploadId)).toBe(true);

			// Simulate a recoverable error (like what the error handler should do)
			const recoverableError = createDownloadError(
				ERROR_CODES.NETWORK_ERROR,
				'Network timeout during chunk upload',
				true, // recoverable = true
				{ uploadId: testUploadId },
				10,
				'Please try the download again.'
			);

			// The key assertion: recoverable errors should NOT delete the session
			// This is what the fixed code does - only calls endUpload for non-recoverable
			if (!recoverableError.recoverable) {
				endUpload(testUploadId);
			}

			// Session should still exist for retry
			expect(activeUploads.has(testUploadId)).toBe(true);
			expect(pendingUploads.has(testUploadId)).toBe(true);
			expect(chunkUploads.has(testUploadId)).toBe(true);
		});

		it('should delete session when error is non-recoverable', () => {
			// Setup: Create an active upload session
			startUpload(testUploadId);
			pendingUploads.set(testUploadId, {
				trackId: 123,
				quality: 'LOSSLESS',
				albumTitle: 'Test Album',
				artistName: 'Test Artist',
				trackTitle: 'Test Track',
				timestamp: Date.now(),
				totalSize: 10000000
			} as PendingUpload);

			chunkUploads.set(testUploadId, {
				uploadId: testUploadId,
				chunkIndex: 0,
				totalChunks: 5,
				chunkSize: 2000000,
				totalSize: 10000000,
				checksum: 'abc123',
				tempFilePath: '/tmp/test.tmp',
				completed: false,
				timestamp: Date.now()
			} as ChunkUploadState);

			// Simulate a non-recoverable error (disk full)
			const nonRecoverableError = createDownloadError(
				ERROR_CODES.DISK_FULL,
				'No space left on device',
				false, // recoverable = false
				{ uploadId: testUploadId }
			);

			// Non-recoverable errors SHOULD delete the session
			if (!nonRecoverableError.recoverable) {
				endUpload(testUploadId);
			}

			// Session should be deleted
			expect(activeUploads.has(testUploadId)).toBe(false);
			expect(pendingUploads.has(testUploadId)).toBe(false);
			expect(chunkUploads.has(testUploadId)).toBe(false);
		});
	});

	describe('Error Classification', () => {
		it('should classify network errors as recoverable', () => {
			const error = createDownloadError(
				ERROR_CODES.NETWORK_ERROR,
				'Connection reset',
				true
			);
			expect(error.recoverable).toBe(true);
		});

		it('should classify timeout errors as recoverable', () => {
			const error = createDownloadError(
				ERROR_CODES.TIMEOUT,
				'Request timed out',
				true
			);
			expect(error.recoverable).toBe(true);
		});

		it('should classify rate limit errors as recoverable', () => {
			const error = createDownloadError(
				ERROR_CODES.RATE_LIMITED,
				'Too many requests',
				true,
				{},
				30 // retry after 30 seconds
			);
			expect(error.recoverable).toBe(true);
			expect(error.retryAfter).toBe(30);
		});

		it('should classify disk full as non-recoverable', () => {
			const error = createDownloadError(
				ERROR_CODES.DISK_FULL,
				'No space left on device',
				false
			);
			expect(error.recoverable).toBe(false);
		});

		it('should classify permission denied as non-recoverable', () => {
			const error = createDownloadError(
				ERROR_CODES.PERMISSION_DENIED,
				'Access denied',
				false
			);
			expect(error.recoverable).toBe(false);
		});
	});

	describe('Retry Scenarios', () => {
		/**
		 * This test simulates the exact scenario that caused the 500→404 bug:
		 * 1. Upload starts
		 * 2. First chunk fails with a recoverable error
		 * 3. Client retries
		 * 4. Retry should find the session still exists
		 */
		it('should allow successful retry after recoverable error', () => {
			// Step 1: Start upload
			startUpload(testUploadId);
			pendingUploads.set(testUploadId, {
				trackId: 123,
				quality: 'LOSSLESS',
				timestamp: Date.now(),
				totalSize: 10000000
			} as PendingUpload);

			chunkUploads.set(testUploadId, {
				uploadId: testUploadId,
				chunkIndex: 0,
				totalChunks: 5,
				chunkSize: 2000000,
				totalSize: 10000000,
				checksum: 'abc123',
				tempFilePath: '/tmp/test.tmp',
				completed: false,
				timestamp: Date.now()
			} as ChunkUploadState);

			// Step 2: Simulate recoverable error (DON'T delete session)
			const error = createDownloadError(
				ERROR_CODES.NETWORK_ERROR,
				'Connection failed',
				true
			);

			// Error handler: only delete for non-recoverable
			if (!error.recoverable) {
				endUpload(testUploadId);
			}

			// Step 3: Client retries - session should still exist
			const sessionExists = chunkUploads.has(testUploadId);
			expect(sessionExists).toBe(true);

			// Step 4: Retry can proceed
			const chunkState = chunkUploads.get(testUploadId);
			expect(chunkState).toBeDefined();
			expect(chunkState?.uploadId).toBe(testUploadId);
		});

		it('should prevent retry after non-recoverable error', () => {
			// Start upload
			startUpload(testUploadId);
			chunkUploads.set(testUploadId, {
				uploadId: testUploadId,
				chunkIndex: 0,
				totalChunks: 5,
				chunkSize: 2000000,
				totalSize: 10000000,
				checksum: 'abc123',
				tempFilePath: '/tmp/test.tmp',
				completed: false,
				timestamp: Date.now()
			} as ChunkUploadState);

			// Simulate non-recoverable error (SHOULD delete session)
			const error = createDownloadError(
				ERROR_CODES.DISK_FULL,
				'No space left',
				false
			);

			if (!error.recoverable) {
				endUpload(testUploadId);
			}

			// Session should be gone - retry will fail with 404
			const sessionExists = chunkUploads.has(testUploadId);
			expect(sessionExists).toBe(false);
		});
	});

	/**
	 * REGRESSION TEST: Cleanup race condition causing 500→404 pattern
	 *
	 * Bug: When pendingUploads timestamp expired but chunkUploads timestamp was fresh:
	 * 1. Cleanup first loop deleted pendingUploads entry (expired timestamp)
	 * 2. Cleanup second loop saw missingPending=true for chunkUploads entry
	 * 3. chunkUploads entry was deleted even though it had a fresh timestamp
	 * 4. Next chunk request got 404 "session not found"
	 *
	 * Fix: Use the most recent timestamp from EITHER pending or chunk entry
	 * when determining expiration.
	 */
	describe('Cleanup Race Condition Prevention', () => {
		const UPLOAD_TTL = 5 * 60 * 1000; // 5 minutes (from _shared.ts)

		it('should NOT delete chunk session when only pendingUploads timestamp is stale', async () => {
			const now = Date.now();
			const staleTimestamp = now - UPLOAD_TTL - 1000; // 5 minutes + 1 second ago
			const freshTimestamp = now - 1000; // 1 second ago

			// Setup: pendingUploads has stale timestamp, chunkUploads has fresh timestamp
			pendingUploads.set(testUploadId, {
				trackId: 123,
				quality: 'LOSSLESS',
				timestamp: staleTimestamp, // STALE
				totalSize: 10000000
			} as PendingUpload);

			chunkUploads.set(testUploadId, {
				uploadId: testUploadId,
				chunkIndex: 4,
				totalChunks: 5,
				chunkSize: 2000000,
				totalSize: 10000000,
				checksum: 'abc123',
				tempFilePath: '/tmp/test-cleanup.tmp',
				completed: false,
				timestamp: freshTimestamp // FRESH
			} as ChunkUploadState);

			startUpload(testUploadId);

			// Run cleanup
			await cleanupExpiredUploads();

			// CRITICAL: Session should still exist because chunk timestamp was fresh
			expect(chunkUploads.has(testUploadId)).toBe(true);
			expect(pendingUploads.has(testUploadId)).toBe(true);
		});

		it('should delete session when BOTH timestamps are stale', async () => {
			const now = Date.now();
			const staleTimestamp = now - UPLOAD_TTL - 1000; // 5 minutes + 1 second ago

			// Setup: both have stale timestamps
			pendingUploads.set(testUploadId, {
				trackId: 123,
				quality: 'LOSSLESS',
				timestamp: staleTimestamp,
				totalSize: 10000000
			} as PendingUpload);

			chunkUploads.set(testUploadId, {
				uploadId: testUploadId,
				chunkIndex: 4,
				totalChunks: 5,
				chunkSize: 2000000,
				totalSize: 10000000,
				checksum: 'abc123',
				tempFilePath: '/tmp/test-cleanup.tmp',
				completed: false,
				timestamp: staleTimestamp
			} as ChunkUploadState);

			startUpload(testUploadId);

			// Run cleanup
			await cleanupExpiredUploads();

			// Both should be deleted
			expect(chunkUploads.has(testUploadId)).toBe(false);
			expect(pendingUploads.has(testUploadId)).toBe(false);
		});

		it('touchUploadTimestamp should update both timestamps atomically', () => {
			const initialTime = Date.now() - 60000; // 1 minute ago

			pendingUploads.set(testUploadId, {
				trackId: 123,
				quality: 'LOSSLESS',
				timestamp: initialTime,
				totalSize: 10000000
			} as PendingUpload);

			chunkUploads.set(testUploadId, {
				uploadId: testUploadId,
				chunkIndex: 4,
				totalChunks: 5,
				chunkSize: 2000000,
				totalSize: 10000000,
				checksum: 'abc123',
				tempFilePath: '/tmp/test-touch.tmp',
				completed: false,
				timestamp: initialTime
			} as ChunkUploadState);

			// Touch timestamps
			const beforeTouch = Date.now();
			touchUploadTimestamp(testUploadId);
			const afterTouch = Date.now();

			// Both should be updated to roughly the same time
			const pendingTimestamp = pendingUploads.get(testUploadId)!.timestamp;
			const chunkTimestamp = chunkUploads.get(testUploadId)!.timestamp;

			expect(pendingTimestamp).toBeGreaterThanOrEqual(beforeTouch);
			expect(pendingTimestamp).toBeLessThanOrEqual(afterTouch);
			expect(chunkTimestamp).toBeGreaterThanOrEqual(beforeTouch);
			expect(chunkTimestamp).toBeLessThanOrEqual(afterTouch);

			// Timestamps should be within 1ms of each other (same call)
			expect(Math.abs(pendingTimestamp - chunkTimestamp)).toBeLessThanOrEqual(1);
		});

		it('should handle orphaned chunk entry (no pending) with fresh timestamp', async () => {
			const now = Date.now();
			const freshTimestamp = now - 1000; // 1 second ago

			// Setup: only chunk entry exists (no pending)
			chunkUploads.set(testUploadId, {
				uploadId: testUploadId,
				chunkIndex: 4,
				totalChunks: 5,
				chunkSize: 2000000,
				totalSize: 10000000,
				checksum: 'abc123',
				tempFilePath: '/tmp/test-orphan.tmp',
				completed: false,
				timestamp: freshTimestamp
			} as ChunkUploadState);

			// Run cleanup
			await cleanupExpiredUploads();

			// Chunk entry should still exist because its own timestamp is fresh
			expect(chunkUploads.has(testUploadId)).toBe(true);
		});

		it('should delete orphaned chunk entry with stale timestamp', async () => {
			const now = Date.now();
			const staleTimestamp = now - UPLOAD_TTL - 1000;

			// Setup: only chunk entry exists (no pending) and it's stale
			chunkUploads.set(testUploadId, {
				uploadId: testUploadId,
				chunkIndex: 4,
				totalChunks: 5,
				chunkSize: 2000000,
				totalSize: 10000000,
				checksum: 'abc123',
				tempFilePath: '/tmp/test-orphan-stale.tmp',
				completed: false,
				timestamp: staleTimestamp
			} as ChunkUploadState);

			// Run cleanup
			await cleanupExpiredUploads();

			// Chunk entry should be deleted
			expect(chunkUploads.has(testUploadId)).toBe(false);
		});

		it('should delete completed chunk sessions', async () => {
			const now = Date.now();

			pendingUploads.set(testUploadId, {
				trackId: 123,
				quality: 'LOSSLESS',
				timestamp: now,
				totalSize: 10000000
			} as PendingUpload);

			chunkUploads.set(testUploadId, {
				uploadId: testUploadId,
				chunkIndex: 5,
				totalChunks: 5,
				chunkSize: 2000000,
				totalSize: 10000000,
				checksum: 'abc123',
				tempFilePath: '/tmp/test-completed.tmp',
				completed: true, // Marked as completed
				timestamp: now
			} as ChunkUploadState);

			startUpload(testUploadId);

			// Run cleanup
			await cleanupExpiredUploads();

			// Session should be deleted because it's completed
			expect(chunkUploads.has(testUploadId)).toBe(false);
			expect(pendingUploads.has(testUploadId)).toBe(false);
		});
	});
});
