import { z } from 'zod';
import { getSessionId } from '$lib/core/session';

const ArtistRoleEntrySchema = z.union([
	z.string(),
	z.object({
		category: z.string().optional(),
		categoryId: z.number().optional()
	})
]);

const ArtistRolesSchema = z
	.union([
		z.array(ArtistRoleEntrySchema),
		z.object({}).passthrough()
	])
	.optional();

const OptionalStringSchema = z.string().nullable().optional();

// API Response Schemas
export const TrackSchema = z.object({
	id: z.number(),
	title: z.string(),
	artists: z
		.array(
			z.object({
				id: z.number().optional(),
				name: z.string(),
				type: z.string().optional(),
				artistTypes: z.array(z.string()).optional(),
				artistRoles: ArtistRolesSchema,
				url: z.string().optional(),
				picture: OptionalStringSchema
			})
		)
		.optional(),
	artist: z
		.object({
			id: z.number().optional(),
			name: z.string(),
			type: z.string().optional(),
			artistTypes: z.array(z.string()).optional(),
			artistRoles: ArtistRolesSchema,
			url: z.string().optional(),
			picture: OptionalStringSchema
		})
		.optional(),
	album: z
		.object({
			id: z.number().optional(),
			title: z.string(),
			cover: z.string().optional(),
			artist: z
				.object({
					id: z.number().optional(),
					name: z.string(),
					type: z.string().optional(),
					artistTypes: z.array(z.string()).optional(),
					artistRoles: ArtistRolesSchema,
					url: z.string().optional(),
					picture: OptionalStringSchema
				})
				.optional(),
			artists: z
				.array(
					z.object({
						id: z.number().optional(),
						name: z.string(),
						type: z.string().optional(),
						artistTypes: z.array(z.string()).optional(),
						artistRoles: ArtistRolesSchema,
						url: z.string().optional(),
						picture: OptionalStringSchema
					})
				)
				.optional(),
			releaseDate: z.string().optional(),
			numberOfTracks: z.number().optional(),
			numberOfVolumes: z.number().optional(),
			copyright: z.string().optional(),
			popularity: z.number().optional()
		})
		.optional(),
	duration: z.number().optional(),
	explicit: z.boolean().optional(),
	trackNumber: z.number().optional(),
	volumeNumber: z.number().optional(),
	isrc: z.string().optional(),
	streamStartDate: z.string().optional(),
	replayGain: z.number().optional(),
	peak: z.number().optional(),
	audioQuality: z.string().optional(),
	audioMode: z.string().optional(),
	popularity: z.number().optional(),
	mediaMetadata: z
		.object({
			tags: z.array(z.string()).optional()
		})
		.optional()
});

export const AlbumSchema = z.object({
	id: z.number(),
	title: z.string(),
	artist: z
		.object({
			id: z.number().optional(),
			name: z.string(),
			type: z.string().optional(),
			artistTypes: z.array(z.string()).optional(),
			artistRoles: ArtistRolesSchema,
			url: z.string().optional(),
			picture: OptionalStringSchema
		})
		.optional(),
	artists: z
		.array(
			z.object({
				id: z.number().optional(),
				name: z.string(),
				type: z.string().optional(),
				artistTypes: z.array(z.string()).optional(),
				artistRoles: ArtistRolesSchema,
				url: z.string().optional(),
				picture: OptionalStringSchema
			})
		)
		.optional(),
	cover: z.string().optional(),
	releaseDate: z.string().optional(),
	numberOfTracks: z.number().optional(),
	numberOfVolumes: z.number().optional(),
	copyright: z.string().optional(),
	popularity: z.number().optional(),
	explicit: z.boolean().optional()
});

export const ArtistSchema = z.object({
	id: z.number(),
	name: z.string(),
	picture: OptionalStringSchema,
	type: z.string().optional(),
	artistTypes: z.array(z.string()).optional(),
	artistRoles: ArtistRolesSchema,
	url: z.string().optional(),
	popularity: z.number().optional()
});

export const PlaylistSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().optional(),
	creator: z
		.object({
			id: z.number().optional(),
			name: z.string(),
			type: z.string().optional(),
			artistTypes: z.array(z.string()).optional(),
			artistRoles: ArtistRolesSchema,
			url: z.string().optional(),
			picture: OptionalStringSchema
		})
		.optional(),
	numberOfTracks: z.number().optional(),
	cover: z.string().optional(),
	duration: z.number().optional(),
	lastUpdated: z.string().optional(),
	popularity: z.number().optional()
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

// Specific search response schemas
export const TrackSearchResponseSchema = SearchResponseSchema.extend({
	items: z.array(TrackSchema)
});

export const AlbumSearchResponseSchema = SearchResponseSchema.extend({
	items: z.array(AlbumSchema)
});

export const ArtistSearchResponseSchema = SearchResponseSchema.extend({
	items: z.array(ArtistSchema)
});

export const PlaylistSearchResponseSchema = SearchResponseSchema.extend({
	items: z.array(PlaylistSchema)
});

const ApiVersionSchema = z.preprocess((value) => {
	if (value === undefined || value === null) {
		return '2.0';
	}
	if (typeof value === 'number') {
		return String(value);
	}
	return value;
}, z.string().regex(/^2(\.\d+)?$/));

// API v2 container schema
export const ApiV2ContainerSchema = z.object({
	version: ApiVersionSchema,
	data: z.unknown()
});

// Error response schema
export const ApiErrorSchema = z.object({
	detail: z.string().optional(),
	userMessage: z.string().optional(),
	subStatus: z.number().optional()
});

