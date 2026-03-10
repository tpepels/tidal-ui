export interface MusicBrainzLookupTrack {
	id?: number;
	title?: string;
	isrc?: string;
	artist?: { name?: string };
	artists?: Array<{ name?: string }>;
	album?: {
		title?: string;
		releaseDate?: string;
		upc?: string;
	};
}

export interface MusicBrainzLookupOptions {
	strictIsrcMatch?: boolean;
}

const MUSICBRAINZ_API_BASE = 'https://musicbrainz.org/ws/2';
const MUSICBRAINZ_TIMEOUT_MS = 7_500;
const MUSICBRAINZ_MIN_INTERVAL_MS = 1_100;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 800;
const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

interface MusicBrainzArtist {
	id?: string;
	name?: string;
}

interface MusicBrainzArtistCredit {
	artist?: MusicBrainzArtist;
	name?: string;
}

interface MusicBrainzReleaseGroup {
	id?: string;
	'primary-type'?: string;
	'secondary-types'?: string[];
}

interface MusicBrainzRelease {
	id?: string;
	title?: string;
	status?: string;
	country?: string;
	date?: string;
	barcode?: string;
	'artist-credit'?: MusicBrainzArtistCredit[];
	'release-group'?: MusicBrainzReleaseGroup;
}

interface MusicBrainzRecording {
	id?: string;
	title?: string;
	score?: number | string;
	isrcs?: string[];
	'artist-credit'?: MusicBrainzArtistCredit[];
	releases?: MusicBrainzRelease[];
}

interface MusicBrainzRecordingSearchResponse {
	recordings?: MusicBrainzRecording[];
}

interface MusicBrainzIsrcLookupResponse {
	recordings?: MusicBrainzRecording[];
}

interface CacheEntry {
	expiresAt: number;
	tags: Record<string, string>;
}

class MusicBrainzHttpError extends Error {
	status: number;
	url: string;

	constructor(status: number, url: string) {
		super(`MusicBrainz HTTP ${status}`);
		this.name = 'MusicBrainzHttpError';
		this.status = status;
		this.url = url;
	}
}

const lookupCache = new Map<string, CacheEntry>();

