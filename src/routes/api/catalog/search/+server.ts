import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RegionOption } from '$lib/stores/region';
import { searchCatalog } from '$lib/server/catalogBoundary';

export const GET: RequestHandler = async ({ url }) => {
	const typeParam = url.searchParams.get('type');
	const query = url.searchParams.get('q')?.trim() ?? '';
	const region = (url.searchParams.get('region')?.trim() ?? 'auto') as RegionOption;
	const artistQuery = url.searchParams.get('artistQuery')?.trim() ?? undefined;

	if (!typeParam || !['tracks', 'albums', 'artists', 'playlists'].includes(typeParam)) {
		return json({ error: 'Invalid catalog search type' }, { status: 400 });
	}

	if (!query) {
		return json({ error: 'Search query is required' }, { status: 400 });
	}

	try {
		const payload = await searchCatalog(typeParam as 'tracks' | 'albums' | 'artists' | 'playlists', query, {
			region,
			artistQuery
		});
		return json(payload);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to search catalog';
		return json({ error: message }, { status: 500 });
	}
};
