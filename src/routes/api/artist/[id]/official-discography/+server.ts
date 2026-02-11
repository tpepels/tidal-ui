import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	fetchOfficialArtistAlbums,
	isTidalOfficialApiConfigured
} from '$lib/server/tidalOfficialCatalog';

export const GET: RequestHandler = async ({ params }) => {
	const artistId = Number(params.id);
	if (!Number.isFinite(artistId) || artistId <= 0) {
		return json({ error: 'Invalid artist id' }, { status: 400 });
	}
	console.info(`[TidalOpenApi] Artist ${artistId}: official discography request`);

	if (!isTidalOfficialApiConfigured()) {
		console.warn(`[TidalOpenApi] Artist ${artistId}: disabled (missing credentials)`);
		return json({
			enabled: false,
			albums: [],
			reason: 'Missing TIDAL API credentials'
		});
	}

	try {
		const albums = await fetchOfficialArtistAlbums(artistId);
		console.info(`[TidalOpenApi] Artist ${artistId}: fetched ${albums.length} official album(s)`);
		return json({
			enabled: true,
			albums,
			count: albums.length
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch official discography';
		console.warn(`[TidalOpenApi] Failed to enrich artist ${artistId}: ${message}`);
		return json(
			{
				enabled: true,
				albums: [],
				error: message
			},
			{ status: 502 }
		);
	}
};