let nextRequestAt = 0;
let requestChain: Promise<void> = Promise.resolve();

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeQueryValue(value: string): string {
	return value.replace(/[\\"]/g, '\\$&');
}

function normalizeLookupText(value: string | undefined | null): string {
	if (typeof value !== 'string') {
		return '';
	}
	return value
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizeIsrc(value: string | undefined | null): string | null {
	const normalized = normalizeLookupText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
	if (!normalized || !ISRC_PATTERN.test(normalized)) {
		return null;
	}
	return normalized;
}

function normalizeToken(value: string | undefined | null): string {
	if (!value) return '';
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function yearFromDate(value: string | undefined | null): string | undefined {
	if (!value) return undefined;
	const match = /^(\d{4})/.exec(value.trim());
	return match?.[1];
}

function sanitizeTagValue(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const sanitized = value
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!sanitized) return undefined;
	return sanitized.slice(0, 1024);
}

function addTag(target: Record<string, string>, key: string, value: unknown): void {
	const sanitized = sanitizeTagValue(value);
	if (!sanitized) return;
	target[key] = sanitized;
}

function dedupeStrings(values: Array<string | undefined | null>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (!value) continue;
		if (seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result;
}

function pruneCacheIfNeeded(): void {
	if (lookupCache.size <= MAX_CACHE_ENTRIES) return;
	while (lookupCache.size > MAX_CACHE_ENTRIES) {
		const firstKey = lookupCache.keys().next().value;
		if (!firstKey) break;
		lookupCache.delete(firstKey);
	}
}

function readCache(cacheKey: string): Record<string, string> | null {
	const cached = lookupCache.get(cacheKey);
	if (!cached) return null;
	if (cached.expiresAt <= Date.now()) {
		lookupCache.delete(cacheKey);
		return null;
	}
	return { ...cached.tags };
}

function writeCache(cacheKey: string, tags: Record<string, string>): void {
	lookupCache.set(cacheKey, {
		expiresAt: Date.now() + CACHE_TTL_MS,
		tags: { ...tags }
	});
	pruneCacheIfNeeded();
}

function buildCacheKey(track: MusicBrainzLookupTrack, options?: MusicBrainzLookupOptions): string {
	const mode = options?.strictIsrcMatch === true ? 'strict' : 'flex';
	const isrc = normalizeIsrc(track.isrc);
	if (isrc) {
		return `${mode}:isrc:${isrc}`;
	}
	const trackTitle = normalizeToken(track.title);
	const artistName = normalizeToken(track.artist?.name ?? track.artists?.[0]?.name);
	const albumTitle = normalizeToken(track.album?.title);
	return `${mode}:query:${trackTitle}|${artistName}|${albumTitle}`;
}

async function scheduleRateLimited<T>(request: () => Promise<T>): Promise<T> {
	const runner = async (): Promise<T> => {
		const waitMs = nextRequestAt - Date.now();
		if (waitMs > 0) {
			await delay(waitMs);
		}
		nextRequestAt = Date.now() + MUSICBRAINZ_MIN_INTERVAL_MS;
		return request();
	};

	const resultPromise = requestChain.then(runner, runner);
	requestChain = resultPromise.then(
		() => undefined,
		() => undefined
	);
	return resultPromise;
}

function musicBrainzUserAgent(): string {
	const envAgent = process.env.MUSICBRAINZ_USER_AGENT;
	if (typeof envAgent === 'string' && envAgent.trim().length > 0) {
		return envAgent.trim();
	}
	return 'BiniLossless/1.0 (+https://music.binimum.org)';
}

async function fetchMusicBrainzJson<T>(url: string): Promise<T> {
	return scheduleRateLimited(async () => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), MUSICBRAINZ_TIMEOUT_MS);
		try {
			const response = await fetch(url, {
				headers: {
					Accept: 'application/json',
					'User-Agent': musicBrainzUserAgent()
				},
				signal: controller.signal
			});
			if (!response.ok) {
				throw new MusicBrainzHttpError(response.status, url);
			}
			const data = (await response.json()) as T;
			return data;
		} finally {
			clearTimeout(timeout);
		}
	});
}

function scoreRelease(track: MusicBrainzLookupTrack, release: MusicBrainzRelease): number {
	let score = 0;
	const expectedAlbum = normalizeToken(track.album?.title);
	const expectedYear = yearFromDate(track.album?.releaseDate);
	const releaseTitle = normalizeToken(release.title);
	const releaseYear = yearFromDate(release.date);

	if (expectedAlbum && releaseTitle) {
		if (releaseTitle === expectedAlbum) {
			score += 120;
		} else if (releaseTitle.includes(expectedAlbum) || expectedAlbum.includes(releaseTitle)) {
			score += 55;
		}
	}
	if (expectedYear && releaseYear && releaseYear === expectedYear) {
		score += 25;
	}
	if (typeof release.status === 'string' && release.status.toLowerCase() === 'official') {
		score += 8;
	}
	return score;
}

function scoreRecording(track: MusicBrainzLookupTrack, recording: MusicBrainzRecording): number {
	let score = Number(recording.score ?? 0) || 0;
	const expectedTitle = normalizeToken(track.title);
	const recordingTitle = normalizeToken(recording.title);
	const expectedArtist = normalizeToken(track.artist?.name ?? track.artists?.[0]?.name);
	const expectedIsrc = normalizeIsrc(track.isrc);
	const recordingIsrcs = new Set(
		(recording.isrcs ?? [])
			.map((value) => normalizeIsrc(value))
			.filter((value): value is string => value !== null)
	);

	if (expectedTitle && recordingTitle) {
		if (recordingTitle === expectedTitle) {
			score += 90;
		} else if (
			recordingTitle.includes(expectedTitle) ||
			expectedTitle.includes(recordingTitle)
		) {
			score += 40;
		}
	}

	if (expectedArtist) {
		const artistMatches = (recording['artist-credit'] ?? []).some((credit) => {
			const artistName = normalizeToken(credit.artist?.name ?? credit.name);
			return artistName === expectedArtist;
		});
		if (artistMatches) {
			score += 70;
		}
	}

	if (expectedIsrc && recordingIsrcs.has(expectedIsrc)) {
		score += 220;
	}

	let bestReleaseScore = 0;
	for (const release of recording.releases ?? []) {
		bestReleaseScore = Math.max(bestReleaseScore, scoreRelease(track, release));
	}
	score += bestReleaseScore;

	return score;
}

function chooseBestRecording(
	track: MusicBrainzLookupTrack,
	recordings: MusicBrainzRecording[]
): MusicBrainzRecording | null {
	let best: MusicBrainzRecording | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;

	for (const recording of recordings) {
		const score = scoreRecording(track, recording);
		if (score > bestScore) {
			best = recording;
			bestScore = score;
		}
	}

	return best;
}

function chooseBestRelease(
	track: MusicBrainzLookupTrack,
	releases: MusicBrainzRelease[]
): MusicBrainzRelease | null {
	if (!Array.isArray(releases) || releases.length === 0) {
		return null;
	}
	let best: MusicBrainzRelease | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const release of releases) {
		const score = scoreRelease(track, release);
		if (score > bestScore) {
			best = release;
			bestScore = score;
		}
	}
	return best;
}

