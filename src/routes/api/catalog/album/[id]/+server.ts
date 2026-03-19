import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchCatalogAlbum } from '$lib/server/catalogBoundary';

export const GET: RequestHandler = async ({ params, request }) => {
	const albumId = Number(params.id);
	if (!Number.isFinite(albumId) || albumId <= 0) {
		return json({ error: 'Invalid album id' }, { status: 400 });
	}

	try {
		const payload = await fetchCatalogAlbum(albumId, request.signal);
		return json(payload);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch album';
		return json({ error: message }, { status: 500 });
	}
};
