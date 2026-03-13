import { describe, expect, it, vi } from 'vitest';
import {
	createArtistAlbumQueueController,
	createDefaultArtistAlbumDownloadState,
	isArtistAlbumQueueDownloadCancellable,
	reconcileArtistAlbumQueueJobState,
	resolveArtistAlbumQueueProgress,
	type ArtistAlbumDownloadState
} from './artistAlbumQueueController';

describe('artistAlbumQueueController', () => {
	it('clamps queue progress to track totals', () => {
		expect(
			resolveArtistAlbumQueueProgress(
				{ total: 8, completed: 2 },
				{ trackCount: 8, completedTracks: 20, progress: 1.9 }
			)
		).toEqual({ total: 8, completed: 8 });
	});

	it('marks completed jobs as terminal with queue cleanup patch', () => {
		const state: ArtistAlbumDownloadState = {
			...createDefaultArtistAlbumDownloadState(10),
			status: 'processing',
			downloading: true,
			queueJobId: 'job-1'
		};

		const next = reconcileArtistAlbumQueueJobState(state, {
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

	it('polls queued jobs and reconciles to completed state', async () => {
		vi.useFakeTimers();
		const stateByAlbum = new Map<number, ArtistAlbumDownloadState>();
		const getState = (albumId: number) =>
			stateByAlbum.get(albumId) ?? createDefaultArtistAlbumDownloadState();
		const patchState = vi.fn((albumId: number, patch: Partial<ArtistAlbumDownloadState>) => {
			const previous = getState(albumId);
			stateByAlbum.set(albumId, { ...previous, ...patch });
		});
		const fetchQueueJob = vi
			.fn()
			.mockResolvedValueOnce({
				success: true,
				job: { status: 'processing', trackCount: 12, completedTracks: 3 }
			})
			.mockResolvedValueOnce({
				success: true,
				job: { status: 'completed', trackCount: 12, completedTracks: 12 }
			});

		const controller = createArtistAlbumQueueController({
			getState,
			patchState,
			fetchQueueJob,
			pollIntervalMs: 5
		});

		stateByAlbum.set(42, {
			...createDefaultArtistAlbumDownloadState(12),
			status: 'queued',
			queueJobId: 'job-42'
		});

		controller.startPolling(42, 'job-42');
		await vi.runAllTimersAsync();

		expect(fetchQueueJob).toHaveBeenCalled();
		expect(getState(42).status).toBe('completed');
		expect(getState(42).queueJobId).toBeNull();

		controller.stopAllPolling();
		vi.useRealTimers();
	});

	it('cancels queue downloads when state is cancellable', async () => {
		const stateByAlbum = new Map<number, ArtistAlbumDownloadState>();
		stateByAlbum.set(9, {
			...createDefaultArtistAlbumDownloadState(9),
			status: 'queued',
			queueJobId: 'job-9'
		});

		const sendQueueAction = vi.fn().mockResolvedValue({ success: true });
		const controller = createArtistAlbumQueueController({
			getState: (albumId) => stateByAlbum.get(albumId) ?? createDefaultArtistAlbumDownloadState(),
			patchState: (albumId, patch) => {
				const previous = stateByAlbum.get(albumId) ?? createDefaultArtistAlbumDownloadState();
				stateByAlbum.set(albumId, { ...previous, ...patch });
			},
			sendQueueAction
		});

		const result = await controller.cancelQueueDownload(9);

		expect(result).toEqual({ success: true });
		expect(sendQueueAction).toHaveBeenCalledWith('job-9', 'cancel');
		expect(stateByAlbum.get(9)?.status).toBe('cancelled');
	});

	it('returns send errors for resume failures', async () => {
		const stateByAlbum = new Map<number, ArtistAlbumDownloadState>();
		stateByAlbum.set(5, {
			...createDefaultArtistAlbumDownloadState(5),
			status: 'paused',
			queueJobId: 'job-5'
		});

		const sendQueueAction = vi
			.fn()
			.mockResolvedValue({ success: false, error: 'resume blocked by server' });
		const controller = createArtistAlbumQueueController({
			getState: (albumId) => stateByAlbum.get(albumId) ?? createDefaultArtistAlbumDownloadState(),
			patchState: () => undefined,
			sendQueueAction
		});

		const result = await controller.resumeQueueDownload(5);

		expect(result).toEqual({ success: false, error: 'resume blocked by server' });
	});

	it('detects cancellable statuses via shared queue helper', () => {
		expect(
			isArtistAlbumQueueDownloadCancellable({
				...createDefaultArtistAlbumDownloadState(),
				status: 'queued'
			})
		).toBe(true);
		expect(
			isArtistAlbumQueueDownloadCancellable({
				...createDefaultArtistAlbumDownloadState(),
				status: 'idle'
			})
		).toBe(false);
	});
});
