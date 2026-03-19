export type MusicBrainzLookupStatus = 'matched' | 'no_match' | 'lookup_failed';

export type MusicBrainzEntityArtist = {
	id: string;
	name?: string;
};

export type MusicBrainzEntityReleaseGroup = {
	id: string;
	title?: string;
	primaryType?: string;
	secondaryTypes?: string[];
};

export type MusicBrainzEntityRecording = {
	id: string;
	title?: string;
	artistCredit?: string;
	artists: MusicBrainzEntityArtist[];
};

export type MusicBrainzEntityRelease = {
	id: string;
	title?: string;
	artistCredit?: string;
	status?: string;
	country?: string;
	date?: string;
	barcode?: string;
	artists: MusicBrainzEntityArtist[];
	releaseGroup: MusicBrainzEntityReleaseGroup | null;
};

export type MusicBrainzTrackMatchDetails = {
	recording: MusicBrainzEntityRecording;
	release: MusicBrainzEntityRelease | null;
	releaseGroup: MusicBrainzEntityReleaseGroup | null;
	artists: MusicBrainzEntityArtist[];
	albumArtists: MusicBrainzEntityArtist[];
};

export type CachedMusicBrainzTrackLookup = {
	lookupStatus: Extract<MusicBrainzLookupStatus, 'matched' | 'no_match'>;
	tags: Record<string, string>;
	match: MusicBrainzTrackMatchDetails | null;
};

export type MusicBrainzTrackLookupResponse = {
	success: boolean;
	lookupStatus: MusicBrainzLookupStatus;
	tags: Record<string, string>;
	tagCount: number;
	match: MusicBrainzTrackMatchDetails | null;
	error?: string;
};

export type TrackMusicBrainzFact = {
	label: string;
	value: string;
};

export type TrackMusicBrainzLink = {
	label: string;
	href: string;
};

export type TrackMusicBrainzPartyLink = {
	id: string;
	label: string;
	href: string;
};

export type TrackMusicBrainzViewModel = {
	status: MusicBrainzLookupStatus;
	errorMessage: string | null;
	facts: TrackMusicBrainzFact[];
	links: TrackMusicBrainzLink[];
	artistLinks: TrackMusicBrainzPartyLink[];
	albumArtistLinks: TrackMusicBrainzPartyLink[];
};

function sanitizeString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function sanitizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((entry) => sanitizeString(entry))
		.filter((entry): entry is string => Boolean(entry));
}

function normalizeArtist(value: unknown): MusicBrainzEntityArtist | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const id = sanitizeString(record.id);
	if (!id) {
		return null;
	}
	return {
		id,
		name: sanitizeString(record.name)
	};
}

function normalizeArtists(value: unknown): MusicBrainzEntityArtist[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((entry) => normalizeArtist(entry))
		.filter((entry): entry is MusicBrainzEntityArtist => Boolean(entry));
}

function normalizeReleaseGroup(value: unknown): MusicBrainzEntityReleaseGroup | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const id = sanitizeString(record.id);
	if (!id) {
		return null;
	}
	return {
		id,
		title: sanitizeString(record.title),
		primaryType: sanitizeString(record.primaryType),
		secondaryTypes: sanitizeStringArray(record.secondaryTypes)
	};
}

function normalizeRecording(value: unknown): MusicBrainzEntityRecording | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const id = sanitizeString(record.id);
	if (!id) {
		return null;
	}
	return {
		id,
		title: sanitizeString(record.title),
		artistCredit: sanitizeString(record.artistCredit),
		artists: normalizeArtists(record.artists)
	};
}

function normalizeRelease(value: unknown): MusicBrainzEntityRelease | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const id = sanitizeString(record.id);
	if (!id) {
		return null;
	}
	return {
		id,
		title: sanitizeString(record.title),
		artistCredit: sanitizeString(record.artistCredit),
		status: sanitizeString(record.status),
		country: sanitizeString(record.country),
		date: sanitizeString(record.date),
		barcode: sanitizeString(record.barcode),
		artists: normalizeArtists(record.artists),
		releaseGroup: normalizeReleaseGroup(record.releaseGroup)
	};
}

function normalizeMatch(value: unknown): MusicBrainzTrackMatchDetails | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const recording = normalizeRecording(record.recording);
	if (!recording) {
		return null;
	}
	const release = normalizeRelease(record.release);
	const releaseGroup = normalizeReleaseGroup(record.releaseGroup);
	return {
		recording,
		release,
		releaseGroup,
		artists: normalizeArtists(record.artists),
		albumArtists: normalizeArtists(record.albumArtists)
	};
}

function normalizeTags(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	const tags: Record<string, string> = {};
	for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
		const normalizedKey = sanitizeString(key);
		const normalizedValue = sanitizeString(rawValue);
		if (!normalizedKey || !normalizedValue) {
			continue;
		}
		tags[normalizedKey] = normalizedValue;
	}
	return tags;
}

