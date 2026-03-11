export interface MusicBrainzLookupTrack {
	id?: number;
	title?: string;
	isrc?: string;
	trackNumber?: number;
	volumeNumber?: number;
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
	preferredReleaseId?: string;
}

export interface MusicBrainzReleaseSearchParams {
	albumTitle?: string;
	artistName?: string;
	releaseDate?: string;
	upc?: string;
	limit?: number;
}

export interface MusicBrainzReleaseCandidate {
	id: string;
	title?: string;
	artistCredit?: string;
	status?: string;
	country?: string;
	date?: string;
	trackCount?: number;
	barcode?: string;
	releaseGroupId?: string;
	primaryType?: string;
	secondaryTypes?: string[];
}

const MUSICBRAINZ_API_BASE = 'https://musicbrainz.org/ws/2';
const MUSICBRAINZ_TIMEOUT_MS = 7_500;
const MUSICBRAINZ_MIN_INTERVAL_MS = 1_100;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 800;
const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const MBID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

interface MusicBrainzReleaseTrack {
	id?: string;
	number?: string;
	position?: number | string;
	title?: string;
	length?: number | string;
	recording?: MusicBrainzRecording;
}

interface MusicBrainzMedium {
	position?: number | string;
	title?: string;
	'track-count'?: number | string;
	trackCount?: number | string;
	'track-offset'?: number | string;
	tracks?: MusicBrainzReleaseTrack[];
}

