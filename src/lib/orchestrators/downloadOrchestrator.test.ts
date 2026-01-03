/**
 * Download Orchestrator Unit Tests
 *
 * Tests auto-conversion workflow, store interaction, error handling, and retry functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DownloadOrchestrator } from './downloadOrchestrator';
import type { Track, SonglinkTrack, PlayableTrack } from '$lib/types';

// Mock stores
const mockDownloadUiStore = {
	beginTrackDownload: vi.fn(),
	updateTrackProgress: vi.fn(),
	updateTrackStage: vi.fn(),
	completeTrackDownload: vi.fn(),
	errorTrackDownload: vi.fn(),
	cancelTrackDownload: vi.fn()
};

const mockUserPreferencesStore = {
	subscribe: vi.fn(),
	convertAacToMp3: true,
	downloadCoversSeperately: false
};

// Mock services
const mockDownloadService = vi.fn();
const mockConvertSonglinkTrackToTidal = vi.fn();

// Mock modules
vi.mock('$lib/stores/downloadUi', () => ({
	downloadUiStore: mockDownloadUiStore
}));

vi.mock('$lib/stores/userPreferences', () => ({
	userPreferencesStore: mockUserPreferencesStore
}));

vi.mock('svelte/store', () => ({
	get: vi.fn((store) => store)
}));

vi.mock('$lib/services/playback/downloadService', () => ({
	downloadTrack: mockDownloadService,
	buildDownloadFilename: vi.fn(() => 'test-track.flac')
}));

vi.mock('$lib/services/playback/trackConversionService', () => ({
	convertSonglinkTrackToTidal: mockConvertSonglinkTrackToTidal
}));

vi.mock('$lib/types', () => ({
	isSonglinkTrack: vi.fn((track) => 'artistName' in track)
}));

describe('DownloadOrchestrator', () => {
	let orchestrator: DownloadOrchestrator;

	const mockTrack: Track = {
		id: 123,
		title: 'Test Track',
		duration: 180,
		trackNumber: 1,
		volumeNumber: 1,
		explicit: false,
		isrc: 'TEST123',
		audioQuality: 'LOSSLESS',
		audioModes: ['STEREO'],
		allowStreaming: true,
		streamReady: true,
		streamStartDate: '2020-01-01',
		premiumStreamingOnly: false,
		replayGain: -6.5,
		peak: 0.95,
		artist: { id: 1, name: 'Test Artist', url: '', picture: '' },
		artists: [{ id: 1, name: 'Test Artist', url: '', picture: '' }],
		album: { id: 1, title: 'Test Album', cover: '', releaseDate: '2020-01-01', numberOfTracks: 10, numberOfVolumes: 1, duration: 1800 }
	};

	const mockSonglinkTrack: SonglinkTrack = {
		id: 'sl-123',
		title: 'Test Songlink Track',
		artistName: 'Test Artist',
		albumName: 'Test Album',
		duration: 180,
		url: 'https://song.link/test'
	};

	beforeEach(() => {
		orchestrator = new DownloadOrchestrator();
		vi.clearAllMocks();

		// Default mock behavior
		mockDownloadUiStore.beginTrackDownload.mockReturnValue({
			taskId: 'task-123',
			controller: new AbortController()
		});
	});

	afterEach(() => {
		orchestrator.clearAttempts();
	});

	describe('downloadTrack()', () => {
		it('should download a regular track successfully', async () => {
			mockDownloadService.mockResolvedValue({
				success: true,
				filename: 'test-track.flac'
			});

			const result = await orchestrator.downloadTrack(mockTrack);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.filename).toBe('test-track.flac');
				expect(result.taskId).toBe('task-123');
			}

			expect(mockDownloadUiStore.beginTrackDownload).toHaveBeenCalledWith(
				mockTrack,
				'test-track.flac',
				expect.objectContaining({ subtitle: '' })
			);

			expect(mockDownloadService).toHaveBeenCalledWith(
				mockTrack,
				expect.objectContaining({
					quality: 'LOSSLESS',
					callbacks: expect.any(Object)
				})
			);
		});

		it('should auto-convert Songlink track when autoConvertSonglink is true', async () => {
			const convertedTrack = { ...mockTrack, id: 456 };

			mockConvertSonglinkTrackToTidal.mockResolvedValue({
				success: true,
				track: convertedTrack
			});

			mockDownloadService.mockResolvedValue({
				success: true,
				filename: 'converted-track.flac'
			});

			const result = await orchestrator.downloadTrack(mockSonglinkTrack, {
				autoConvertSonglink: true
			});

			expect(mockConvertSonglinkTrackToTidal).toHaveBeenCalledWith(mockSonglinkTrack);
			expect(result.success).toBe(true);

			// Verify converted track was used for download
			expect(mockDownloadUiStore.beginTrackDownload).toHaveBeenCalledWith(
				convertedTrack,
				'test-track.flac',
				expect.any(Object)
			);
		});

		it('should fail when Songlink conversion fails', async () => {
			mockConvertSonglinkTrackToTidal.mockResolvedValue({
				success: false,
				error: {
					code: 'NOT_FOUND_ON_TIDAL',
					retry: false,
					message: 'Track not found on TIDAL'
				}
			});

			const result = await orchestrator.downloadTrack(mockSonglinkTrack, {
				autoConvertSonglink: true
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe('CONVERSION_FAILED');
				expect(result.error.message).toContain('Auto-conversion failed');
			}

			expect(mockDownloadService).not.toHaveBeenCalled();
		});

		it('should return error when autoConvertSonglink is false for Songlink track', async () => {
			const result = await orchestrator.downloadTrack(mockSonglinkTrack, {
				autoConvertSonglink: false
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe('SONGLINK_NOT_SUPPORTED');
				expect(result.error.canConvert).toBe(true);
			}

			expect(mockConvertSonglinkTrackToTidal).not.toHaveBeenCalled();
			expect(mockDownloadService).not.toHaveBeenCalled();
		});

		it('should wire callbacks to downloadUiStore', async () => {
			let onProgressCallback: any;
			let onCompleteCallback: any;
			let onErrorCallback: any;

			mockDownloadService.mockImplementation(async (track, options) => {
				onProgressCallback = options.callbacks?.onProgress;
				onCompleteCallback = options.callbacks?.onComplete;
				onErrorCallback = options.callbacks?.onError;

				// Simulate progress
				onProgressCallback?.({ stage: 'downloading', receivedBytes: 500, totalBytes: 1000 });
				onProgressCallback?.({ stage: 'embedding', progress: 'Adding metadata...' });

				// Simulate completion
				onCompleteCallback?.('test-track.flac');

				return { success: true, filename: 'test-track.flac' };
			});

			await orchestrator.downloadTrack(mockTrack);

			expect(mockDownloadUiStore.updateTrackProgress).toHaveBeenCalledWith('task-123', 500, 1000);
			expect(mockDownloadUiStore.updateTrackStage).toHaveBeenCalledWith('task-123', 'Adding metadata...');
			expect(mockDownloadUiStore.completeTrackDownload).toHaveBeenCalledWith('task-123');
		});

		it('should handle download service errors', async () => {
			mockDownloadService.mockResolvedValue({
				success: false,
				error: {
					code: 'NETWORK_ERROR',
					retry: true,
					message: 'Download failed: Network error'
				}
			});

			const result = await orchestrator.downloadTrack(mockTrack);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe('NETWORK_ERROR');
				expect(result.taskId).toBe('task-123');
			}
		});

		it('should store download attempt for retry', async () => {
			mockDownloadService.mockResolvedValue({
				success: false,
				error: { code: 'NETWORK_ERROR', retry: true, message: 'Failed' }
			});

			const result = await orchestrator.downloadTrack(mockTrack, {
				quality: 'HI_RES'
			});

			if (!result.success && result.taskId) {
				const retryResult = await orchestrator.retryDownload(result.taskId);

				// Should use stored options
				expect(mockDownloadService).toHaveBeenCalledTimes(2);
				expect(mockDownloadService).toHaveBeenLastCalledWith(
					mockTrack,
					expect.objectContaining({ quality: 'HI_RES' })
				);
			}
		});
	});

	describe('retryDownload()', () => {
		it('should retry using stored attempt', async () => {
			mockDownloadService.mockResolvedValue({
				success: false,
				error: { code: 'NETWORK_ERROR', retry: true, message: 'Failed' }
			});

			const firstResult = await orchestrator.downloadTrack(mockTrack);

			if (!firstResult.success && firstResult.taskId) {
				mockDownloadService.mockResolvedValue({
					success: true,
					filename: 'test-track.flac'
				});

				const retryResult = await orchestrator.retryDownload(firstResult.taskId);

				expect(retryResult.success).toBe(true);
				expect(mockDownloadService).toHaveBeenCalledTimes(2);
			}
		});

		it('should fail when attempt not found', async () => {
			const result = await orchestrator.retryDownload('non-existent-task');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe('UNKNOWN_ERROR');
				expect(result.error.message).toContain('not found');
			}
		});
	});

	describe('cancelDownload()', () => {
		it('should call downloadUiStore.cancelTrackDownload', () => {
			orchestrator.cancelDownload('task-123');

			expect(mockDownloadUiStore.cancelTrackDownload).toHaveBeenCalledWith('task-123');
		});
	});

	describe('notification modes', () => {
		const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

		afterEach(() => {
			alertSpy.mockClear();
		});

		it('should show alert on error when notificationMode is "alert"', async () => {
			mockConvertSonglinkTrackToTidal.mockResolvedValue({
				success: false,
				error: { code: 'NOT_FOUND_ON_TIDAL', retry: false, message: 'Not found' }
			});

			await orchestrator.downloadTrack(mockSonglinkTrack, {
				autoConvertSonglink: true,
				notificationMode: 'alert'
			});

			expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Not found'));
		});

		it('should not show alert when notificationMode is "silent"', async () => {
			mockConvertSonglinkTrackToTidal.mockResolvedValue({
				success: false,
				error: { code: 'NOT_FOUND_ON_TIDAL', retry: false, message: 'Not found' }
			});

			await orchestrator.downloadTrack(mockSonglinkTrack, {
				autoConvertSonglink: true,
				notificationMode: 'silent'
			});

			expect(alertSpy).not.toHaveBeenCalled();
		});
	});

	describe('attempt pruning', () => {
		it('should prune old attempts when exceeding MAX_STORED_ATTEMPTS', async () => {
			mockDownloadService.mockResolvedValue({
				success: false,
				error: { code: 'NETWORK_ERROR', retry: true, message: 'Failed' }
			});

			// Create 55 attempts (exceeds MAX of 50)
			const taskIds: string[] = [];
			for (let i = 0; i < 55; i++) {
				mockDownloadUiStore.beginTrackDownload.mockReturnValue({
					taskId: `task-${i}`,
					controller: new AbortController()
				});

				const result = await orchestrator.downloadTrack(mockTrack);
				if (!result.success && result.taskId) {
					taskIds.push(result.taskId);
				}
			}

			// Oldest 25% should be pruned (13-14 tasks)
			// Try to retry the oldest task
			const oldestRetry = await orchestrator.retryDownload(taskIds[0]);

			// Should fail because it was pruned
			expect(oldestRetry.success).toBe(false);

			// Recent tasks should still be available
			const recentRetry = await orchestrator.retryDownload(taskIds[taskIds.length - 1]);
			expect(mockDownloadService).toHaveBeenCalled();
		});
	});
});
