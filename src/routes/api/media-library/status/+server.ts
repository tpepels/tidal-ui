import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { batchAlbumLibraryStatus, scanLocalMediaLibrary } from '$lib/server/mediaLibrary';

type AlbumStatusRequest = {
	id: number;
	artistName?: string;
	albumTitle?: string;
	expectedTrackCount?: number;
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as {
			albums?: AlbumStatusRequest[];
			force?: boolean;
		};
		const albums = Array.isArray(body.albums) ? body.albums : [];

		if (albums.length === 0) {
			const snapshot = await scanLocalMediaLibrary({ force: body.force === true });
			return json({
				success: true,
				albums: {},
				totalFiles: snapshot.files.length,
				scannedAt: snapshot.scannedAt
			});
		}

		const statuses = await batchAlbumLibraryStatus(
			albums.map((album) => ({
				id: album.id,
				artistName: album.artistName,
				albumTitle: album.albumTitle,
				expectedTrackCount: album.expectedTrackCount
			}))
		);

		return json({
			success: true,
			albums: statuses
		});
	} catch (error) {
		console.error('[Media Library API] status error:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to read media library status'
			},
			{ status: 500 }
		);
	}
};