interface MusicBrainzRelease {
	id?: string;
	title?: string;
	status?: string;
	country?: string;
	date?: string;
	'track-count'?: number | string;
	media?: MusicBrainzMedium[];
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

interface MusicBrainzReleaseSearchResponse {
	releases?: MusicBrainzRelease[];
}

interface CacheEntry {
	expiresAt: number;
	tags: Record<string, string>;
}

interface ReleaseCacheEntry {
	expiresAt: number;
	release: MusicBrainzRelease | null;
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
const preferredReleaseCache = new Map<string, ReleaseCacheEntry>();

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

function normalizeReleaseId(value: string | undefined | null): string | undefined {
	const normalized = normalizeLookupText(value).toLowerCase();
	if (!normalized || !MBID_PATTERN.test(normalized)) {
		return undefined;
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

function coercePositiveInt(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return Math.trunc(value);
	}
	if (typeof value === 'string') {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return undefined;
}

function releaseTrackCount(release: MusicBrainzRelease): number | undefined {
	const directCount = coercePositiveInt(release['track-count']);
	if (directCount) {
		return directCount;
	}
	const mediaTrackCounts = (release.media ?? [])
		.map((medium) => coercePositiveInt(medium['track-count'] ?? medium.trackCount))
		.filter(
			(value): value is number =>
				typeof value === 'number' && Number.isFinite(value) && value > 0
		);
	if (mediaTrackCounts.length === 0) {
		return undefined;
	}
	return mediaTrackCounts.reduce((total, value) => total + value, 0);
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

function prunePreferredReleaseCacheIfNeeded(): void {
	if (preferredReleaseCache.size <= MAX_CACHE_ENTRIES) return;
	while (preferredReleaseCache.size > MAX_CACHE_ENTRIES) {
		const firstKey = preferredReleaseCache.keys().next().value;
		if (!firstKey) break;
		preferredReleaseCache.delete(firstKey);
	}
}

function readPreferredReleaseCache(releaseId: string): MusicBrainzRelease | null | undefined {
	const cached = preferredReleaseCache.get(releaseId);
	if (!cached) return undefined;
	if (cached.expiresAt <= Date.now()) {
		preferredReleaseCache.delete(releaseId);
		return undefined;
	}
	return cached.release;
}

function writePreferredReleaseCache(releaseId: string, release: MusicBrainzRelease | null): void {
	preferredReleaseCache.set(releaseId, {
		expiresAt: Date.now() + CACHE_TTL_MS,
		release
	});
	prunePreferredReleaseCacheIfNeeded();
}

function buildCacheKey(track: MusicBrainzLookupTrack, options?: MusicBrainzLookupOptions): string {
	const mode = options?.strictIsrcMatch === true ? 'strict' : 'flex';
	const releaseKey = normalizeReleaseId(options?.preferredReleaseId) ?? 'auto';
	const isrc = normalizeIsrc(track.isrc);
	if (isrc) {
		return `${mode}:release:${releaseKey}:isrc:${isrc}`;
	}
	const trackTitle = normalizeToken(track.title);
	const artistName = normalizeToken(track.artist?.name ?? track.artists?.[0]?.name);
	const albumTitle = normalizeToken(track.album?.title);
	return `${mode}:release:${releaseKey}:query:${trackTitle}|${artistName}|${albumTitle}`;
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

function scoreRelease(
	track: MusicBrainzLookupTrack,
	release: MusicBrainzRelease,
	options?: MusicBrainzLookupOptions
): number {
	let score = 0;
	const expectedAlbum = normalizeToken(track.album?.title);
	const expectedYear = yearFromDate(track.album?.releaseDate);
	const releaseTitle = normalizeToken(release.title);
	const releaseYear = yearFromDate(release.date);
	const preferredReleaseId = normalizeReleaseId(options?.preferredReleaseId);
	if (preferredReleaseId && normalizeReleaseId(release.id) === preferredReleaseId) {
		score += 1000;
	}

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

function scoreRecording(
	track: MusicBrainzLookupTrack,
	recording: MusicBrainzRecording,
	options?: MusicBrainzLookupOptions
): number {
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
	const preferredReleaseId = normalizeReleaseId(options?.preferredReleaseId);
	const recordingReleaseIds = new Set(
		(recording.releases ?? [])
			.map((release) => normalizeReleaseId(release.id))
			.filter((value): value is string => Boolean(value))
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
	if (preferredReleaseId && recordingReleaseIds.has(preferredReleaseId)) {
		score += 500;
	}

	let bestReleaseScore = 0;
	for (const release of recording.releases ?? []) {
		bestReleaseScore = Math.max(bestReleaseScore, scoreRelease(track, release, options));
	}
	score += bestReleaseScore;

	return score;
}

function chooseBestRecording(
	track: MusicBrainzLookupTrack,
	recordings: MusicBrainzRecording[],
	options?: MusicBrainzLookupOptions
): MusicBrainzRecording | null {
	let best: MusicBrainzRecording | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;

	for (const recording of recordings) {
		const score = scoreRecording(track, recording, options);
		if (score > bestScore) {
			best = recording;
			bestScore = score;
		}
	}

	return best;
}

function chooseBestRelease(
	track: MusicBrainzLookupTrack,
	releases: MusicBrainzRelease[],
	options?: MusicBrainzLookupOptions
): MusicBrainzRelease | null {
	if (!Array.isArray(releases) || releases.length === 0) {
		return null;
	}
	const preferredReleaseId = normalizeReleaseId(options?.preferredReleaseId);
	if (preferredReleaseId) {
		const preferredRelease = releases.find(
			(release) => normalizeReleaseId(release.id) === preferredReleaseId
		);
		if (preferredRelease) {
			return preferredRelease;
		}
	}
	let best: MusicBrainzRelease | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const release of releases) {
		const score = scoreRelease(track, release, options);
		if (score > bestScore) {
			best = release;
			bestScore = score;
		}
	}
	return best;
}

function buildMusicBrainzTags(
	track: MusicBrainzLookupTrack,
	recording: MusicBrainzRecording,
	options?: MusicBrainzLookupOptions
): Record<string, string> {
	const tags: Record<string, string> = {};
	const release = chooseBestRelease(track, recording.releases ?? [], options);

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
		if (
			error instanceof MusicBrainzHttpError &&
			(error.status === 400 || error.status === 404)
		) {
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

function artistCreditToText(credits: MusicBrainzArtistCredit[] | undefined): string | undefined {
	const parts = (credits ?? [])
		.map((credit) => sanitizeTagValue(credit.name ?? credit.artist?.name))
		.filter((value): value is string => Boolean(value));
	if (parts.length === 0) {
		return undefined;
	}
	return parts.join('');
}

function clampReleaseSearchLimit(value: number | undefined): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 12;
	return Math.max(1, Math.min(25, Math.trunc(parsed)));
}

function scoreReleaseCandidate(
	release: MusicBrainzRelease,
	params: MusicBrainzReleaseSearchParams
): number {
	const trackLike: MusicBrainzLookupTrack = {
		artist: { name: params.artistName },
		album: {
			title: params.albumTitle,
			releaseDate: params.releaseDate,
			upc: params.upc
		}
	};
	let score = scoreRelease(trackLike, release);
	const expectedArtist = normalizeToken(params.artistName);
	if (expectedArtist) {
		const artistMatch = (release['artist-credit'] ?? []).some((credit) => {
			const creditName = normalizeToken(credit.artist?.name ?? credit.name);
			return creditName === expectedArtist;
		});
		if (artistMatch) {
			score += 90;
		}
	}
	const expectedUpc = normalizeLookupText(params.upc);
	if (expectedUpc && normalizeLookupText(release.barcode) === expectedUpc) {
		score += 160;
	}
	return score;
}

export async function searchMusicBrainzReleases(
	params: MusicBrainzReleaseSearchParams
): Promise<MusicBrainzReleaseCandidate[]> {
	const albumTitle = normalizeLookupText(params.albumTitle);
	const artistName = normalizeLookupText(params.artistName);
	const releaseYear = yearFromDate(params.releaseDate);
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
	const limit = clampReleaseSearchLimit(params.limit);
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
	return releases.map((release) => ({
		id: normalizeReleaseId(release.id) as string,
		title: sanitizeTagValue(release.title),
		artistCredit: artistCreditToText(release['artist-credit']),
		status: sanitizeTagValue(release.status),
		country: sanitizeTagValue(release.country),
		date: sanitizeTagValue(release.date),
		trackCount: releaseTrackCount(release),
		barcode: sanitizeTagValue(release.barcode),
		releaseGroupId: sanitizeTagValue(release['release-group']?.id),
		primaryType: sanitizeTagValue(release['release-group']?.['primary-type']),
		secondaryTypes: (release['release-group']?.['secondary-types'] ?? [])
			.map((value) => sanitizeTagValue(value))
			.filter((value): value is string => Boolean(value))
	}));
}

function hasRecordingIsrc(recording: MusicBrainzRecording, expectedIsrc: string): boolean {
	if (!expectedIsrc) return false;
	return (recording.isrcs ?? []).some((value) => normalizeIsrc(value) === expectedIsrc);
}

interface PreferredReleaseTrackCandidate {
	recording: MusicBrainzRecording;
	mediumPosition?: number;
	trackPosition?: number;
	absoluteTrackPosition?: number;
}

function parseTrackPosition(value: unknown): number | undefined {
	const direct = coercePositiveInt(value);
	if (direct) {
		return direct;
	}
	if (typeof value !== 'string') {
		return undefined;
	}
	const normalized = value.trim();
	if (!normalized) {
		return undefined;
	}
	const slashMatch = /^(\d{1,3})\s*\/\s*\d{1,3}$/.exec(normalized);
	if (slashMatch) {
		return coercePositiveInt(slashMatch[1]);
	}
	const trailingDigits = /(\d{1,3})$/.exec(normalized);
	if (trailingDigits) {
		return coercePositiveInt(trailingDigits[1]);
	}
	return undefined;
}

function compactReleaseMetadata(release: MusicBrainzRelease): MusicBrainzRelease {
	return {
		id: sanitizeTagValue(release.id),
		title: sanitizeTagValue(release.title),
		status: sanitizeTagValue(release.status),
		country: sanitizeTagValue(release.country),
		date: sanitizeTagValue(release.date),
		'track-count': releaseTrackCount(release),
		barcode: sanitizeTagValue(release.barcode),
		'artist-credit': release['artist-credit'],
		'release-group': release['release-group']
	};
}

function withPreferredRelease(
	recording: MusicBrainzRecording,
	preferredRelease: MusicBrainzRelease
): MusicBrainzRecording {
	const preferredId = normalizeReleaseId(preferredRelease.id);
	const compactRelease = compactReleaseMetadata(preferredRelease);
	const remaining = (recording.releases ?? []).filter(
		(release) => normalizeReleaseId(release.id) !== preferredId
	);
	return {
		...recording,
		releases: [compactRelease, ...remaining]
	};
}

function collectPreferredReleaseTrackCandidates(
	release: MusicBrainzRelease
): PreferredReleaseTrackCandidate[] {
	const candidates: PreferredReleaseTrackCandidate[] = [];
	const compactRelease = compactReleaseMetadata(release);
	for (const [mediumIndex, medium] of (release.media ?? []).entries()) {
		const mediumPosition = parseTrackPosition(medium.position) ?? mediumIndex + 1;
		const trackOffset = coercePositiveInt(medium['track-offset']) ?? 0;
		for (const [trackIndex, releaseTrack] of (medium.tracks ?? []).entries()) {
			const trackPosition =
				parseTrackPosition(releaseTrack.position ?? releaseTrack.number) ?? trackIndex + 1;
			const absoluteTrackPosition = trackOffset + trackPosition;
			const recordingBase = releaseTrack.recording;
			if (!recordingBase && !releaseTrack.title) {
				continue;
			}
			const recording: MusicBrainzRecording = withPreferredRelease(
				{
					...(recordingBase ?? {}),
					title: sanitizeTagValue(recordingBase?.title ?? releaseTrack.title),
					'artist-credit': recordingBase?.['artist-credit'] ?? release['artist-credit'],
					releases: recordingBase?.releases ?? [compactRelease]
				},
				release
			);
			candidates.push({
				recording,
				mediumPosition,
				trackPosition,
				absoluteTrackPosition
			});
		}
	}
	return candidates;
}

function chooseRecordingFromPreferredRelease(
	track: MusicBrainzLookupTrack,
	preferredRelease: MusicBrainzRelease,
	strictIsrcMatch: boolean
): MusicBrainzRecording | null {
	const candidates = collectPreferredReleaseTrackCandidates(preferredRelease);
	if (candidates.length === 0) {
		return null;
	}
	const expectedIsrc = normalizeIsrc(track.isrc);
	const expectedTitle = normalizeToken(track.title);
	const expectedArtist = normalizeToken(track.artist?.name ?? track.artists?.[0]?.name);
	const expectedTrackNumber = coercePositiveInt(track.trackNumber);
	const expectedVolumeNumber = coercePositiveInt(track.volumeNumber);
	let best: MusicBrainzRecording | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;

	for (const candidate of candidates) {
		let score = Number(candidate.recording.score ?? 0) || 0;
		const recordingIsrcs = new Set(
			(candidate.recording.isrcs ?? [])
				.map((value) => normalizeIsrc(value))
				.filter((value): value is string => value !== null)
		);
		const hasIsrcMatch = expectedIsrc ? recordingIsrcs.has(expectedIsrc) : false;
		if (strictIsrcMatch && expectedIsrc && !hasIsrcMatch) {
			continue;
		}
		if (expectedIsrc) {
			score += hasIsrcMatch ? 1000 : -350;
		}

		const hasTrackNumberMatch =
			Boolean(expectedTrackNumber) &&
			(candidate.trackPosition === expectedTrackNumber ||
				candidate.absoluteTrackPosition === expectedTrackNumber);
		if (expectedTrackNumber) {
			score += hasTrackNumberMatch ? 260 : -95;
		}

		if (expectedVolumeNumber && candidate.mediumPosition) {
			score += candidate.mediumPosition === expectedVolumeNumber ? 180 : -80;
		}

		const recordingTitle = normalizeToken(candidate.recording.title);
		let hasTitleMatch = false;
		if (expectedTitle && recordingTitle) {
			if (recordingTitle === expectedTitle) {
				score += 220;
				hasTitleMatch = true;
			} else if (
				recordingTitle.includes(expectedTitle) ||
				expectedTitle.includes(recordingTitle)
			) {
				score += 110;
				hasTitleMatch = true;
			}
		}

		if (expectedArtist) {
			const artistMatch = (candidate.recording['artist-credit'] ?? []).some((credit) => {
				const artistName = normalizeToken(credit.artist?.name ?? credit.name);
				return artistName === expectedArtist;
			});
			if (artistMatch) {
				score += 75;
			}
		}

		if (!hasIsrcMatch && !hasTrackNumberMatch && !hasTitleMatch) {
			continue;
		}
		if (score > bestScore) {
			best = candidate.recording;
			bestScore = score;
		}
	}

	return best;
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
	const preferredReleaseId = normalizeReleaseId(options?.preferredReleaseId);
	const trackIsrc = normalizeIsrc(track.isrc);
	const normalizedTitle = normalizeLookupText(track.title);
	const normalizedArtistName = normalizeLookupText(track.artist?.name ?? track.artists?.[0]?.name);
	const hasTitle = normalizedTitle.length > 0;
	const hasTitleAndArtist = hasTitle && normalizedArtistName.length > 0;
	const hasTrackNumber = Boolean(coercePositiveInt(track.trackNumber));
	const hasLookupInput = preferredReleaseId
		? Boolean(trackIsrc) || hasTitle || hasTrackNumber
		: Boolean(trackIsrc) || hasTitleAndArtist;

	if (!hasLookupInput) {
		writeCache(cacheKey, {});
		return {};
	}

	if (strictIsrcMatch && !trackIsrc) {
		writeCache(cacheKey, {});
		return {};
	}

	try {
		if (preferredReleaseId) {
			const preferredRelease = await fetchPreferredReleaseById(preferredReleaseId);
			if (!preferredRelease) {
				writeCache(cacheKey, {});
				return {};
			}
			const preferredRecording = chooseRecordingFromPreferredRelease(
				track,
				preferredRelease,
				strictIsrcMatch
			);
			if (!preferredRecording) {
				writeCache(cacheKey, {});
				return {};
			}
			const tags = buildMusicBrainzTags(track, preferredRecording, {
				...options,
				preferredReleaseId
			});
			writeCache(cacheKey, tags);
			return tags;
		}

		const recordingsById = new Map<string, MusicBrainzRecording>();

		if (trackIsrc) {
			for (const recording of await fetchByIsrc(trackIsrc)) {
				if (!recording.id) continue;
				recordingsById.set(recording.id, recording);
			}
		}

		if (!strictIsrcMatch) {
			// Run a title/artist query as a fallback and score booster.
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

		const candidates = strictIsrcMatch && trackIsrc
			? Array.from(recordingsById.values()).filter((recording) =>
					hasRecordingIsrc(recording, trackIsrc)
				)
			: Array.from(recordingsById.values());
		if (candidates.length === 0) {
			writeCache(cacheKey, {});
			return {};
		}

		const bestRecording = chooseBestRecording(track, candidates, {
			...options,
			preferredReleaseId
		});
		if (!bestRecording) {
			writeCache(cacheKey, {});
			return {};
		}

		const tags = buildMusicBrainzTags(track, bestRecording, {
			...options,
			preferredReleaseId
		});
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