function buildMusicBrainzTags(
	track: MusicBrainzLookupTrack,
	recording: MusicBrainzRecording
): Record<string, string> {
	const tags: Record<string, string> = {};
	const release = chooseBestRelease(track, recording.releases ?? []);

	addTag(tags, 'MUSICBRAINZ_TRACKID', recording.id);

	const artistIds = dedupeStrings(
		(recording['artist-credit'] ?? []).map((credit) => credit.artist?.id)
	);
	if (artistIds.length > 0) {
		addTag(tags, 'MUSICBRAINZ_ARTISTID', artistIds.join(';'));
	}

	if (release) {
		addTag(tags, 'MUSICBRAINZ_ALBUMID', release.id);
		addTag(tags, 'MUSICBRAINZ_RELEASECOUNTRY', release.country);
		addTag(tags, 'MUSICBRAINZ_RELEASESTATUS', release.status);
		addTag(tags, 'MUSICBRAINZ_RELEASEGROUPID', release['release-group']?.id);
		addTag(tags, 'BARCODE', release.barcode);

		const releaseGroup = release['release-group'];
		const primaryType = sanitizeTagValue(releaseGroup?.['primary-type']);
		const secondaryTypes = (releaseGroup?.['secondary-types'] ?? [])
			.map((value) => sanitizeTagValue(value))
			.filter((value): value is string => Boolean(value));
		if (primaryType && secondaryTypes.length > 0) {
			addTag(tags, 'MUSICBRAINZ_RELEASETYPE', `${primaryType}; ${secondaryTypes.join('; ')}`);
		} else if (primaryType) {
			addTag(tags, 'MUSICBRAINZ_RELEASETYPE', primaryType);
		} else if (secondaryTypes.length > 0) {
			addTag(tags, 'MUSICBRAINZ_RELEASETYPE', secondaryTypes.join('; '));
		}

		const albumArtistIds = dedupeStrings(
			(release['artist-credit'] ?? []).map((credit) => credit.artist?.id)
		);
		if (albumArtistIds.length > 0) {
			addTag(tags, 'MUSICBRAINZ_ALBUMARTISTID', albumArtistIds.join(';'));
		}
	}

	if (!tags.BARCODE) {
		addTag(tags, 'BARCODE', track.album?.upc);
	}

	return tags;
}

async function fetchByIsrc(isrc: string): Promise<MusicBrainzRecording[]> {
	const url = `${MUSICBRAINZ_API_BASE}/isrc/${encodeURIComponent(
		isrc
	)}?fmt=json&inc=recordings+artist-credits+releases+release-groups+isrcs`;
	const payload = await fetchMusicBrainzJson<MusicBrainzIsrcLookupResponse>(url);
	return payload.recordings ?? [];
}

async function fetchBySearchQuery(track: MusicBrainzLookupTrack): Promise<MusicBrainzRecording[]> {
	const parts: string[] = [];
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

function hasRecordingIsrc(recording: MusicBrainzRecording, expectedIsrc: string): boolean {
	if (!expectedIsrc) return false;
	return (recording.isrcs ?? []).some((value) => normalizeIsrc(value) === expectedIsrc);
}

export async function lookupMusicBrainzTagsForTrack(
	track: MusicBrainzLookupTrack,
	options?: MusicBrainzLookupOptions
): Promise<Record<string, string>> {
	const cacheKey = buildCacheKey(track, options);
	const cached = readCache(cacheKey);
	if (cached) {
		return cached;
	}

	const strictIsrcMatch = options?.strictIsrcMatch === true;
	const trackIsrc = normalizeIsrc(track.isrc);
	const normalizedTitle = normalizeLookupText(track.title);
	const normalizedArtistName = normalizeLookupText(track.artist?.name ?? track.artists?.[0]?.name);
	const hasTitleAndArtist =
		normalizedTitle.length > 0 && normalizedArtistName.length > 0;
	const hasLookupInput = Boolean(trackIsrc) || hasTitleAndArtist;

	if (!hasLookupInput) {
		writeCache(cacheKey, {});
		return {};
	}

	if (strictIsrcMatch && !trackIsrc) {
		writeCache(cacheKey, {});
		return {};
	}

	try {
		const recordingsById = new Map<string, MusicBrainzRecording>();

		if (trackIsrc) {
			for (const recording of await fetchByIsrc(trackIsrc)) {
				if (!recording.id) continue;
				recordingsById.set(recording.id, recording);
			}
		}

		if (!strictIsrcMatch) {
			// Run a title/artist query as a fallback and score booster.
			for (const recording of await fetchBySearchQuery(track)) {
				if (!recording.id) continue;
				if (!recordingsById.has(recording.id)) {
					recordingsById.set(recording.id, recording);
				}
			}
		}

		const candidates = strictIsrcMatch && trackIsrc
			? Array.from(recordingsById.values()).filter((recording) =>
					hasRecordingIsrc(recording, trackIsrc)
				)
			: Array.from(recordingsById.values());
		if (candidates.length === 0) {
			writeCache(cacheKey, {});
			return {};
		}

		const bestRecording = chooseBestRecording(track, candidates);
		if (!bestRecording) {
			writeCache(cacheKey, {});
			return {};
		}

		const tags = buildMusicBrainzTags(track, bestRecording);
		writeCache(cacheKey, tags);
		return tags;
	} catch (error) {
		if (error instanceof MusicBrainzHttpError && error.status === 400) {
			// Malformed upstream query/input should be silent and non-fatal.
			writeCache(cacheKey, {});
			return {};
		}
		const message = error instanceof Error ? error.message : String(error);
		console.warn('[MusicBrainz] Metadata lookup failed:', message);
		writeCache(cacheKey, {});
		return {};
	}
}
