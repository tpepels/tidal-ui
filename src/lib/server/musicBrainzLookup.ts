import {
	buildCacheKey,
	readLookupCache,
	readPreferredReleaseCache,
	writeLookupCache,
	writePreferredReleaseCache
} from './musicBrainzCache';
import {
	escapeQueryValue,
	normalizeIsrc,
	normalizeLookupText,
	normalizeReleaseId
} from './musicBrainzHelpers';
import {
	fetchMusicBrainzJson,
	MusicBrainzHttpError,
	MUSICBRAINZ_API_BASE
} from './musicBrainzHttp';
import {
	buildMusicBrainzLookupPayload,
	chooseBestRecording,
	chooseRecordingFromPreferredRelease,
	clampSearchLimit,
	hasRecordingIsrc,
	mapArtistCandidate,
	mapReleaseCandidate,
	scoreArtistCandidate,
	scoreReleaseCandidate
} from './musicBrainzScoring';
import type {
	MusicBrainzArtistCandidate,
	MusicBrainzArtistSearchParams,
	MusicBrainzArtistSearchResponse,
	MusicBrainzIsrcLookupResponse,
	MusicBrainzLookupOptions,
	MusicBrainzLookupTrack,
	MusicBrainzRecording,
	MusicBrainzRecordingSearchResponse,
	MusicBrainzRelease,
	MusicBrainzReleaseCandidate,
	MusicBrainzReleaseSearchParams,
	MusicBrainzReleaseSearchResponse
} from './musicBrainzTypes';
import type {
	CachedMusicBrainzTrackLookup,
	MusicBrainzTrackMatchDetails
} from '../features/track/trackMusicBrainzModel';

export type {
	MusicBrainzArtistCandidate,
	MusicBrainzArtistSearchParams,
	MusicBrainzLookupOptions,
	MusicBrainzLookupTrack,
	MusicBrainzReleaseCandidate,
	MusicBrainzReleaseSearchParams
} from './musicBrainzTypes';

export type MusicBrainzTrackLookupResult = {
	lookupStatus: 'matched' | 'no_match' | 'lookup_failed';
	tags: Record<string, string>;
	match: MusicBrainzTrackMatchDetails | null;
	error?: string;
};

async function fetchByIsrc(isrc: string): Promise<MusicBrainzRecording[]> {
	const url = `${MUSICBRAINZ_API_BASE}/isrc/${encodeURIComponent(
		isrc
	)}?fmt=json&inc=recordings+artist-credits+releases+release-groups+isrcs`;
	const payload = await fetchMusicBrainzJson<MusicBrainzIsrcLookupResponse>(url);
	return payload.recordings ?? [];
}

async function fetchPreferredReleaseById(releaseId: string): Promise<MusicBrainzRelease | null> {
	const cached = readPreferredReleaseCache(releaseId);
	if (cached !== undefined) {
		return cached;
	}
	const url = `${MUSICBRAINZ_API_BASE}/release/${encodeURIComponent(
		releaseId
	)}?fmt=json&inc=artist-credits+release-groups+media+recordings+isrcs`;
	try {
		const payload = await fetchMusicBrainzJson<MusicBrainzRelease>(url);
		const normalizedId = normalizeReleaseId(payload.id);
		if (!normalizedId || normalizedId !== releaseId) {
			writePreferredReleaseCache(releaseId, null);
			return null;
		}
		writePreferredReleaseCache(releaseId, payload);
		return payload;
	} catch (error) {
		if (error instanceof MusicBrainzHttpError && (error.status === 400 || error.status === 404)) {
			writePreferredReleaseCache(releaseId, null);
			return null;
		}
		throw error;
	}
}

async function fetchBySearchQuery(
	track: MusicBrainzLookupTrack,
	options?: MusicBrainzLookupOptions
): Promise<MusicBrainzRecording[]> {
	const parts: string[] = [];
	const preferredReleaseId = normalizeReleaseId(options?.preferredReleaseId);
	if (preferredReleaseId) {
		parts.push(`rid:${preferredReleaseId}`);
	}
	const normalizedTitle = normalizeLookupText(track.title);
	if (normalizedTitle) {
		parts.push(`recording:"${escapeQueryValue(normalizedTitle)}"`);
	}
	const artistName = normalizeLookupText(track.artist?.name ?? track.artists?.[0]?.name);
	if (artistName) {
		parts.push(`artist:"${escapeQueryValue(artistName)}"`);
	}
	const albumTitle = normalizeLookupText(track.album?.title);
	if (albumTitle) {
		parts.push(`release:"${escapeQueryValue(albumTitle)}"`);
	}

	const query = parts.join(' AND ').trim();
	if (!query) {
		return [];
	}

	const url = `${MUSICBRAINZ_API_BASE}/recording?query=${encodeURIComponent(
		query
	)}&fmt=json&limit=6&inc=artist-credits+releases+release-groups+isrcs`;
	const payload = await fetchMusicBrainzJson<MusicBrainzRecordingSearchResponse>(url);
	return payload.recordings ?? [];
}

