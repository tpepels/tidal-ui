import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { TrackSchema, safeValidateApiResponse } from '$lib/utils/schemas';
import { lookupMusicBrainzTagsForTrack } from '$lib/server/musicBrainzLookup';

const MusicBrainzRequestSchema = z.object({
	track: TrackSchema
});

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const validation = safeValidateApiResponse(body, MusicBrainzRequestSchema, {
			endpoint: 'metadata.musicbrainz',
			correlationId: 'server',
			allowUnvalidated: false
		});
		if (!validation.success) {
			return json({ success: false, error: validation.error }, { status: 400 });
		}

		const tags = await lookupMusicBrainzTagsForTrack(validation.data.track);
		return json({
			success: true,
			tags,
			tagCount: Object.keys(tags).length
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to lookup MusicBrainz metadata';
		return json({ success: false, error: message }, { status: 500 });
	}
};
