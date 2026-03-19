import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { losslessAPI } from '$lib/api';
import type { AudioQuality } from '$lib/types';

export const GET: RequestHandler = async ({ params, url }) => {
	const trackId = Number(params.id);
	const quality = (url.searchParams.get('quality')?.trim() ?? 'HI_RES_LOSSLESS') as AudioQuality;
	if (!Number.isFinite(trackId) || trackId <= 0) {
		return json({ error: 'Invalid track id' }, { status: 400 });
	}

	try {
		const payload = await losslessAPI.getDashManifestWithMetadata(trackId, quality);
		const result =
			payload.result.kind === 'flac'
				? {
						...payload.result,
						urls: payload.result.urls.map((entry) => losslessAPI.resolvePlaybackUrl(entry))
					}
				: payload.result;
		return json({
			...payload,
			result
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to resolve dash manifest';
		return json({ error: message }, { status: 500 });
	}
};