export function normalizeTrackMusicBrainzLookupResponse(
	value: unknown
): MusicBrainzTrackLookupResponse | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const lookupStatus =
		record.lookupStatus === 'matched' ||
		record.lookupStatus === 'no_match' ||
		record.lookupStatus === 'lookup_failed'
			? record.lookupStatus
			: null;
	if (!lookupStatus) {
		return null;
	}

	const tags = normalizeTags(record.tags);
	const match = normalizeMatch(record.match);
	const explicitTagCount = Number(record.tagCount);

	return {
		success: record.success !== false,
		lookupStatus,
		tags,
		tagCount:
			Number.isFinite(explicitTagCount) && explicitTagCount >= 0
				? Math.trunc(explicitTagCount)
				: Object.keys(tags).length,
		match,
		error: sanitizeString(record.error)
	};
}

function formatReleaseGroupType(releaseGroup: MusicBrainzEntityReleaseGroup | null): string | null {
	if (!releaseGroup) {
		return null;
	}
	const parts = [releaseGroup.primaryType, ...(releaseGroup.secondaryTypes ?? [])].filter(
		(value): value is string => Boolean(value)
	);
	if (parts.length === 0) {
		return null;
	}
	return parts.join(' / ');
}

function buildEntityUrl(
	entity: 'recording' | 'release' | 'release-group' | 'artist',
	id: string
): string {
	return `https://musicbrainz.org/${entity}/${id}`;
}

function buildPartyLinks(artists: MusicBrainzEntityArtist[]): TrackMusicBrainzPartyLink[] {
	const seen = new Set<string>();
	const links: TrackMusicBrainzPartyLink[] = [];
	for (const artist of artists) {
		if (seen.has(artist.id)) {
			continue;
		}
		seen.add(artist.id);
		links.push({
			id: artist.id,
			label: artist.name ?? artist.id,
			href: buildEntityUrl('artist', artist.id)
		});
	}
	return links;
}

function samePartySet(
	left: TrackMusicBrainzPartyLink[],
	right: TrackMusicBrainzPartyLink[]
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((entry, index) => entry.id === right[index]?.id);
}

export function buildTrackMusicBrainzViewModel(
	response: MusicBrainzTrackLookupResponse | null
): TrackMusicBrainzViewModel {
	if (!response) {
		return {
			status: 'no_match',
			errorMessage: null,
			facts: [],
			links: [],
			artistLinks: [],
			albumArtistLinks: []
		};
	}

	if (response.lookupStatus !== 'matched' || !response.match) {
		return {
			status: response.lookupStatus,
			errorMessage:
				response.lookupStatus === 'lookup_failed'
					? (response.error ?? 'MusicBrainz metadata could not be loaded right now.')
					: null,
			facts: [],
			links: [],
			artistLinks: [],
			albumArtistLinks: []
		};
	}

	const { recording, release, releaseGroup } = response.match;
	const facts: TrackMusicBrainzFact[] = [];
	const links: TrackMusicBrainzLink[] = [];
	const artistLinks = buildPartyLinks(response.match.artists);
	const albumArtistLinks = buildPartyLinks(response.match.albumArtists);

	facts.push({
		label: 'Recording',
		value: recording.title ?? recording.id
	});
	facts.push({
		label: 'Recording MBID',
		value: recording.id
	});
	if (recording.artistCredit) {
		facts.push({
			label: 'Recording Artist Credit',
			value: recording.artistCredit
		});
	}
	links.push({
		label: 'Open Recording',
		href: buildEntityUrl('recording', recording.id)
	});

	if (release) {
		facts.push({
			label: 'Release',
			value: release.title ?? release.id
		});
		if (release.artistCredit) {
			facts.push({
				label: 'Release Artist Credit',
				value: release.artistCredit
			});
		}
		if (release.date) {
			facts.push({
				label: 'Release Date',
				value: release.date
			});
		}
		if (release.country) {
			facts.push({
				label: 'Release Country',
				value: release.country
			});
		}
		if (release.status) {
			facts.push({
				label: 'Release Status',
				value: release.status
			});
		}
		if (release.barcode) {
			facts.push({
				label: 'Barcode',
				value: release.barcode
			});
		}
		facts.push({
			label: 'Release MBID',
			value: release.id
		});
		links.push({
			label: 'Open Release',
			href: buildEntityUrl('release', release.id)
		});
	}

	if (releaseGroup) {
		facts.push({
			label: 'Release Group',
			value: releaseGroup.title ?? releaseGroup.id
		});
		const releaseGroupType = formatReleaseGroupType(releaseGroup);
		if (releaseGroupType) {
			facts.push({
				label: 'Release Group Type',
				value: releaseGroupType
			});
		}
		facts.push({
			label: 'Release Group MBID',
			value: releaseGroup.id
		});
		links.push({
			label: 'Open Release Group',
			href: buildEntityUrl('release-group', releaseGroup.id)
		});
	}

	const displayAlbumArtistLinks = samePartySet(artistLinks, albumArtistLinks)
		? []
		: albumArtistLinks;

	return {
		status: response.lookupStatus,
		errorMessage: null,
		facts,
		links,
		artistLinks,
		albumArtistLinks: displayAlbumArtistLinks
	};
}
