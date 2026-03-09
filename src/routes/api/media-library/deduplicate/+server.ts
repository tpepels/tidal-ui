import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deduplicateMediaLibrary } from '$lib/server/mediaLibrary';

type DeduplicateRequestBody = {
	dryRun?: boolean;
	forceRescan?: boolean;
	maxAlbums?: number;
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json().catch(() => ({}))) as DeduplicateRequestBody;
		const result = await deduplicateMediaLibrary({
			dryRun: body.dryRun !== false,
			forceRescan: body.forceRescan === true,
			maxAlbums:
				typeof body.maxAlbums === 'number' && Number.isFinite(body.maxAlbums) && body.maxAlbums > 0
					? Math.trunc(body.maxAlbums)
					: undefined
		});

		return json({
			success: true,
			...result
		});
	} catch (error) {
		console.error('[Media Library API] deduplicate error:', error);
		return json(
			{
				success: false,
				error:
					error instanceof Error ? error.message : 'Failed to deduplicate media library directories'
			},
			{ status: 500 }
		);
	}
};