async function fetchBySearchQuerySafe(
	track: MusicBrainzLookupTrack,
	options?: MusicBrainzLookupOptions
): Promise<MusicBrainzRecording[]> {
	try {
		return await fetchBySearchQuery(track, options);
	} catch (error) {
		if (error instanceof MusicBrainzHttpError && error.status === 400) {
			return [];
		}
		throw error;
	}
}

export async function searchMusicBrainzReleases(
	params: MusicBrainzReleaseSearchParams
): Promise<MusicBrainzReleaseCandidate[]> {
	const albumTitle = normalizeLookupText(params.albumTitle);
	const artistName = normalizeLookupText(params.artistName);
	const releaseYear = normalizeLookupText(params.releaseDate).slice(0, 4) || undefined;
	const upc = normalizeLookupText(params.upc);
	const queryParts: string[] = [];
	if (upc) {
		queryParts.push(`barcode:${escapeQueryValue(upc)}`);
	}
	if (albumTitle) {
		queryParts.push(`release:"${escapeQueryValue(albumTitle)}"`);
	}
	if (artistName) {
		queryParts.push(`artist:"${escapeQueryValue(artistName)}"`);
	}
	if (releaseYear) {
		queryParts.push(`date:${releaseYear}`);
	}
	const query = queryParts.join(' AND ').trim();
	if (!query) {
		return [];
	}
	const limit = clampSearchLimit(params.limit);
	const url = `${MUSICBRAINZ_API_BASE}/release?query=${encodeURIComponent(
		query
	)}&fmt=json&limit=${limit}&inc=artist-credits+release-groups+media`;
	const payload = await fetchMusicBrainzJson<MusicBrainzReleaseSearchResponse>(url);
	const seen = new Set<string>();
	const releases = (payload.releases ?? [])
		.filter((release) => {
			const id = normalizeReleaseId(release.id);
			if (!id) return false;
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		})
		.sort((a, b) => scoreReleaseCandidate(b, params) - scoreReleaseCandidate(a, params));
	return releases.map((release) => mapReleaseCandidate(release));
}

