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

export interface MusicBrainzArtistSearchParams {
	artistName?: string;
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

export interface MusicBrainzArtistCandidate {
	id: string;
	name?: string;
	type?: string;
	country?: string;
	area?: string;
	disambiguation?: string;
	lifeSpanBegin?: string;
	lifeSpanEnd?: string;
	score?: number;
}

export interface MusicBrainzArtist {
	id?: string;
	name?: string;
}

export interface MusicBrainzArtistCredit {
	artist?: MusicBrainzArtist;
	name?: string;
}

export interface MusicBrainzReleaseGroup {
	id?: string;
	title?: string;
	'primary-type'?: string;
	'secondary-types'?: string[];
}

export interface MusicBrainzReleaseTrack {
	id?: string;
	number?: string;
	position?: number | string;
	title?: string;
	length?: number | string;
	recording?: MusicBrainzRecording;
}

export interface MusicBrainzMedium {
	position?: number | string;
	title?: string;
	'track-count'?: number | string;
	trackCount?: number | string;
	'track-offset'?: number | string;
	tracks?: MusicBrainzReleaseTrack[];
}

export interface MusicBrainzRelease {
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

export interface MusicBrainzRecording {
	id?: string;
	title?: string;
	score?: number | string;
	isrcs?: string[];
	'artist-credit'?: MusicBrainzArtistCredit[];
	releases?: MusicBrainzRelease[];
}

export interface MusicBrainzRecordingSearchResponse {
	recordings?: MusicBrainzRecording[];
}

export interface MusicBrainzIsrcLookupResponse {
	recordings?: MusicBrainzRecording[];
}

export interface MusicBrainzReleaseSearchResponse {
	releases?: MusicBrainzRelease[];
}

export interface MusicBrainzArea {
	name?: string;
}

export interface MusicBrainzLifeSpan {
	begin?: string;
	end?: string;
}

export interface MusicBrainzArtistResult {
	id?: string;
	name?: string;
	type?: string;
	country?: string;
	disambiguation?: string;
	score?: number | string;
	area?: MusicBrainzArea;
	'life-span'?: MusicBrainzLifeSpan;
}

export interface MusicBrainzArtistSearchResponse {
	artists?: MusicBrainzArtistResult[];
}
