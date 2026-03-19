import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { losslessAPI } from '$lib/api';
import type { AudioQuality } from '$lib/types';

export const GET: RequestHandler = async ({ params, url }) => {
	const trackId = Number(params.id);
	const quality = (url.searchParams.get('quality')?.trim() ?? 'LOSSLESS') as AudioQuality;
	if (!Number.isFinite(trackId) || trackId <= 0) {
		return json({ error: 'Invalid track id' }, { status: 400 });
	}

	try {
		const payload = await losslessAPI.getTrack(trackId, quality);
		return json(payload);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch track';
		return json({ error: message }, { status: 500 });
	}
};
