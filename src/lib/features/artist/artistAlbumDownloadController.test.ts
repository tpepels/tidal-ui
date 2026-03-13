import { describe, expect, it, vi } from 'vitest';
import {
	createDefaultArtistAlbumDownloadState,
	type ArtistAlbumDownloadState
} from './artistAlbumQueueController';
import {
	createArtistAlbumDownloadController,
	type ArtistAlbumDownloadPreferences
} from './artistAlbumDownloadController';
import type { Album } from '$lib/types';

function createAlbum(id: number, title: string, trackCount = 0): Album {
	return {
		id,
		title,
		cover: '',
		videoCover: null,
		numberOfTracks: trackCount
	};
}

function createPreferences(overrides?: Partial<ArtistAlbumDownloadPreferences>): ArtistAlbumDownloadPreferences {
	return {
		quality: 'LOSSLESS',
		mode: 'individual',
		convertAacToMp3: false,
		experimentalMusicBrainzTagging: true,
		strictMusicBrainzMatching: false,
		storage: 'server',
		...overrides
	};
}

describe('artistAlbumDownloadController', () => {
	it('queues server downloads and starts polling', async () => {
		const album = createAlbum(99, 'Queue Me', 9);
		const stateByAlbum = new Map<number, ArtistAlbumDownloadState>();
		const getAlbumDownloadState = (albumId: number) =>
			stateByAlbum.get(albumId) ?? createDefaultArtistAlbumDownloadState();
		const patchAlbumDownloadState = vi.fn((albumId: number, patch: Partial<ArtistAlbumDownloadState>) => {
			const previous = getAlbumDownloadState(albumId);
			stateByAlbum.set(albumId, { ...previous, ...patch });
		});
		const startQueuePolling = vi.fn();
		const downloadAlbumFn = vi.fn().mockResolvedValue({
			storage: 'server',
			totalTracks: 9,
			completedTracks: 0,
			failedTracks: 0,
			jobId: 'job-99'
		});

		const controller = createArtistAlbumDownloadController({
			getAlbumDownloadState,
			patchAlbumDownloadState,
			isAlbumQueueDownloadCancellable: () => false,
			requestQueueCancel: async () => ({ success: true }),
			requestQueueResume: async () => ({ success: true }),
			startQueuePolling,
			isDiscographyDownloading: () => false,
			setDiscographyDownloading: () => undefined,
			setDiscographyProgress: () => undefined,
			setDiscographyError: () => undefined,
			resolveAlbumInLibrary: () => false,
			confirmServerOverwrite: () => true,
			confirmClientRedownload: () => true,
			getDownloadPreferences: () => createPreferences(),
			resolveArtistName: () => 'Artist',
			downloadAlbumFn
		});

		await controller.handleAlbumDownload(album);

		expect(downloadAlbumFn).toHaveBeenCalledTimes(1);
		expect(startQueuePolling).toHaveBeenCalledWith(99, 'job-99');
		expect(stateByAlbum.get(99)).toMatchObject({
			status: 'queued',
			queueJobId: 'job-99',
			total: 9,
			downloading: false
		});
	});

	it('aborts download when overwrite confirmation is declined', async () => {
		const album = createAlbum(5, 'Already Local', 5);
		const stateByAlbum = new Map<number, ArtistAlbumDownloadState>();
		const getAlbumDownloadState = (albumId: number) =>
			stateByAlbum.get(albumId) ?? createDefaultArtistAlbumDownloadState();
		const patchAlbumDownloadState = vi.fn((albumId: number, patch: Partial<ArtistAlbumDownloadState>) => {
			const previous = getAlbumDownloadState(albumId);
			stateByAlbum.set(albumId, { ...previous, ...patch });
		});
		const downloadAlbumFn = vi.fn();

		const controller = createArtistAlbumDownloadController({
			getAlbumDownloadState,
			patchAlbumDownloadState,
			isAlbumQueueDownloadCancellable: () => false,
			requestQueueCancel: async () => ({ success: true }),
			requestQueueResume: async () => ({ success: true }),
			startQueuePolling: () => undefined,
			isDiscographyDownloading: () => false,
			setDiscographyDownloading: () => undefined,
			setDiscographyProgress: () => undefined,
			setDiscographyError: () => undefined,
			resolveAlbumInLibrary: () => true,
			confirmServerOverwrite: () => false,
			confirmClientRedownload: () => true,
			getDownloadPreferences: () => createPreferences({ storage: 'server' }),
			resolveArtistName: () => 'Artist',
			downloadAlbumFn
		});

		await controller.handleAlbumDownload(album);

		expect(downloadAlbumFn).not.toHaveBeenCalled();
		expect(patchAlbumDownloadState).not.toHaveBeenCalled();
	});

	it('surfaces queue cancel errors into album state', async () => {
		const stateByAlbum = new Map<number, ArtistAlbumDownloadState>();
		const getAlbumDownloadState = (albumId: number) =>
			stateByAlbum.get(albumId) ?? createDefaultArtistAlbumDownloadState();
		const patchAlbumDownloadState = vi.fn((albumId: number, patch: Partial<ArtistAlbumDownloadState>) => {
			const previous = getAlbumDownloadState(albumId);
			stateByAlbum.set(albumId, { ...previous, ...patch });
		});

		const controller = createArtistAlbumDownloadController({
			getAlbumDownloadState,
			patchAlbumDownloadState,
			isAlbumQueueDownloadCancellable: () => false,
			requestQueueCancel: async () => ({ success: false, error: 'cancel denied' }),
			requestQueueResume: async () => ({ success: true }),
			startQueuePolling: () => undefined,
			isDiscographyDownloading: () => false,
			setDiscographyDownloading: () => undefined,
			setDiscographyProgress: () => undefined,
			setDiscographyError: () => undefined,
			resolveAlbumInLibrary: () => false,
			confirmServerOverwrite: () => true,
			confirmClientRedownload: () => true,
			getDownloadPreferences: () => createPreferences(),
			resolveArtistName: () => 'Artist'
		});

		await controller.cancelAlbumQueueDownload(77);

		expect(stateByAlbum.get(77)?.error).toBe('cancel denied');
	});

	it('tracks discography progress and records partial failure errors', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const progressCalls: Array<{ completed: number; total: number }> = [];
		const downloadingCalls: boolean[] = [];
		const errorCalls: Array<string | null> = [];
		const firstAlbum = createAlbum(1, 'Part 1', 2);
		const secondAlbum = createAlbum(2, 'Part 2', 1);

		const downloadAlbumFn = vi.fn(async (album: Album, quality, callbacks) => {
			if (album.id === 1) {
				callbacks?.onTotalResolved?.(2);
				callbacks?.onTrackDownloaded?.(1, 2, {} as never);
				callbacks?.onTrackDownloaded?.(2, 2, {} as never);
				return {
					storage: 'client' as const,
					totalTracks: 2,
					completedTracks: 2,
					failedTracks: 0
				};
			}
			throw new Error('Failed to download part of the discography.');
		});

		const controller = createArtistAlbumDownloadController({
			getAlbumDownloadState: () => createDefaultArtistAlbumDownloadState(),
			patchAlbumDownloadState: () => undefined,
			isAlbumQueueDownloadCancellable: () => false,
			requestQueueCancel: async () => ({ success: true }),
			requestQueueResume: async () => ({ success: true }),
			startQueuePolling: () => undefined,
			isDiscographyDownloading: () => false,
			setDiscographyDownloading: (value) => {
				downloadingCalls.push(value);
			},
			setDiscographyProgress: (progress) => {
				progressCalls.push(progress);
			},
			setDiscographyError: (error) => {
				errorCalls.push(error);
			},
			resolveAlbumInLibrary: () => false,
			confirmServerOverwrite: () => true,
			confirmClientRedownload: () => true,
			getDownloadPreferences: () => createPreferences({ storage: 'client' }),
			resolveArtistName: () => 'Artist',
			downloadAlbumFn
		});

		await controller.handleDownloadDiscography([firstAlbum, secondAlbum]);

		expect(downloadAlbumFn).toHaveBeenCalledTimes(2);
		expect(downloadingCalls).toEqual([true, false]);
		expect(errorCalls.at(0)).toBeNull();
		expect(errorCalls.at(-1)).toBe('Failed to download part of the discography.');
		expect(progressCalls.some((progress) => progress.completed === 2)).toBe(true);
		consoleErrorSpy.mockRestore();
	});
});
