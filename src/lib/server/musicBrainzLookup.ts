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

const MUSICBRAINZ_API_BASE = 'https://musicbrainz.org/ws/2';
const MUSICBRAINZ_TIMEOUT_MS = 7_500;
const MUSICBRAINZ_MIN_INTERVAL_MS = 1_100;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 800;

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

const lookupCache = new Map<string, CacheEntry>();

let nextRequestAt = 0;
let requestChain: Promise<void> = Promise.resolve();

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeQueryValue(value: string): string {
	return value.replace(/[\\"]/g, '\\$&');
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

function buildCacheKey(track: MusicBrainzLookupTrack): string {
	const isrc = track.isrc?.trim().toUpperCase();
	if (isrc) {
		return `isrc:${isrc}`;
	}
	const trackTitle = normalizeToken(track.title);
	const artistName = normalizeToken(track.artist?.name ?? track.artists?.[0]?.name);
	const albumTitle = normalizeToken(track.album?.title);
	return `query:${trackTitle}|${artistName}|${albumTitle}`;
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
				throw new Error(`MusicBrainz HTTP ${response.status}`);
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
	const expectedIsrc = track.isrc?.trim().toUpperCase();
	const recordingIsrcs = new Set((recording.isrcs ?? []).map((value) => value.toUpperCase()));

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
	if (track.title) {
		parts.push(`recording:"${escapeQueryValue(track.title)}"`);
	}
	const artistName = track.artist?.name ?? track.artists?.[0]?.name;
	if (artistName) {
		parts.push(`artist:"${escapeQueryValue(artistName)}"`);
	}
	if (track.album?.title) {
		parts.push(`release:"${escapeQueryValue(track.album.title)}"`);
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

export async function lookupMusicBrainzTagsForTrack(
	track: MusicBrainzLookupTrack
): Promise<Record<string, string>> {
	const cacheKey = buildCacheKey(track);
	const cached = readCache(cacheKey);
	if (cached) {
		return cached;
	}

	const hasEnoughContext =
		typeof track.title === 'string' && track.title.trim().length > 0 &&
		typeof (track.artist?.name ?? track.artists?.[0]?.name) === 'string';
	if (!hasEnoughContext) {
		writeCache(cacheKey, {});
		return {};
	}

	try {
		const recordingsById = new Map<string, MusicBrainzRecording>();
		const trackIsrc = track.isrc?.trim().toUpperCase();

		if (trackIsrc) {
			for (const recording of await fetchByIsrc(trackIsrc)) {
				if (!recording.id) continue;
				recordingsById.set(recording.id, recording);
			}
		}

		// Always run a title/artist query as a fallback and score booster.
		for (const recording of await fetchBySearchQuery(track)) {
			if (!recording.id) continue;
			if (!recordingsById.has(recording.id)) {
				recordingsById.set(recording.id, recording);
			}
		}

		const candidates = Array.from(recordingsById.values());
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
		const message = error instanceof Error ? error.message : String(error);
		console.warn('[MusicBrainz] Metadata lookup failed:', message);
		writeCache(cacheKey, {});
		return {};
	}
}
