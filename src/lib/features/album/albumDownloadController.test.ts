import { describe, expect, it, vi } from 'vitest';
import {
	buildAlbumRepairMessage,
	buildAlbumRepairTrackInputs,
	createAlbumDownloadController,
	type AlbumRouteDownloadPreferences,
	type AlbumRouteMaintenanceState,
	type AlbumRouteQueueState
} from './albumDownloadController';
import type { Album, Track } from '$lib/types';

function createAlbum(id: number, title: string, trackCount = 2): Album {
	return {
		id,
		title,
		numberOfTracks: trackCount,
		cover: 'cover-id',
		videoCover: null,
		artist: { id: id * 10, name: `Artist ${id}`, type: 'ARTIST' }
	};
}

function createTrack(id: number, title: string, trackNumber = 1, version?: string): Track {
	return {
		id,
		title,
		trackNumber,
		duration: 200,
		version: version ?? '',
		artists: []
	} as unknown as Track;
}

function createPreferences(
	overrides?: Partial<AlbumRouteDownloadPreferences>
): AlbumRouteDownloadPreferences {
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

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

describe('albumDownloadController', () => {
	it('queues server downloads and keeps queue state aligned', async () => {
		let album: Album | null = createAlbum(9, 'Queue Me', 2);
		const tracks = [createTrack(91, 'One', 1), createTrack(92, 'Two', 2)];
		let queueState: AlbumRouteQueueState = {
			queueStatus: 'idle',
			queueJobId: null,
			queueCompletedTracks: 0,
			queueTotalTracks: 0,
			isDownloadingAll: false,
			downloadedCount: 0,
			downloadError: null
		};
		let maintenanceState: AlbumRouteMaintenanceState = {
			isRepairingAlbum: false,
			repairMessage: null
		};
		const downloadAlbumFn = vi.fn().mockResolvedValue({
			storage: 'server',
			totalTracks: 2,
			completedTracks: 0,
			failedTracks: 0,
			jobId: 'job-9'
		});

		const controller = createAlbumDownloadController({
			getAlbum: () => album,
			getTracks: () => tracks,
			getCurrentAlbumId: () => album?.id ?? null,
			getQueueState: () => queueState,
			patchQueueState: (patch) => {
				queueState = { ...queueState, ...patch };
			},
			getMaintenanceState: () => maintenanceState,
			patchMaintenanceState: (patch) => {
				maintenanceState = { ...maintenanceState, ...patch };
			},
			isAlbumInLibrary: () => false,
			isMusicBrainzReleaseLookupLoading: () => false,
			getSelectedMusicBrainzReleaseId: () => '',
			getDownloadPreferences: () => createPreferences(),
			confirmServerOverwrite: () => true,
			confirmClientRedownload: () => true,
			confirmProceedWithoutMusicBrainz: () => true,
			downloadAlbumFn,
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						success: true,
						job: { status: 'queued', trackCount: 2, completedTracks: 0 }
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				)
		});

		await controller.handleDownloadAll();

		expect(downloadAlbumFn).toHaveBeenCalledTimes(1);
		expect(queueState).toMatchObject({
			queueStatus: 'queued',
			queueJobId: 'job-9',
			queueTotalTracks: 2,
			isDownloadingAll: false
		});
		controller.destroy();
	});

	it('refreshes album library state when a queued server download completes', async () => {
		vi.useFakeTimers();
		try {
			let album: Album | null = createAlbum(11, 'Fresh Library', 2);
			const tracks = [createTrack(111, 'One', 1), createTrack(112, 'Two', 2)];
			let queueState: AlbumRouteQueueState = {
				queueStatus: 'idle',
				queueJobId: null,
				queueCompletedTracks: 0,
				queueTotalTracks: 0,
				isDownloadingAll: false,
				downloadedCount: 0,
				downloadError: null
			};
			let maintenanceState: AlbumRouteMaintenanceState = {
				isRepairingAlbum: false,
				repairMessage: null
			};
			const refreshAlbumLibraryState = vi.fn(async () => {});
			let pollCount = 0;

			const controller = createAlbumDownloadController({
				getAlbum: () => album,
				getTracks: () => tracks,
				getCurrentAlbumId: () => album?.id ?? null,
				getQueueState: () => queueState,
				patchQueueState: (patch) => {
					queueState = { ...queueState, ...patch };
				},
				getMaintenanceState: () => maintenanceState,
				patchMaintenanceState: (patch) => {
					maintenanceState = { ...maintenanceState, ...patch };
				},
				isAlbumInLibrary: () => false,
				isMusicBrainzReleaseLookupLoading: () => false,
				getSelectedMusicBrainzReleaseId: () => '',
				getDownloadPreferences: () => createPreferences(),
				confirmServerOverwrite: () => true,
				confirmClientRedownload: () => true,
				confirmProceedWithoutMusicBrainz: () => true,
				refreshAlbumLibraryState,
				downloadAlbumFn: vi.fn().mockResolvedValue({
					storage: 'server',
					totalTracks: 2,
					completedTracks: 0,
					failedTracks: 0,
					jobId: 'job-11'
				}),
				fetchImpl: async () => {
					pollCount += 1;
					const status = pollCount >= 2 ? 'completed' : 'queued';
					const completedTracks = pollCount >= 2 ? 2 : 0;
					return new Response(
						JSON.stringify({
							success: true,
							job: { status, trackCount: 2, completedTracks }
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } }
					);
				}
			});

			await controller.handleDownloadAll();
			await Promise.resolve();
			expect(queueState.queueStatus).toBe('queued');

			await vi.advanceTimersByTimeAsync(1000);

			expect(queueState).toMatchObject({
				queueStatus: 'completed',
				queueJobId: null,
				queueCompletedTracks: 2,
				queueTotalTracks: 2,
				isDownloadingAll: false
			});
			expect(refreshAlbumLibraryState).toHaveBeenCalledWith({ force: true });
			controller.destroy();
		} finally {
			vi.useRealTimers();
		}
	});

	it('ignores stale client download completion after reset', async () => {
		let album: Album | null = createAlbum(10, 'Stale Me', 2);
		const tracks = [createTrack(101, 'One', 1), createTrack(102, 'Two', 2)];
		let queueState: AlbumRouteQueueState = {
			queueStatus: 'idle',
			queueJobId: null,
			queueCompletedTracks: 0,
			queueTotalTracks: 0,
			isDownloadingAll: false,
			downloadedCount: 0,
			downloadError: null
		};
		let maintenanceState: AlbumRouteMaintenanceState = {
			isRepairingAlbum: false,
			repairMessage: null
		};
		const downloadResult = createDeferred<{
			storage: 'client';
			totalTracks: number;
			completedTracks: number;
			failedTracks: number;
		}>();

		const controller = createAlbumDownloadController({
			getAlbum: () => album,
			getTracks: () => tracks,
			getCurrentAlbumId: () => album?.id ?? null,
			getQueueState: () => queueState,
			patchQueueState: (patch) => {
				queueState = { ...queueState, ...patch };
			},
			getMaintenanceState: () => maintenanceState,
			patchMaintenanceState: (patch) => {
				maintenanceState = { ...maintenanceState, ...patch };
			},
			isAlbumInLibrary: () => false,
			isMusicBrainzReleaseLookupLoading: () => false,
			getSelectedMusicBrainzReleaseId: () => '',
			getDownloadPreferences: () => createPreferences({ storage: 'client' }),
			confirmServerOverwrite: () => true,
			confirmClientRedownload: () => true,
			confirmProceedWithoutMusicBrainz: () => true,
			downloadAlbumFn: vi.fn(() => downloadResult.promise)
		});

		const pendingDownload = controller.handleDownloadAll();
		controller.reset();
		downloadResult.resolve({
			storage: 'client',
			totalTracks: 2,
			completedTracks: 2,
			failedTracks: 0
		});
		await pendingDownload;

		expect(queueState).toEqual({
			queueStatus: 'idle',
			queueJobId: null,
			queueCompletedTracks: 0,
			queueTotalTracks: 0,
			isDownloadingAll: false,
			downloadedCount: 0,
			downloadError: null
		});
	});

	it('refreshes album library state after a successful repair scan', async () => {
		let album: Album | null = createAlbum(12, 'Repair Me', 2);
		const tracks = [createTrack(121, 'One', 1), createTrack(122, 'Two', 2)];
		let queueState: AlbumRouteQueueState = {
			queueStatus: 'idle',
			queueJobId: null,
			queueCompletedTracks: 0,
			queueTotalTracks: 0,
			isDownloadingAll: false,
			downloadedCount: 0,
			downloadError: null
		};
		let maintenanceState: AlbumRouteMaintenanceState = {
			isRepairingAlbum: false,
			repairMessage: null
		};
		const refreshAlbumLibraryState = vi.fn(async () => {});

		const controller = createAlbumDownloadController({
			getAlbum: () => album,
			getTracks: () => tracks,
			getCurrentAlbumId: () => album?.id ?? null,
			getQueueState: () => queueState,
			patchQueueState: (patch) => {
				queueState = { ...queueState, ...patch };
			},
			getMaintenanceState: () => maintenanceState,
			patchMaintenanceState: (patch) => {
				maintenanceState = { ...maintenanceState, ...patch };
			},
			isAlbumInLibrary: () => true,
			isMusicBrainzReleaseLookupLoading: () => false,
			getSelectedMusicBrainzReleaseId: () => '',
			getDownloadPreferences: () => createPreferences(),
			confirmServerOverwrite: () => true,
			confirmClientRedownload: () => true,
			confirmProceedWithoutMusicBrainz: () => true,
			refreshAlbumLibraryState,
			repairAlbumInLibraryFn: vi.fn().mockResolvedValue({
				success: true,
				summary: {
					expected: 2,
					healthy: 2,
					missing: 0,
					corrupt: 0,
					repairNeeded: 0,
					queued: 0
				}
			})
		});

		await controller.handleRepairAlbum();

		expect(maintenanceState.isRepairingAlbum).toBe(false);
		expect(refreshAlbumLibraryState).toHaveBeenCalledWith({ force: true });
		controller.destroy();
	});

	it('builds repair payloads and success messages consistently', () => {
		expect(
			buildAlbumRepairTrackInputs([
				createTrack(1, 'Song', 1, 'Live'),
				createTrack(2, 'Other', 2)
			])
		).toEqual([
			{
				trackId: 1,
				trackTitle: 'Song (Live)',
				trackNumber: 1,
				durationSeconds: 200
			},
			{
				trackId: 2,
				trackTitle: 'Other',
				trackNumber: 2,
				durationSeconds: 200
			}
		]);
		expect(
			buildAlbumRepairMessage({
				expected: 2,
				healthy: 1,
				missing: 0,
				corrupt: 1,
				repairNeeded: 1,
				queued: 1
			})
		).toBe('Queued 1 repair download(s): 1 corrupt file(s) targeted.');
	});
});
