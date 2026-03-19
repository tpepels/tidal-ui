import type {
	MusicBrainzArtistCredit,
	MusicBrainzLookupTrack,
	MusicBrainzRelease
} from './musicBrainzTypes';

const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const MBID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function replaceControlCharacters(value: string): string {
	let result = '';
	for (const char of value) {
		const code = char.charCodeAt(0);
		result += code < 32 || code === 127 ? ' ' : char;
	}
	return result;
}

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeQueryValue(value: string): string {
	return value.replace(/[\\"]/g, '\\$&');
}

export function normalizeLookupText(value: string | undefined | null): string {
	if (typeof value !== 'string') {
		return '';
	}
	return replaceControlCharacters(value).replace(/\s+/g, ' ').trim();
}

export function normalizeIsrc(value: string | undefined | null): string | null {
	const normalized = normalizeLookupText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
	if (!normalized || !ISRC_PATTERN.test(normalized)) {
		return null;
	}
	return normalized;
}

export function normalizeReleaseId(value: string | undefined | null): string | undefined {
	const normalized = normalizeLookupText(value).toLowerCase();
	if (!normalized || !MBID_PATTERN.test(normalized)) {
		return undefined;
	}
	return normalized;
}

export function normalizeToken(value: string | undefined | null): string {
	if (!value) return '';
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function yearFromDate(value: string | undefined | null): string | undefined {
	if (!value) return undefined;
	const match = /^(\d{4})/.exec(value.trim());
	return match?.[1];
}

export function sanitizeTagValue(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const sanitized = replaceControlCharacters(value).replace(/\s+/g, ' ').trim();
	if (!sanitized) return undefined;
	return sanitized.slice(0, 1024);
}

export function coercePositiveInt(value: unknown): number | undefined {
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

export function releaseTrackCount(release: MusicBrainzRelease): number | undefined {
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

export function addTag(target: Record<string, string>, key: string, value: unknown): void {
	const sanitized = sanitizeTagValue(value);
	if (!sanitized) return;
	target[key] = sanitized;
}

export function dedupeStrings(values: Array<string | undefined | null>): string[] {
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

export function artistCreditToText(
	credits: MusicBrainzArtistCredit[] | undefined
): string | undefined {
	const parts = (credits ?? [])
		.map((credit) => sanitizeTagValue(credit.name ?? credit.artist?.name))
		.filter((value): value is string => Boolean(value));
	if (parts.length === 0) {
		return undefined;
	}
	return parts.join('');
}

export function clampMusicBrainzSearchLimit(value: number | undefined): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 12;
	return Math.max(1, Math.min(25, Math.trunc(parsed)));
}

export function buildMusicBrainzCacheKey(
	track: MusicBrainzLookupTrack,
	options?: { strictIsrcMatch?: boolean; preferredReleaseId?: string }
): string {
	const mode = options?.strictIsrcMatch === true ? 'strict' : 'flex';
	const releaseKey = normalizeReleaseId(options?.preferredReleaseId) ?? 'auto';
	const isrc = normalizeIsrc(track.isrc);
	const trackNumber = coercePositiveInt(track.trackNumber) ?? 0;
	const volumeNumber = coercePositiveInt(track.volumeNumber) ?? 0;
	if (isrc) {
		return `${mode}:release:${releaseKey}:isrc:${isrc}:disc:${volumeNumber}:track:${trackNumber}`;
	}
	const trackTitle = normalizeToken(track.title);
	const artistName = normalizeToken(track.artist?.name ?? track.artists?.[0]?.name);
	const albumTitle = normalizeToken(track.album?.title);
	return `${mode}:release:${releaseKey}:query:${trackTitle}|${artistName}|${albumTitle}:disc:${volumeNumber}:track:${trackNumber}`;
}
