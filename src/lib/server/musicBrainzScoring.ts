import type {
	MusicBrainzArtistCandidate,
	MusicBrainzArtistResult,
	MusicBrainzArtistSearchParams,
	MusicBrainzArtistCredit,
	MusicBrainzLookupOptions,
	MusicBrainzLookupTrack,
	MusicBrainzRecording,
	MusicBrainzRelease,
	MusicBrainzReleaseCandidate,
	MusicBrainzReleaseSearchParams
} from './musicBrainzTypes';
import {
	addTag,
	artistCreditToText,
	clampMusicBrainzSearchLimit,
	coercePositiveInt,
	dedupeStrings,
	normalizeIsrc,
	normalizeLookupText,
	normalizeReleaseId,
	normalizeToken,
	releaseTrackCount,
	sanitizeTagValue,
	yearFromDate
} from './musicBrainzHelpers';

export function scoreRelease(
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

export function chooseBestRecording(
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

export function buildMusicBrainzTags(
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

export function scoreReleaseCandidate(
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

export function scoreArtistCandidate(
	artist: MusicBrainzArtistResult,
	params: MusicBrainzArtistSearchParams
): number {
	const expectedArtistName = normalizeToken(params.artistName);
	const candidateName = normalizeToken(artist.name);
	let score = Number(artist.score ?? 0) || 0;
	if (!expectedArtistName || !candidateName) {
		return score;
	}
	if (candidateName === expectedArtistName) {
		score += 180;
	} else if (
		candidateName.includes(expectedArtistName) ||
		expectedArtistName.includes(candidateName)
	) {
		score += 70;
	}
	return score;
}

export function mapReleaseCandidate(release: MusicBrainzRelease): MusicBrainzReleaseCandidate {
	return {
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
	};
}

export function mapArtistCandidate(artist: MusicBrainzArtistResult): MusicBrainzArtistCandidate {
	return {
		id: normalizeReleaseId(artist.id) as string,
		name: sanitizeTagValue(artist.name),
		type: sanitizeTagValue(artist.type),
		country: sanitizeTagValue(artist.country),
		area: sanitizeTagValue(artist.area?.name),
		disambiguation: sanitizeTagValue(artist.disambiguation),
		lifeSpanBegin: sanitizeTagValue(artist['life-span']?.begin),
		lifeSpanEnd: sanitizeTagValue(artist['life-span']?.end),
		score: Number.isFinite(Number(artist.score)) ? Math.trunc(Number(artist.score)) : undefined
	};
}

export function clampSearchLimit(limit: number | undefined): number {
	return clampMusicBrainzSearchLimit(limit);
}

export function hasRecordingIsrc(recording: MusicBrainzRecording, expectedIsrc: string): boolean {
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

export function chooseRecordingFromPreferredRelease(
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
