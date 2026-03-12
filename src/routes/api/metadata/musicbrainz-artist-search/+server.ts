import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { searchMusicBrainzArtists } from '$lib/server/musicBrainzLookup';

const MusicBrainzArtistSearchSchema = z.object({
	artistName: z.string().min(1, 'Artist name is required'),
	limit: z.number().int().positive().max(25).optional()
});

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const validation = MusicBrainzArtistSearchSchema.safeParse(body);
		if (!validation.success) {
			return json(
				{
					success: false,
					error: validation.error.issues[0]?.message ?? 'Invalid request payload'
				},
				{ status: 400 }
			);
		}

		const artists = await searchMusicBrainzArtists({
			artistName: validation.data.artistName,
			limit: validation.data.limit
		});

		return json({
			success: true,
			artists,
			count: artists.length
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('MusicBrainz HTTP 400')) {
			return json({ success: true, artists: [], count: 0 });
		}
		console.warn('[MusicBrainz] Artist search failed:', message);
		return json({ success: false, error: 'Failed to search MusicBrainz artists' }, { status: 500 });
	}
};
