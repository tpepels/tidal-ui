import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaLibrarySuggestions } from '$lib/server/mediaLibrary';

function toPositiveInt(value: string | null, fallback: number, maxValue = 25): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.min(maxValue, Math.trunc(parsed));
}

export const GET: RequestHandler = async ({ url }) => {
	try {
		const artistLimit = toPositiveInt(url.searchParams.get('artistLimit'), 5);
		const albumLimit = toPositiveInt(url.searchParams.get('albumLimit'), 5);
		const force = url.searchParams.get('force') === 'true';
		const payload = await getMediaLibrarySuggestions({
			artistLimit,
			albumLimit,
			force
		});

		return json({
			success: true,
			...payload
		});
	} catch (error) {
		console.error('[Media Library API] suggestions error:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to read media library suggestions'
			},
			{ status: 500 }
		);
	}
};
