import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	pendingUploads,
	chunkUploads,
	activeUploads,
	startUpload,
	endUpload,
	cleanupExpiredUploads,
	forceCleanupAllUploads
} from '../routes/api/download-track/_shared';

// Mock saveState to prevent Redis/file I/O timeouts
vi.mock('../routes/api/download-track/_shared', async () => {
	const actual = await vi.importActual('../routes/api/download-track/_shared');
	return {
		...actual,
		saveState: vi.fn().mockResolvedValue(undefined)
	};
});

describe('Upload Queue Management', () => {
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

	describe('Upload Lifecycle', () => {
		it('should properly clean up completed uploads from all tracking structures', () => {
			const uploadId = 'test-upload-123';

			// Start an upload
			startUpload(uploadId);
			expect(activeUploads.has(uploadId)).toBe(true);

			// Add to pending uploads
			pendingUploads.set(uploadId, {
				trackId: 123,
				quality: 'LOSSLESS',
				albumTitle: 'Test Album',
				artistName: 'Test Artist',
				trackTitle: 'Test Track',
				timestamp: Date.now(),
				totalSize: 1000000
			});

			expect(pendingUploads.has(uploadId)).toBe(true);
			expect(activeUploads.has(uploadId)).toBe(true);

			// End the upload
			endUpload(uploadId);

			// Verify complete cleanup
			expect(activeUploads.has(uploadId)).toBe(false);
			expect(pendingUploads.has(uploadId)).toBe(false);
		});

		it.skip('should handle expired upload cleanup', async () => {
			const uploadId = 'expired-upload-123';

			// Add an expired upload
			const UPLOAD_TTL = 5 * 60 * 1000; // 5 minutes
			const expiredTimestamp = Date.now() - UPLOAD_TTL - 1000; // Definitely expired
			pendingUploads.set(uploadId, {
				trackId: 123,
				quality: 'LOSSLESS',
				albumTitle: 'Test Album',
				artistName: 'Test Artist',
				trackTitle: 'Test Track',
				timestamp: expiredTimestamp,
				totalSize: 1000000
			});
			activeUploads.add(uploadId);

			expect(pendingUploads.has(uploadId)).toBe(true);
			expect(activeUploads.has(uploadId)).toBe(true);

			// Run cleanup
			await cleanupExpiredUploads();

			// Verify cleanup
			expect(pendingUploads.has(uploadId)).toBe(false);
			expect(activeUploads.has(uploadId)).toBe(false);
		});

		it.skip('should force cleanup all uploads', async () => {
			const uploadId1 = 'upload-1';
			const uploadId2 = 'upload-2';

			// Add multiple uploads
			startUpload(uploadId1);
			startUpload(uploadId2);

			pendingUploads.set(uploadId1, {
				trackId: 123,
				quality: 'LOSSLESS',
				albumTitle: 'Test Album',
				artistName: 'Test Artist',
				trackTitle: 'Test Track',
				timestamp: Date.now(),
				totalSize: 1000000
			});

			pendingUploads.set(uploadId2, {
				trackId: 456,
				quality: 'LOSSLESS',
				albumTitle: 'Test Album 2',
				artistName: 'Test Artist 2',
				trackTitle: 'Test Track 2',
				timestamp: Date.now(),
				totalSize: 2000000
			});

			expect(activeUploads.size).toBe(2);
			expect(pendingUploads.size).toBe(2);

			// Force cleanup
			const result = await forceCleanupAllUploads();

			expect(result.cleaned).toBe(2);
			expect(activeUploads.size).toBe(0);
			expect(pendingUploads.size).toBe(0);
		});
	});

	describe('Queue State Validation', () => {
		it('should maintain consistent queue state', () => {
			const uploadId = 'consistent-upload-123';

			// Start upload
			startUpload(uploadId);
			expect(activeUploads.has(uploadId)).toBe(true);
			expect(activeUploads.size).toBe(1);

			// End upload
			endUpload(uploadId);
			expect(activeUploads.has(uploadId)).toBe(false);
			expect(activeUploads.size).toBe(0);

			// Verify no orphaned entries
			expect(pendingUploads.has(uploadId)).toBe(false);
		});

		it('should handle concurrent upload operations', () => {
			const uploadId1 = 'concurrent-1';
			const uploadId2 = 'concurrent-2';

			// Start multiple uploads
			startUpload(uploadId1);
			startUpload(uploadId2);

			expect(activeUploads.size).toBe(2);
			expect(activeUploads.has(uploadId1)).toBe(true);
			expect(activeUploads.has(uploadId2)).toBe(true);

			// End one upload
			endUpload(uploadId1);

			expect(activeUploads.size).toBe(1);
			expect(activeUploads.has(uploadId1)).toBe(false);
			expect(activeUploads.has(uploadId2)).toBe(true);

			// End the other
			endUpload(uploadId2);

			expect(activeUploads.size).toBe(0);
		});
	});
});
