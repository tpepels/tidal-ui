import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createAlbumQueueController,
	createDefaultAlbumDownloadState,
	reconcileAlbumQueueJobState,
	resolveAlbumQueueProgress,
	type AlbumDownloadState
} from './albumQueueController';

describe('albumQueueController', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('resolves queue progress with clamped completed count', () => {
		const progress = resolveAlbumQueueProgress(
			{ total: 8, completed: 2 },
			{ progress: 0.95, completedTracks: 12 }
		);

		expect(progress).toEqual({ total: 8, completed: 8 });
	});

	it('marks completed queue jobs as terminal and clears queueJobId', () => {
		const current: AlbumDownloadState = {
			...createDefaultAlbumDownloadState(10),
			status: 'processing',
			downloading: true,
			queueJobId: 'job-1'
		};

		const next = reconcileAlbumQueueJobState(current, {
			status: 'completed',
			trackCount: 10,
			completedTracks: 10
		});

		expect(next.terminal).toBe(true);
		expect(next.patch).toMatchObject({
			status: 'completed',
			downloading: false,
			total: 10,
			completed: 10,
			queueJobId: null
		});
	});

	it('polls queue jobs through processing -> completed and stops polling', async () => {
		const states: Record<number, AlbumDownloadState> = {
			7: {
				...createDefaultAlbumDownloadState(10),
				status: 'queued',
				queueJobId: 'job-7'
			}
		};
		const fetchQueueJob = vi
			.fn()
			.mockResolvedValueOnce({
				success: true,
				job: { status: 'processing', trackCount: 10, completedTracks: 3 }
			})
			.mockResolvedValueOnce({
				success: true,
				job: { status: 'completed', trackCount: 10, completedTracks: 10 }
			});

		const controller = createAlbumQueueController({
			getState: (albumId) => states[albumId] ?? createDefaultAlbumDownloadState(),
			patchState: (albumId, patch) => {
				states[albumId] = {
					...(states[albumId] ?? createDefaultAlbumDownloadState()),
					...patch
				};
			},
			fetchQueueJob,
			pollIntervalMs: 1000
		});

		controller.startPolling(7, 'job-7');
		await vi.advanceTimersByTimeAsync(0);
		expect(states[7]?.status).toBe('processing');
		expect(states[7]?.completed).toBe(3);

		await vi.advanceTimersByTimeAsync(1000);
		expect(states[7]?.status).toBe('completed');
		expect(states[7]?.queueJobId).toBeNull();

		await vi.advanceTimersByTimeAsync(4000);
		expect(fetchQueueJob).toHaveBeenCalledTimes(2);
	});

	it('cancels active queue downloads', async () => {
		const states: Record<number, AlbumDownloadState> = {
			9: {
				...createDefaultAlbumDownloadState(12),
				status: 'processing',
				downloading: true,
				queueJobId: 'job-9'
			}
		};
		const sendQueueAction = vi.fn().mockResolvedValue({ success: true });

		const controller = createAlbumQueueController({
			getState: (albumId) => states[albumId] ?? createDefaultAlbumDownloadState(),
			patchState: (albumId, patch) => {
				states[albumId] = {
					...(states[albumId] ?? createDefaultAlbumDownloadState()),
					...patch
				};
			},
			sendQueueAction
		});

		const result = await controller.cancelQueueDownload(9);

		expect(result.success).toBe(true);
		expect(sendQueueAction).toHaveBeenCalledWith('job-9', 'cancel');
		expect(states[9]).toMatchObject({
			status: 'cancelled',
			downloading: false,
			queueJobId: null
		});
	});

	it('returns action errors from resume requests', async () => {
		const states: Record<number, AlbumDownloadState> = {
			4: {
				...createDefaultAlbumDownloadState(6),
				status: 'paused',
				queueJobId: 'job-4'
			}
		};
		const sendQueueAction = vi.fn().mockResolvedValue({
			success: false,
			error: 'Unable to resume'
		});

		const controller = createAlbumQueueController({
			getState: (albumId) => states[albumId] ?? createDefaultAlbumDownloadState(),
			patchState: (albumId, patch) => {
				states[albumId] = {
					...(states[albumId] ?? createDefaultAlbumDownloadState()),
					...patch
				};
			},
			sendQueueAction
		});

		const result = await controller.resumeQueueDownload(4);

		expect(result).toEqual({ success: false, error: 'Unable to resume' });
		expect(states[4]?.status).toBe('paused');
	});
});
