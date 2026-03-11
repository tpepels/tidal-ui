import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { searchMusicBrainzReleases } from '$lib/server/musicBrainzLookup';

const MusicBrainzReleaseSearchSchema = z
	.object({
		albumTitle: z.string().optional(),
		artistName: z.string().optional(),
		releaseDate: z.string().optional(),
		upc: z.string().optional(),
		limit: z.number().int().positive().max(25).optional()
	})
	.refine(
		(payload) =>
			[payload.albumTitle, payload.artistName, payload.upc].some(
				(value) => typeof value === 'string' && value.trim().length > 0
			),
		{
			message: 'At least one of albumTitle, artistName, or upc is required.'
		}
	);

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const validation = MusicBrainzReleaseSearchSchema.safeParse(body);
		if (!validation.success) {
			return json(
				{
					success: false,
					error: validation.error.issues[0]?.message ?? 'Invalid request payload'
				},
				{ status: 400 }
			);
		}

		const releases = await searchMusicBrainzReleases({
			albumTitle: validation.data.albumTitle,
			artistName: validation.data.artistName,
			releaseDate: validation.data.releaseDate,
			upc: validation.data.upc,
			limit: validation.data.limit
		});

		return json({
			success: true,
			releases,
			count: releases.length
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('MusicBrainz HTTP 400')) {
			return json({ success: true, releases: [], count: 0 });
		}
		console.warn('[MusicBrainz] Release search failed:', message);
		return json({ success: false, error: 'Failed to search MusicBrainz releases' }, { status: 500 });
	}
};