export async function searchMusicBrainzArtists(
	params: MusicBrainzArtistSearchParams
): Promise<MusicBrainzArtistCandidate[]> {
	const artistName = normalizeLookupText(params.artistName);
	if (!artistName) {
		return [];
	}
	const limit = clampSearchLimit(params.limit);
	const query = `artist:"${escapeQueryValue(artistName)}"`;
	const url = `${MUSICBRAINZ_API_BASE}/artist?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
	const payload = await fetchMusicBrainzJson<MusicBrainzArtistSearchResponse>(url);
	const seen = new Set<string>();
	const artists = (payload.artists ?? [])
		.filter((artist) => {
			const id = normalizeReleaseId(artist.id);
			if (!id) return false;
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		})
		.sort((a, b) => scoreArtistCandidate(b, params) - scoreArtistCandidate(a, params));
	return artists.map((artist) => mapArtistCandidate(artist));
}

export async function lookupMusicBrainzTagsForTrack(
	track: MusicBrainzLookupTrack,
	options?: MusicBrainzLookupOptions
): Promise<Record<string, string>> {
	const result = await lookupMusicBrainzMetadataForTrack(track, options);
	return result.tags;
}

function buildNoMatchResult(): CachedMusicBrainzTrackLookup {
	return {
		lookupStatus: 'no_match',
		tags: {},
		match: null
	};
}

function buildMatchedResult(
	tags: Record<string, string>,
	match: MusicBrainzTrackMatchDetails | null
): CachedMusicBrainzTrackLookup {
	return {
		lookupStatus: 'matched',
		tags,
		match
	};
}

function buildLookupFailedResult(error: unknown): MusicBrainzTrackLookupResult {
	return {
		lookupStatus: 'lookup_failed',
		tags: {},
		match: null,
		error: error instanceof Error ? error.message : String(error)
	};
}

export async function lookupMusicBrainzMetadataForTrack(
	track: MusicBrainzLookupTrack,
	options?: MusicBrainzLookupOptions
): Promise<MusicBrainzTrackLookupResult> {
	const cacheKey = buildCacheKey(track, options);
	const cached = readLookupCache(cacheKey);
	if (cached) {
		return cached;
	}

	const strictIsrcMatch = options?.strictIsrcMatch === true;
	const preferredReleaseId = normalizeReleaseId(options?.preferredReleaseId);
	const trackIsrc = normalizeIsrc(track.isrc);
	const normalizedTitle = normalizeLookupText(track.title);
	const normalizedArtistName = normalizeLookupText(track.artist?.name ?? track.artists?.[0]?.name);
	const hasTitle = normalizedTitle.length > 0;
	const hasTitleAndArtist = hasTitle && normalizedArtistName.length > 0;
	const hasTrackNumber = Boolean(Number(track.trackNumber));
	const hasLookupInput = preferredReleaseId
		? Boolean(trackIsrc) || hasTitle || hasTrackNumber
		: Boolean(trackIsrc) || hasTitleAndArtist;

	if (!hasLookupInput) {
		const result = buildNoMatchResult();
		writeLookupCache(cacheKey, result);
		return result;
	}

	if (strictIsrcMatch && !trackIsrc) {
		const result = buildNoMatchResult();
		writeLookupCache(cacheKey, result);
		return result;
	}

	try {
		if (preferredReleaseId) {
			const preferredRelease = await fetchPreferredReleaseById(preferredReleaseId);
			if (!preferredRelease) {
				const result = buildNoMatchResult();
				writeLookupCache(cacheKey, result);
				return result;
			}
			const preferredRecording = chooseRecordingFromPreferredRelease(
				track,
				preferredRelease,
				strictIsrcMatch
			);
			if (!preferredRecording) {
				const result = buildNoMatchResult();
				writeLookupCache(cacheKey, result);
				return result;
			}
			const lookup = buildMusicBrainzLookupPayload(track, preferredRecording, {
				...options,
				preferredReleaseId
			});
			const result =
				lookup.match && Object.keys(lookup.tags).length > 0
					? buildMatchedResult(lookup.tags, lookup.match)
					: buildNoMatchResult();
			writeLookupCache(cacheKey, result);
			return result;
		}

		const recordingsById = new Map<string, MusicBrainzRecording>();

		if (trackIsrc) {
			for (const recording of await fetchByIsrc(trackIsrc)) {
				if (!recording.id) continue;
				recordingsById.set(recording.id, recording);
			}
		}

		if (!strictIsrcMatch) {
			for (const recording of await fetchBySearchQuerySafe(track, {
				...options,
				preferredReleaseId
			})) {
				if (!recording.id) continue;
				if (!recordingsById.has(recording.id)) {
					recordingsById.set(recording.id, recording);
				}
			}
		}

		const candidates =
			strictIsrcMatch && trackIsrc
				? Array.from(recordingsById.values()).filter((recording) =>
						hasRecordingIsrc(recording, trackIsrc)
					)
				: Array.from(recordingsById.values());
		if (candidates.length === 0) {
			const result = buildNoMatchResult();
			writeLookupCache(cacheKey, result);
			return result;
		}

		const bestRecording = chooseBestRecording(track, candidates, {
			...options,
			preferredReleaseId
		});
		if (!bestRecording) {
			const result = buildNoMatchResult();
			writeLookupCache(cacheKey, result);
			return result;
		}

		const lookup = buildMusicBrainzLookupPayload(track, bestRecording, {
			...options,
			preferredReleaseId
		});
		const result =
			lookup.match && Object.keys(lookup.tags).length > 0
				? buildMatchedResult(lookup.tags, lookup.match)
				: buildNoMatchResult();
		writeLookupCache(cacheKey, result);
		return result;
	} catch (error) {
		if (error instanceof MusicBrainzHttpError && error.status === 400) {
			const result = buildNoMatchResult();
			writeLookupCache(cacheKey, result);
			return result;
		}
		const message = error instanceof Error ? error.message : String(error);
		console.warn('[MusicBrainz] Metadata lookup failed:', message);
		return buildLookupFailedResult(error);
	}
}
