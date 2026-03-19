import type { Track } from '$lib/types';

type FetchLike = typeof fetch;

export type MusicBrainzLookupStatus = 'matched' | 'no_match' | 'lookup_failed';

export type MusicBrainzReleaseOption = {
	id: string;
	title?: string;
	artistCredit?: string;
	status?: string;
	country?: string;
	date?: string;
	trackCount?: number;
	barcode?: string;
};

export type MusicBrainzArtistOption = {
	id: string;
	name?: string;
	type?: string;
	country?: string;
	area?: string;
	disambiguation?: string;
	lifeSpanBegin?: string;
	lifeSpanEnd?: string;
	score?: number;
};

export type MusicBrainzTrackLookupPayload = {
	success: boolean;
	lookupStatus?: MusicBrainzLookupStatus;
	tags?: Record<string, string>;
	tagCount?: number;
	match?: unknown;
	error?: string;
};

type MusicBrainzReleaseSearchPayload = {
	success?: boolean;
	error?: string;
	releases?: MusicBrainzReleaseOption[];
};

type MusicBrainzArtistSearchPayload = {
	success?: boolean;
	error?: string;
	artists?: MusicBrainzArtistOption[];
};

async function postJson<T>(
	path: string,
	body: unknown,
	options?: {
		signal?: AbortSignal;
		fetchImpl?: FetchLike;
	}
): Promise<{ response: Response; payload: T | null }> {
	const fetchImpl = options?.fetchImpl ?? fetch;
	const response = await fetchImpl(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: options?.signal
	});
	try {
		return {
			response,
			payload: (await response.json()) as T
		};
	} catch {
		return { response, payload: null };
	}
}

export const musicBrainzClient = {
	async lookupTrackMetadata(
		track: Track,
		options?: {
			strictIsrcMatch?: boolean;
			preferredReleaseId?: string;
			signal?: AbortSignal;
			fetchImpl?: FetchLike;
		}
	): Promise<MusicBrainzTrackLookupPayload> {
		const { response, payload } = await postJson<MusicBrainzTrackLookupPayload>(
			'/api/metadata/musicbrainz',
			{
				track,
				strictIsrcMatch: options?.strictIsrcMatch === true,
				preferredReleaseId: options?.preferredReleaseId
			},
			options
		);
		if (!response.ok || !payload?.success) {
			throw new Error(payload?.error || `MusicBrainz lookup failed (${response.status})`);
		}
		return payload;
	},

	async searchReleases(
		params: {
			albumTitle?: string;
			artistName?: string;
			releaseDate?: string;
			upc?: string;
			limit?: number;
		},
		options?: {
			signal?: AbortSignal;
			fetchImpl?: FetchLike;
		}
	): Promise<MusicBrainzReleaseOption[]> {
		const { response, payload } = await postJson<MusicBrainzReleaseSearchPayload>(
			'/api/metadata/musicbrainz-release-search',
			params,
			options
		);
		if (!response.ok || !payload?.success) {
			throw new Error(payload?.error || 'Failed to search MusicBrainz releases');
		}
		return Array.isArray(payload.releases)
			? payload.releases.filter((release) => typeof release?.id === 'string' && release.id.length > 0)
			: [];
	},

	async searchArtists(
		params: {
			artistName: string;
			limit?: number;
		},
		options?: {
			signal?: AbortSignal;
			fetchImpl?: FetchLike;
		}
	): Promise<MusicBrainzArtistOption[]> {
		const { response, payload } = await postJson<MusicBrainzArtistSearchPayload>(
			'/api/metadata/musicbrainz-artist-search',
			params,
			options
		);
		if (!response.ok || !payload?.success) {
			throw new Error(payload?.error || 'Failed to search MusicBrainz artists');
		}
		return Array.isArray(payload.artists)
			? payload.artists.filter((artist) => typeof artist?.id === 'string' && artist.id.length > 0)
			: [];
	}
};
