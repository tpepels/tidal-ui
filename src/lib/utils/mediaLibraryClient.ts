export type AlbumLibraryStatusInput = {
	id: number;
	artistName?: string;
	albumTitle?: string;
	expectedTrackCount?: number;
};

export type AlbumLibraryStatusMap = Record<number, { exists: boolean; matchedTracks: number }>;

export async function fetchAlbumLibraryStatus(
	albums: AlbumLibraryStatusInput[]
): Promise<AlbumLibraryStatusMap> {
	if (!Array.isArray(albums) || albums.length === 0) {
		return {};
	}

	try {
		const response = await fetch('/api/media-library/status', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ albums })
		});
		if (!response.ok) {
			return {};
		}
		const payload = (await response.json()) as {
			success?: boolean;
			albums?: AlbumLibraryStatusMap;
		};
		if (!payload.success || !payload.albums) {
			return {};
		}
		return payload.albums;
	} catch {
		return {};
	}
}