// Stream data schema
export const StreamDataSchema = z.object({
	url: z.string(),
	replayGain: z.number().nullable().optional(),
	sampleRate: z.number().nullable().optional(),
	bitDepth: z.number().nullable().optional(),
	trackId: z.number().optional(),
	audioQuality: z.string().optional(),
	audioMode: z.string().optional(),
	manifest: z.string().optional(),
	manifestMimeType: z.string().optional(),
	manifestHash: z.string().optional(),
	assetPresentation: z.string().optional(),
	albumReplayGain: z.number().optional(),
	albumPeakAmplitude: z.number().optional(),
	trackReplayGain: z.number().optional(),
	trackPeakAmplitude: z.number().optional()
});

// Cover image schema
export const CoverImageSchema = z.object({
	url: z.string(),
	width: z.number().optional(),
	height: z.number().optional(),
	type: z.string().optional()
});

// Lyrics schema
export const LyricsSchema = z.object({
	trackId: z.number(),
	lyrics: z.string(),
	syncType: z.string().optional(),
	provider: z.string().optional()
});

// Album with tracks schema
export const AlbumWithTracksSchema = z.object({
	album: AlbumSchema,
	tracks: z.array(TrackSchema)
});

// Playlist with tracks schema
export const PlaylistWithTracksSchema = z.object({
	playlist: PlaylistSchema,
	items: z.array(
		z.object({
			item: TrackSchema
		})
	)
});

// Artist details schema (includes albums and tracks)
export const ArtistDetailsSchema = ArtistSchema.extend({
	albums: z.array(AlbumSchema).optional(),
	tracks: z.array(TrackSchema).optional()
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

type ValidationContext = {
	endpoint?: string;
	correlationId?: string;
	allowUnvalidated?: boolean;
};

const validationWarned = new Set<string>();

const getValidationKey = (endpoint?: string, correlationId?: string): string =>
	`${endpoint ?? 'unknown'}:${correlationId ?? 'missing'}`;

export function safeValidateApiResponse<T>(
	data: unknown,
	schema: z.ZodSchema<T>,
	context?: ValidationContext
): { success: true; data: T } | { success: false; error: string; originalError: unknown } {
	try {
		const validatedData = schema.parse(data);
		return { success: true, data: validatedData };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
		const endpoint = context?.endpoint ?? 'unknown';
		const correlationId = context?.correlationId ?? getSessionId() ?? 'missing';
		const key = getValidationKey(endpoint, correlationId);
		if (!validationWarned.has(key)) {
			validationWarned.add(key);
			const issues =
				error && typeof error === 'object' && 'issues' in error
					? (error as { issues?: Array<{ path?: unknown; message?: string }> }).issues
							?.slice(0, 3)
							?.map((issue) => ({
								path: Array.isArray(issue.path) ? issue.path.join('.') : issue.path,
								message: issue.message
							}))
					: undefined;
			console.warn('API response validation failed (safe mode):', {
				endpoint,
				correlationId,
				allowUnvalidated: context?.allowUnvalidated ?? false,
				error: errorMessage,
				issues
			});
		}
		return { success: false, error: errorMessage, originalError: error };
	}
}

/**
 * Validates API response and provides graceful error handling with user-friendly messages
 * Returns the validated data if successful, or a fallback/default if validation fails
 */
export function validateApiResponseGracefully<T>(
	data: unknown,
	schema: z.ZodSchema<T>,
	context: string,
	fallbackValue?: T
): T {
	const validation = safeValidateApiResponse(data, schema, { endpoint: context });

	if (validation.success) {
		return validation.data;
	}

	// Log the validation error for debugging
	console.warn(`API response validation failed for ${context}:`, validation.error);

	// For critical data structures, we might want to throw with a user-friendly message
	// For non-critical data, we can provide fallbacks or continue with unvalidated data

	// Check if this is a critical validation failure that should stop execution
	// For critical data structures, we might want to throw with a user-friendly message
	// For non-critical data, we can provide fallbacks or continue with unvalidated data

	// Check if this is a critical validation failure that should stop execution
	const isCriticalContext =
		context.includes('track') || context.includes('album') || context.includes('stream');

	if (isCriticalContext) {
		// For critical contexts, always throw with a user-friendly error message
		const userMessage = getUserFriendlyValidationError(context, validation.error);
		throw new Error(`Unable to process ${context}: ${userMessage}`);
	}

	// For non-critical failures, use fallback or original data
	if (fallbackValue !== undefined) {
		console.warn(`Using fallback value for ${context} due to validation failure`);
		return fallbackValue;
	}

	// If no fallback provided, stop rather than continue with unvalidated data
	const userMessage = getUserFriendlyValidationError(context, validation.error);
	throw new Error(`Unable to process ${context}: ${userMessage}`);
}

/**
 * Converts validation errors into user-friendly messages
 */
export function getUserFriendlyValidationError(context: string, validationError: string): string {
	// Extract common validation error patterns and convert to user-friendly messages
	if (
		validationError.includes('Required') ||
		(validationError.includes('expected') && validationError.includes('received undefined'))
	) {
		return 'The server returned incomplete data. Please try again.';
	}

	if (
		validationError.includes('Invalid') ||
		(validationError.includes('expected') && validationError.includes('received'))
	) {
		return 'The server returned unexpected data format. Please try again.';
	}

	if (validationError.includes('too_big') || validationError.includes('too_small')) {
		return 'The server returned data that appears corrupted. Please try again.';
	}

	// Default fallback message
	return 'The server returned data that could not be processed. Please try again.';
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
