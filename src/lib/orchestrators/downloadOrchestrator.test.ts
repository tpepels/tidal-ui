/**
 * Download Orchestrator Unit Tests
 *
 * Tests auto-conversion workflow, store interaction, error handling, and retry functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DownloadOrchestrator } from './downloadOrchestrator';
import type { Track, SonglinkTrack, PlayableTrack } from '$lib/types';

const {
	mockDownloadUiStore,
	mockUserPreferencesStore,
	mockDownloadPreferencesStore,
	mockDownloadLogStore,
	mockDownloadService,
	mockConvertSonglinkTrackToTidal,
	mockLosslessDownloadTrack,
	mockDownloadTrackToServer,
	mockToasts,
	mockTrackError
} = vi.hoisted(() => ({
	mockDownloadUiStore: {
		beginTrackDownload: vi.fn(),
		updateTrackProgress: vi.fn(),
		updateTrackStage: vi.fn(),
		updateTrackPhase: vi.fn(),
		completeTrackDownload: vi.fn(),
		errorTrackDownload: vi.fn(),
		cancelTrackDownload: vi.fn(),
		startFfmpegCountdown: vi.fn(),
		startFfmpegLoading: vi.fn(),
		updateFfmpegProgress: vi.fn(),
		completeFfmpeg: vi.fn(),
		errorFfmpeg: vi.fn(),
		skipFfmpegCountdown: vi.fn()
	},
	mockUserPreferencesStore: {
		subscribe: vi.fn(),
		convertAacToMp3: true,
		downloadCoversSeperately: false
	},
	mockDownloadPreferencesStore: {
		subscribe: vi.fn(),
		storage: 'client'
	},
	mockDownloadLogStore: {
		error: vi.fn(),
		success: vi.fn()
	},
	mockDownloadService: vi.fn(),
	mockConvertSonglinkTrackToTidal: vi.fn(),
	mockLosslessDownloadTrack: vi.fn(),
	mockDownloadTrackToServer: vi.fn(),
	mockToasts: {
		error: vi.fn(),
		success: vi.fn()
	},
	mockTrackError: vi.fn()
}));

// Mock modules
vi.mock('$lib/stores/downloadUi', () => ({
	downloadUiStore: mockDownloadUiStore
}));

vi.mock('$lib/stores/userPreferences', () => ({
	userPreferencesStore: mockUserPreferencesStore
}));

vi.mock('$lib/stores/downloadPreferences', () => ({
	downloadPreferencesStore: mockDownloadPreferencesStore
}));

vi.mock('$lib/stores/downloadLog', () => ({
	downloadLogStore: mockDownloadLogStore
}));

vi.mock('svelte/store', async (importOriginal) => {
	const actual = await importOriginal<typeof import('svelte/store')>();
	return {
		...actual,
		get: vi.fn((store) => store)
	};
});

vi.mock('$lib/services/playback/downloadService', () => ({
	downloadTrack: mockDownloadService,
	buildDownloadFilename: vi.fn(() => 'test-track.flac')
}));

vi.mock('$lib/services/playback/trackConversionService', () => ({
	convertSonglinkTrackToTidal: mockConvertSonglinkTrackToTidal
}));

vi.mock('$lib/api', () => ({
	losslessAPI: {
		downloadTrack: (...args: unknown[]) => mockLosslessDownloadTrack(...args)
	}
}));

vi.mock('$lib/downloads', () => ({
	downloadTrackToServer: (...args: unknown[]) => mockDownloadTrackToServer(...args)
}));

vi.mock('$lib/stores/toasts', () => ({
	toasts: mockToasts
}));

vi.mock('$lib/core/errorTracker', () => ({
	trackError: (...args: unknown[]) => mockTrackError(...args)
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
		version: null,
		popularity: 0,
		editable: false,
		trackNumber: 1,
		volumeNumber: 1,
		explicit: false,
		isrc: 'TEST123',
		url: 'https://example.com',
		audioQuality: 'LOSSLESS',
		audioModes: ['STEREO'],
		allowStreaming: true,
		streamReady: true,
		streamStartDate: '2020-01-01',
		premiumStreamingOnly: false,
		replayGain: -6.5,
		peak: 0.95,
		artist: { id: 1, name: 'Test Artist', type: 'MAIN', url: '', picture: '' },
		artists: [{ id: 1, name: 'Test Artist', type: 'MAIN', url: '', picture: '' }],
		album: {
			id: 1,
			title: 'Test Album',
			cover: '',
			videoCover: null,
			releaseDate: '2020-01-01',
			numberOfTracks: 10,
			numberOfVolumes: 1,
			duration: 1800
		}
	};

	const mockSonglinkTrack: SonglinkTrack = {
		id: 'spotify:track:sl-123',
		title: 'Test Songlink Track',
		artistName: 'Test Artist',
		duration: 180,
		thumbnailUrl: 'https://song.link/test.jpg',
		sourceUrl: 'https://song.link/test',
		songlinkData: {
			entityUniqueId: 'sl-123',
			userCountry: 'US',
			pageUrl: 'https://song.link/test',
			entitiesByUniqueId: {},
			linksByPlatform: {}
		},
		isSonglinkTrack: true,
		audioQuality: 'LOSSLESS'
	};

	beforeEach(() => {
		orchestrator = new DownloadOrchestrator();
		vi.clearAllMocks();
		mockDownloadPreferencesStore.storage = 'client';

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
			mockLosslessDownloadTrack.mockResolvedValue(undefined);

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

			expect(mockLosslessDownloadTrack).toHaveBeenCalledWith(
				mockTrack.id,
				'LOSSLESS',
				'test-track.flac',
				expect.objectContaining({
					signal: expect.any(AbortSignal),
					onProgress: expect.any(Function)
				})
			);
		});

		it('routes downloads to the server when storage is server', async () => {
			mockDownloadPreferencesStore.storage = 'server';
			mockDownloadTrackToServer.mockResolvedValue({
				success: true,
				filename: 'test-track.flac',
				message: 'Saved to server'
			});

			const result = await orchestrator.downloadTrack(mockTrack);

			expect(result.success).toBe(true);
			expect(mockDownloadTrackToServer).toHaveBeenCalledWith(
				mockTrack,
				'LOSSLESS',
				expect.objectContaining({
					downloadCoverSeperately: false,
					conflictResolution: 'overwrite_if_different'
				})
			);
			expect(mockLosslessDownloadTrack).not.toHaveBeenCalled();
		});

		it('should auto-convert Songlink track when autoConvertSonglink is true', async () => {
			const convertedTrack = { ...mockTrack, id: 456 };

			mockConvertSonglinkTrackToTidal.mockResolvedValue({
				success: true,
				track: convertedTrack
			});

			mockLosslessDownloadTrack.mockResolvedValue(undefined);

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

			expect(mockLosslessDownloadTrack).not.toHaveBeenCalled();
		});

		it('should return error when autoConvertSonglink is false for Songlink track', async () => {
			const result = await orchestrator.downloadTrack(mockSonglinkTrack, {
				autoConvertSonglink: false
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe('SONGLINK_NOT_SUPPORTED');
				if ('canConvert' in result.error) {
					expect(result.error.canConvert).toBe(true);
				}
			}

			expect(mockConvertSonglinkTrackToTidal).not.toHaveBeenCalled();
			expect(mockLosslessDownloadTrack).not.toHaveBeenCalled();
		});

		it('should wire callbacks to downloadUiStore', async () => {
			let onProgressCallback: any;
			let onCompleteCallback: any;
			let onErrorCallback: any;

			mockLosslessDownloadTrack.mockImplementation(async (_trackId, _quality, _filename, options) => {
				onProgressCallback = options.onProgress;
				onCompleteCallback = options.onFfmpegComplete;
				onErrorCallback = options.onFfmpegError;

				onProgressCallback?.({ stage: 'downloading', receivedBytes: 500, totalBytes: 1000 });
				onProgressCallback?.({ stage: 'embedding', progress: 0.4 });
				onCompleteCallback?.();

				return undefined;
			});

			await orchestrator.downloadTrack(mockTrack);

			expect(mockDownloadUiStore.updateTrackProgress).toHaveBeenCalledWith('task-123', 500, 1000);
			expect(mockDownloadUiStore.updateTrackStage).toHaveBeenCalledWith('task-123', 0.4);
			expect(mockDownloadUiStore.completeTrackDownload).toHaveBeenCalledWith('task-123');
		});

		it('should handle download service errors', async () => {
			mockLosslessDownloadTrack.mockRejectedValue(new Error('Download failed: Network error'));

			const result = await orchestrator.downloadTrack(mockTrack);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe('UNKNOWN_ERROR');
				expect(result.taskId).toBe('task-123');
			}
		});

		it('should store download attempt for retry', async () => {
			mockLosslessDownloadTrack.mockRejectedValue(new Error('Failed'));

			const result = await orchestrator.downloadTrack(mockTrack, {
				quality: 'HI_RES_LOSSLESS'
			});

			if (!result.success && result.taskId) {
				const retryResult = await orchestrator.retryDownload(result.taskId);

				// Should use stored options
				expect(mockLosslessDownloadTrack).toHaveBeenCalledTimes(2);
				expect(mockLosslessDownloadTrack).toHaveBeenLastCalledWith(
					mockTrack.id,
					'HI_RES_LOSSLESS',
					'test-track.flac',
					expect.any(Object)
				);
			}
		});
	});

	describe('retryDownload()', () => {
		it('should retry using stored attempt', async () => {
			mockLosslessDownloadTrack.mockRejectedValue(new Error('Failed'));

			const firstResult = await orchestrator.downloadTrack(mockTrack);

			if (!firstResult.success && firstResult.taskId) {
				mockLosslessDownloadTrack.mockResolvedValueOnce(undefined);

				const retryResult = await orchestrator.retryDownload(firstResult.taskId);

				expect(retryResult.success).toBe(true);
				expect(mockLosslessDownloadTrack).toHaveBeenCalledTimes(2);
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
		it('should show alert on error when notificationMode is "alert"', async () => {
			mockConvertSonglinkTrackToTidal.mockResolvedValue({
				success: false,
				error: { code: 'NOT_FOUND_ON_TIDAL', retry: false, message: 'Not found' }
			});

			await orchestrator.downloadTrack(mockSonglinkTrack, {
				autoConvertSonglink: true,
				notificationMode: 'alert'
			});

			expect(mockToasts.error).toHaveBeenCalledWith(expect.stringContaining('Not found'));
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

			expect(mockToasts.error).not.toHaveBeenCalled();
		});
	});

	describe('attempt pruning', () => {
		it('should prune old attempts when exceeding MAX_STORED_ATTEMPTS', async () => {
			mockLosslessDownloadTrack.mockRejectedValue(new Error('Failed'));

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
			expect(mockLosslessDownloadTrack).toHaveBeenCalled();
		});
	});
});
