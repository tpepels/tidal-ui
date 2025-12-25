import { z } from 'zod';

// API Response Schemas
export const TrackSchema = z.object({
	id: z.number(),
	title: z.string(),
	artists: z.array(
		z.object({
			id: z.number().optional(),
			name: z.string()
		})
	),
	album: z
		.object({
			id: z.number().optional(),
			title: z.string(),
			cover: z.string().optional()
		})
		.optional(),
	duration: z.number().optional(),
	explicit: z.boolean().optional()
});

export const AlbumSchema = z.object({
	id: z.number(),
	title: z.string(),
	artist: z
		.object({
			id: z.number().optional(),
			name: z.string()
		})
		.optional(),
	cover: z.string().optional(),
	releaseDate: z.string().optional(),
	numberOfTracks: z.number().optional()
});

export const ArtistSchema = z.object({
	id: z.number(),
	name: z.string(),
	picture: z.string().optional()
});

export const PlaylistSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().optional(),
	creator: z
		.object({
			id: z.number().optional(),
			name: z.string()
		})
		.optional(),
	numberOfTracks: z.number().optional(),
	cover: z.string().optional()
});

export const TrackInfoSchema = z.object({
	trackId: z.number(),
	audioQuality: z.string(),
	audioMode: z.string(),
	manifest: z.string(),
	manifestMimeType: z.string(),
	manifestHash: z.string().optional(),
	assetPresentation: z.string(),
	albumReplayGain: z.number().optional(),
	albumPeakAmplitude: z.number().optional(),
	trackReplayGain: z.number().optional(),
	trackPeakAmplitude: z.number().optional(),
	bitDepth: z.number().optional(),
	sampleRate: z.number().optional()
});

export const SearchResponseSchema = z.object({
	items: z.array(z.unknown()), // Will be narrowed per type
	totalNumberOfItems: z.number().optional(),
	limit: z.number().optional(),
	offset: z.number().optional()
});

// Store Invariants
export const PlayerStateSchema = z.object({
	currentTrack: z
		.object({
			id: z.number(),
			title: z.string(),
			artists: z.array(z.object({ name: z.string() }))
		})
		.nullable(),
	isPlaying: z.boolean(),
	currentTime: z.number(),
	duration: z.number(),
	volume: z.number().min(0).max(1),
	quality: z.enum(['LOW', 'HIGH', 'LOSSLESS', 'HI_RES_LOSSLESS']),
	qualitySource: z.enum(['auto', 'manual']),
	isLoading: z.boolean(),
	queue: z.array(
		z.object({
			id: z.number(),
			title: z.string()
		})
	),
	queueIndex: z.number().min(-1)
});

// Validation helpers
export function validateApiResponse<T>(data: unknown, schema: z.ZodSchema<T>): T {
	try {
		return schema.parse(data);
	} catch (error) {
		console.error('API response validation failed:', error);
		throw new Error(
			`Invalid API response: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
}

export function assertInvariant(condition: boolean, message: string) {
	if (!condition) {
		console.error(`Invariant violation: ${message}`);
		// In development, throw; in production, log and continue
		if (import.meta.env.DEV) {
			throw new Error(`Invariant violation: ${message}`);
		}
	}
}
