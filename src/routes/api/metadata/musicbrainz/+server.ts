import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { TrackSchema, safeValidateApiResponse } from '$lib/utils/schemas';
import { lookupMusicBrainzMetadataForTrack } from '$lib/server/musicBrainzLookup';

const MusicBrainzRequestSchema = z.object({
	track: TrackSchema,
	strictIsrcMatch: z.boolean().optional(),
	preferredReleaseId: z.string().optional()
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

		const result = await lookupMusicBrainzMetadataForTrack(validation.data.track, {
			strictIsrcMatch: validation.data.strictIsrcMatch === true,
			preferredReleaseId: validation.data.preferredReleaseId
		});
		return json({
			success: true,
			lookupStatus: result.lookupStatus,
			tags: result.tags,
			tagCount: Object.keys(result.tags).length,
			match: result.match,
			error: result.error
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Failed to lookup MusicBrainz metadata';
		return json({ success: false, error: message }, { status: 500 });
	}
};
