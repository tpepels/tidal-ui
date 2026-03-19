import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchCatalogArtistRecommendations } from '$lib/server/catalogBoundary';

export const GET: RequestHandler = async ({ params, request }) => {
	const artistId = Number(params.id);
	if (!Number.isFinite(artistId) || artistId <= 0) {
		return json({ error: 'Invalid artist id' }, { status: 400 });
	}

	try {
		const payload = await fetchCatalogArtistRecommendations(artistId, request.signal);
		return json(payload);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch artist recommendations';
		return json({ error: message }, { status: 500 });
	}
};
