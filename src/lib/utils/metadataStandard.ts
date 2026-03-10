import type { TrackLookup } from '../types';
import { formatArtistsForMetadata } from './formatters';
import { buildTrackDiscMetadataEntries } from './trackDiscMetadata';

export interface MetadataBuildOverrides {
	albumTitle?: string;
	albumArtist?: string;
	trackNumber?: number;
	totalTracks?: number;
	discNumber?: number;
	totalDiscs?: number;
}

export const STANDARD_METADATA_KEY_ORDER = [
	'title',
	'artist',
	'album_artist',
	'album',
	'track',
	'TRACKTOTAL',
	'disc',
	'DISCTOTAL',
	'date',
	'year',
	'ISRC',
	'BARCODE',
	'copyright',
	'REPLAYGAIN_TRACK_GAIN',
	'REPLAYGAIN_TRACK_PEAK',
	'REPLAYGAIN_ALBUM_GAIN',
	'REPLAYGAIN_ALBUM_PEAK',
	'comment',
	'MUSICBRAINZ_TRACKID',
	'MUSICBRAINZ_ARTISTID',
	'MUSICBRAINZ_ALBUMARTISTID',
	'MUSICBRAINZ_ALBUMID',
	'MUSICBRAINZ_RELEASEGROUPID',
	'MUSICBRAINZ_RELEASESTATUS',
	'MUSICBRAINZ_RELEASETYPE',
	'MUSICBRAINZ_RELEASECOUNTRY'
] as const;

export type StandardMetadataKey = (typeof STANDARD_METADATA_KEY_ORDER)[number];

const STANDARD_METADATA_KEY_SET = new Set<string>(STANDARD_METADATA_KEY_ORDER as readonly string[]);
const MAX_METADATA_VALUE_LENGTH = 1024;
const STANDARD_METADATA_COMMENT = 'Downloaded from music.binimum.org/tidal.squid.wtf';

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function normalizePositiveInteger(value: number | null | undefined): number | undefined {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return undefined;
	}
	return Math.trunc(parsed);
}

function sanitizeMetadataValue(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	// Remove control characters to prevent malformed tags or accidental multi-line values.
	const sanitized = value
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!sanitized) {
		return undefined;
	}
	return sanitized.slice(0, MAX_METADATA_VALUE_LENGTH);
}

function setMetadataValue(
	metadata: Partial<Record<StandardMetadataKey, string>>,
	key: StandardMetadataKey,
	value: unknown
): void {
	const sanitized = sanitizeMetadataValue(value);
	if (!sanitized) {
		return;
	}
	metadata[key] = sanitized;
}

export function isStandardMetadataKey(key: string): key is StandardMetadataKey {
	return STANDARD_METADATA_KEY_SET.has(key);
}

export function buildStandardMetadataEntries(
	lookup: TrackLookup,
	overrides?: MetadataBuildOverrides,
	extraMetadata?: Partial<Record<StandardMetadataKey, string>>
): Array<[StandardMetadataKey, string]> {
	const { track } = lookup;
	const album = track.album;
	const mainArtist = formatArtistsForMetadata(track.artists);
	const overrideAlbumTitle = sanitizeMetadataValue(overrides?.albumTitle);
	const overrideAlbumArtist = sanitizeMetadataValue(overrides?.albumArtist);
	const albumArtist =
		overrideAlbumArtist ??
		sanitizeMetadataValue(album?.artist?.name) ??
		sanitizeMetadataValue(album?.artists?.[0]?.name) ??
		sanitizeMetadataValue(track.artists?.[0]?.name);

	const metadata: Partial<Record<StandardMetadataKey, string>> = {};

	setMetadataValue(metadata, 'title', track.title);
	setMetadataValue(metadata, 'artist', mainArtist);
	setMetadataValue(metadata, 'album_artist', albumArtist);
	setMetadataValue(metadata, 'album', overrideAlbumTitle ?? album?.title);

	const trackNumberOverride = normalizePositiveInteger(overrides?.trackNumber);
	const totalTracksOverride = normalizePositiveInteger(overrides?.totalTracks);
	const discNumberOverride = normalizePositiveInteger(overrides?.discNumber);
	const totalDiscsOverride = normalizePositiveInteger(overrides?.totalDiscs);
	for (const [key, value] of buildTrackDiscMetadataEntries({
		trackNumber: trackNumberOverride ?? track.trackNumber,
		totalTracks: totalTracksOverride ?? album?.numberOfTracks,
		discNumber: discNumberOverride ?? track.volumeNumber,
		totalDiscs: totalDiscsOverride ?? album?.numberOfVolumes
	})) {
		if (isStandardMetadataKey(key)) {
			setMetadataValue(metadata, key, value);
		}
	}

	const releaseDate = album?.releaseDate ?? track.streamStartDate;
	if (releaseDate) {
		const yearMatch = /^(\d{4})/.exec(releaseDate);
		if (yearMatch?.[1]) {
			setMetadataValue(metadata, 'date', yearMatch[1]);
			setMetadataValue(metadata, 'year', yearMatch[1]);
		}
	}

	setMetadataValue(metadata, 'ISRC', track.isrc);
	setMetadataValue(metadata, 'BARCODE', album?.upc);
	setMetadataValue(metadata, 'copyright', album?.copyright);

	if (lookup.info) {
		const { trackReplayGain, trackPeakAmplitude, albumReplayGain, albumPeakAmplitude } =
			lookup.info;

		if (isFiniteNumber(trackReplayGain)) {
			setMetadataValue(metadata, 'REPLAYGAIN_TRACK_GAIN', `${trackReplayGain} dB`);
		}
		if (isFiniteNumber(trackPeakAmplitude)) {
			setMetadataValue(metadata, 'REPLAYGAIN_TRACK_PEAK', `${trackPeakAmplitude}`);
		}
		if (isFiniteNumber(albumReplayGain)) {
			setMetadataValue(metadata, 'REPLAYGAIN_ALBUM_GAIN', `${albumReplayGain} dB`);
		}
		if (isFiniteNumber(albumPeakAmplitude)) {
			setMetadataValue(metadata, 'REPLAYGAIN_ALBUM_PEAK', `${albumPeakAmplitude}`);
		}
	} else {
		if (isFiniteNumber(track.replayGain)) {
			setMetadataValue(metadata, 'REPLAYGAIN_TRACK_GAIN', `${track.replayGain} dB`);
		}
		if (isFiniteNumber(track.peak)) {
			setMetadataValue(metadata, 'REPLAYGAIN_TRACK_PEAK', `${track.peak}`);
		}
	}

	setMetadataValue(metadata, 'comment', STANDARD_METADATA_COMMENT);
	if (extraMetadata) {
		for (const [key, value] of Object.entries(extraMetadata)) {
			if (!isStandardMetadataKey(key)) continue;
			setMetadataValue(metadata, key, value);
		}
	}

	const entries: Array<[StandardMetadataKey, string]> = [];
	for (const key of STANDARD_METADATA_KEY_ORDER) {
		const value = metadata[key];
		if (value) {
			entries.push([key, value]);
		}
	}
	return entries;
}

export function buildStandardMetadataObject(
	lookup: TrackLookup,
	overrides?: MetadataBuildOverrides,
	extraMetadata?: Partial<Record<StandardMetadataKey, string>>
): Record<string, string> {
	return Object.fromEntries(buildStandardMetadataEntries(lookup, overrides, extraMetadata));
}
