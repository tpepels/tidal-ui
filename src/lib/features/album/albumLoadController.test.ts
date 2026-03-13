import { describe, expect, it, vi } from 'vitest';
import {
	createAlbumLoadController,
	fetchAlbumLoadResult
} from './albumLoadController';
import type { Album, Track } from '$lib/types';

function createAlbum(id: number, title: string, trackCount = 1): Album {
	return {
		id,
		title,
		numberOfTracks: trackCount,
		cover: 'cover-id',
		videoCover: null,
		artist: { id: id * 10, name: `Artist ${id}`, type: 'ARTIST' }
	};
}

function createTrack(id: number, title: string, trackNumber = 1): Track {
	return {
		id,
		title,
		trackNumber,
		duration: 180,
		artists: []
	} as unknown as Track;
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

describe('albumLoadController', () => {
	it('fetches album data together with library presence', async () => {
		const album = createAlbum(12, 'Album 12', 3);
		const tracks = [createTrack(1, 'One'), createTrack(2, 'Two'), createTrack(3, 'Three')];

		const result = await fetchAlbumLoadResult({
			albumId: 12,
			signal: new AbortController().signal,
			loadAlbumFn: async () => ({ album, tracks }),
			fetchAlbumLibraryStatusFn: async () => ({
				12: { exists: true, matchedTracks: 3 }
			})
		});

		expect(result).toEqual({
			album,
			tracks,
			albumInLibrary: true,
			albumLibraryTrackCount: 3
		});
	});

	it('ignores stale load completion when a newer request starts', async () => {
		const firstAlbum = createAlbum(1, 'First');
		const secondAlbum = createAlbum(2, 'Second');
		const firstLoad = createDeferred<{ album: Album; tracks: Track[] }>();
		const secondLoad = createDeferred<{ album: Album; tracks: Track[] }>();
		const loadAlbumFn = vi.fn((albumId: number) =>
			albumId === 1 ? firstLoad.promise : secondLoad.promise
		);
		const onLoadSuccess = vi.fn();
		const onAlbumChange = vi.fn();

		const controller = createAlbumLoadController({
			loadAlbumFn,
			fetchAlbumLibraryStatusFn: async (entries) => ({
				[entries[0]?.id ?? 0]: {
					exists: false,
					matchedTracks: 0
				}
			}),
			onAlbumChange,
			onLoadSuccess
		});

		const firstRun = controller.load('1');
		const secondRun = controller.load('2');

		firstLoad.resolve({
			album: firstAlbum,
			tracks: [createTrack(11, 'Stale')]
		});
		await Promise.resolve();

		secondLoad.resolve({
			album: secondAlbum,
			tracks: [createTrack(21, 'Fresh')]
		});

		await Promise.all([firstRun, secondRun]);

		expect(onAlbumChange).toHaveBeenNthCalledWith(1, 1);
		expect(onAlbumChange).toHaveBeenNthCalledWith(2, 2);
		expect(onLoadSuccess).toHaveBeenCalledTimes(1);
		expect(onLoadSuccess).toHaveBeenCalledWith(
			expect.objectContaining({
				album: secondAlbum
			})
		);
	});
});
