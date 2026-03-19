import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchCatalogPlaylist } from '$lib/server/catalogBoundary';

export const GET: RequestHandler = async ({ params }) => {
	const playlistId = params.id?.trim();
	if (!playlistId) {
		return json({ error: 'Invalid playlist id' }, { status: 400 });
	}

	try {
		const payload = await fetchCatalogPlaylist(playlistId);
		return json(payload);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch playlist';
		return json({ error: message }, { status: 500 });
	}
};
