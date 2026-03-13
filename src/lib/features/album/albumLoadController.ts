import { fetchAlbumLibraryStatus, type AlbumLibraryStatusMap } from '$lib/utils/mediaLibraryClient';
import type { Album, Track } from '$lib/types';

export type AlbumLoadResult = {
	album: Album;
	tracks: Track[];
	albumInLibrary: boolean;
	albumLibraryTrackCount: number;
};

type AlbumFetchResult = {
	album: Album;
	tracks: Track[];
};

type LoadAlbumFn = (
	albumId: number,
	options: {
		signal: AbortSignal;
	}
) => Promise<AlbumFetchResult>;

type AlbumLoadControllerOptions = {
	loadAlbumFn: LoadAlbumFn;
	fetchAlbumLibraryStatusFn?: typeof fetchAlbumLibraryStatus;
	onAlbumChange?: (albumId: number) => void;
	onLoadStart?: () => void;
	onLoadSuccess: (result: AlbumLoadResult) => void;
	onLoadError?: (message: string, cause: unknown) => void;
	onInvalidAlbumId?: () => void;
	onLoadSettled?: () => void;
};

type AlbumContextSideEffects = {
	album: Album;
	setViewingAlbum: (album: Album) => void;
	setArtistBreadcrumbLabel: (path: string, label: string) => void;
	setBreadcrumbParent: (path: string, parentPath: string) => void;
	setCurrentBreadcrumbLabel: (label: string, path: string) => void;
	recordAlbumVisit: (entry: {
		id: number;
		title: string;
		artistName?: string;
		cover?: string;
	}) => void;
	upsertArtistAlbumCover: (artistId: number, albumId: number, coverId: string) => void;
	upsertAlbumCoverGlobally: (albumId: number, coverId: string) => void;
};

function parsePositiveAlbumId(rawAlbumId: string | null | undefined): number | null {
	const parsedAlbumId = Number.parseInt(rawAlbumId ?? '', 10);
	if (!Number.isFinite(parsedAlbumId) || parsedAlbumId <= 0) {
		return null;
	}
	return parsedAlbumId;
}

function resolveAlbumLibraryState(
	libraryStatusMap: AlbumLibraryStatusMap,
	album: Album
): Pick<AlbumLoadResult, 'albumInLibrary' | 'albumLibraryTrackCount'> {
	const status = libraryStatusMap[album.id];
	return {
		albumInLibrary: status?.exists === true,
		albumLibraryTrackCount: status?.matchedTracks ?? 0
	};
}

export async function fetchAlbumLoadResult(options: {
	albumId: number;
	signal: AbortSignal;
	loadAlbumFn: LoadAlbumFn;
	fetchAlbumLibraryStatusFn?: typeof fetchAlbumLibraryStatus;
}): Promise<AlbumLoadResult> {
	const fetchAlbumLibraryStatusFn =
		options.fetchAlbumLibraryStatusFn ?? fetchAlbumLibraryStatus;
	const { album, tracks } = await options.loadAlbumFn(options.albumId, {
		signal: options.signal
	});
	const libraryStatusMap = await fetchAlbumLibraryStatusFn([
		{
			id: album.id,
			artistName: album.artist?.name,
			albumTitle: album.title,
			expectedTrackCount: tracks.length
		}
	]);
	return {
		album,
		tracks,
		...resolveAlbumLibraryState(libraryStatusMap, album)
	};
}

export function applyLoadedAlbumContext(options: AlbumContextSideEffects): void {
	options.setViewingAlbum(options.album);

	if (options.album.artist) {
		options.setArtistBreadcrumbLabel(
			`/artist/${options.album.artist.id}`,
			options.album.artist.name
		);
		options.setBreadcrumbParent(
			`/album/${options.album.id}`,
			`/artist/${options.album.artist.id}`
		);
	} else {
		options.setBreadcrumbParent(`/album/${options.album.id}`, '/');
	}
	options.setCurrentBreadcrumbLabel(options.album.title, `/album/${options.album.id}`);
	options.recordAlbumVisit({
		id: options.album.id,
		title: options.album.title,
		artistName: options.album.artist?.name,
		cover: options.album.cover
	});

	if (options.album.cover) {
		const artistId = options.album.artist?.id;
		if (typeof artistId === 'number' && Number.isFinite(artistId)) {
			options.upsertArtistAlbumCover(artistId, options.album.id, options.album.cover);
		}
		options.upsertAlbumCoverGlobally(options.album.id, options.album.cover);
	}
}

export function createAlbumLoadController(options: AlbumLoadControllerOptions) {
	let activeRequestToken = 0;
	let albumLoadAbortController: AbortController | null = null;
	let trackedAlbumId: number | null = null;

	function abortActiveRequest(): void {
		activeRequestToken += 1;
		albumLoadAbortController?.abort();
		albumLoadAbortController = null;
	}

	async function load(rawAlbumId: string | null | undefined): Promise<void> {
		const parsedAlbumId = parsePositiveAlbumId(rawAlbumId);
		if (parsedAlbumId === null) {
			trackedAlbumId = null;
			abortActiveRequest();
			options.onInvalidAlbumId?.();
			return;
		}

		if (trackedAlbumId !== parsedAlbumId) {
			trackedAlbumId = parsedAlbumId;
			options.onAlbumChange?.(parsedAlbumId);
		}

		const requestToken = ++activeRequestToken;
		albumLoadAbortController?.abort();
		const controller = new AbortController();
		albumLoadAbortController = controller;
		options.onLoadStart?.();

		try {
			const result = await fetchAlbumLoadResult({
				albumId: parsedAlbumId,
				signal: controller.signal,
				loadAlbumFn: options.loadAlbumFn,
				fetchAlbumLibraryStatusFn: options.fetchAlbumLibraryStatusFn
			});
			if (requestToken !== activeRequestToken) {
				return;
			}
			options.onLoadSuccess(result);
		} catch (error) {
			if (requestToken !== activeRequestToken) {
				return;
			}
			if (error instanceof Error && error.name === 'AbortError') {
				return;
			}
			const message = error instanceof Error ? error.message : 'Failed to load album';
			options.onLoadError?.(message, error);
		} finally {
			if (requestToken === activeRequestToken) {
				options.onLoadSettled?.();
			}
			if (albumLoadAbortController === controller) {
				albumLoadAbortController = null;
			}
		}
	}

	function destroy(): void {
		trackedAlbumId = null;
		abortActiveRequest();
	}

	return {
		load,
		destroy
	};
}
