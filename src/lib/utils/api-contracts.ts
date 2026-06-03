import { z } from 'zod';
import { TidalError } from '../errors';

// API Response Schemas - These must match the OpenAPI spec exactly
export const SearchResponseSchema = z.object({
	items: z.array(z.unknown()), // Specific item schemas will be validated by type-specific schemas
	total: z.number().optional(),
	limit: z.number().optional(),
	offset: z.number().optional()
});

export const AlbumResponseSchema = z.object({
	album: z.object({
		id: z.number(),
		title: z.string(),
		cover: z.string().optional(),
		videoCover: z.string().nullable().optional()
	}),
	tracks: z.array(
		z.object({
			id: z.number(),
			title: z.string(),
			duration: z.number(),
			trackNumber: z.number(),
			artists: z.array(
				z.object({
					id: z.number(),
					name: z.string(),
					type: z.string().optional()
				})
			)
		})
	)
});

export const ArtistResponseSchema = z.object({
	id: z.number(),
	name: z.string(),
	picture: z.string().optional(),
	type: z.string().optional()
});

export const PlaylistResponseSchema = z.object({
	playlist: z.object({
		id: z.string(),
		title: z.string(),
		description: z.string().optional(),
		cover: z.string().optional()
	}),
	items: z.array(
		z.object({
			item: z.object({
				id: z.number(),
				title: z.string(),
				duration: z.number(),
				artists: z.array(
					z.object({
						id: z.number(),
						name: z.string(),
						type: z.string().optional()
					})
				)
			})
		})
	)
});

export const TrackResponseSchema = z.object({
	id: z.number(),
	title: z.string(),
	duration: z.number(),
	allowStreaming: z.boolean(),
	streamReady: z.boolean(),
	premiumStreamingOnly: z.boolean(),
	trackNumber: z.number(),
	volumeNumber: z.number(),
	version: z.string().nullable(),
	popularity: z.number(),
	copyright: z.string().optional(),
	url: z.string(),
	isrc: z.string().optional(),
	editable: z.boolean(),
	explicit: z.boolean(),
	audioQuality: z.string(),
	audioModes: z.array(z.string()),
	artist: z.object({
		id: z.number(),
		name: z.string(),
		type: z.string().optional()
	}),
	artists: z.array(
		z.object({
			id: z.number(),
			name: z.string(),
			type: z.string().optional()
		})
	),
	album: z.object({
		id: z.number(),
		title: z.string(),
		cover: z.string().optional(),
		videoCover: z.string().nullable().optional()
	}),
	mediaMetadata: z
		.object({
			tags: z.array(z.string())
		})
		.optional()
});

export const StreamDataSchema = z.object({
	trackId: z.number(),
	assetPresentation: z.string(),
	audioMode: z.string(),
	audioQuality: z.string(),
	manifestMimeType: z.string(),
	manifest: z.string(),
	albumReplayGain: z.number().optional(),
	albumPeakAmplitude: z.number().optional(),
	trackReplayGain: z.number().optional(),
	trackPeakAmplitude: z.number().optional()
});

export const LyricsSchema = z.object({
	trackId: z.number(),
	lyrics: z.string(),
	copyright: z.string().optional(),
	writers: z.array(z.string()).optional()
});

// API Contract Validation Functions
export function validateApiResponse<T>(data: unknown, schema: z.ZodSchema<T>, endpoint: string): T {
	try {
		return schema.parse(data);
	} catch (error) {
		if (error instanceof z.ZodError) {
			const zodError = error as {
				errors?: Array<{ path: string[]; message: string }>;
				issues?: Array<{ path: string[]; message: string }>;
			};
			const issues = zodError.errors || zodError.issues || [];
			const errorMessage = `API response validation failed for ${endpoint}:\n${issues.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n')}`;
			throw new TidalError(errorMessage, 'VALIDATION_ERROR', 400);
		}
		throw new TidalError(
			`API validation error for ${endpoint}: ${error instanceof Error ? error.message : 'Unknown error'}`,
			'VALIDATION_ERROR',
			400
		);
	}
}

// API Spec Compliance Validators
export const API_SPECS = {
	VERSION: '2.10',
	SEARCH_ENDPOINTS: {
		tracks: '/search/?s={query}',
		albums: '/search/?al={query}',
		artists: '/search/?a={query}',
		playlists: '/search/?p={query}',
		videos: '/search/?v={query}',
		isrc: '/search/?i={isrc}'
	},
	RESOURCE_ENDPOINTS: {
		root: '/',
		info: '/info/?id={trackId}',
		album: '/album/?id={id}',
		artist: '/artist/?id={id}',
		artistDiscography: '/artist/?f={id}',
		playlist: '/playlist/?id={uuid}',
		trackPlaybackInfo: '/track/?id={trackId}',
		trackManifests: '/trackManifests/?id={trackId}',
		recommendations: '/recommendations/?id={trackId}',
		mix: '/mix/?id={mixId}',
		artistSimilar: '/artist/similar/?id={id}',
		albumSimilar: '/album/similar/?id={id}',
		lyrics: '/lyrics/?id={trackId}',
		widevine: '/widevine',
		covers: '/covers',
		coverByTrack: '/cover/?id={trackId}',
		coverByQuery: '/cover/?q={query}',
		topVideos: '/topvideos/',
		video: '/video/?id={videoId}'
	}
} as const;

export function validateEndpointFormat(
	actualUrl: string,
	expectedPattern: string,
	params: Record<string, unknown>
): boolean {
	const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regexPattern = expectedPattern
		.split(/(\{[^}]+\})/g)
		.map((part) => {
			const match = part.match(/^\{([^}]+)\}$/);
			if (!match) {
				return escapeRegExp(part);
			}
			const value = params[match[1]];
			return value ? escapeRegExp(String(value)) : `[^/?&]+`;
		})
		.join('');

	const trailingParamsPattern = expectedPattern.includes('?') ? '(&.*)?' : '(\\?.*)?';
	const regex = new RegExp(`^${regexPattern}${trailingParamsPattern}$`);
	return regex.test(actualUrl);
}

export function createApiContractTest(
	endpoint: string,
	method: 'GET' | 'POST' | 'PUT' | 'DELETE',
	expectedStatus: number,
	responseSchema: z.ZodSchema,
	params?: Record<string, unknown>
) {
	return {
		endpoint,
		method,
		expectedStatus,
		responseSchema,
		params: params || {}
	};
}
