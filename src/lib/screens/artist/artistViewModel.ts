import {
	buildArtistArtworkVm
} from '$lib/presentation/catalogPresentation';
import {
	buildDetailFact,
	buildDetailIconMeta,
	buildDetailLink,
	formatReleaseYear
} from '$lib/presentation/detailPresentation';
import type {
	DetailFactVM,
	DetailHeroVM,
	DetailLinkVM,
	StateNoticeVM
} from '$lib/presentation/viewModels';
import type {
	Album,
	ArtistDetails,
	AudioQuality
} from '$lib/types';
import type { MusicBrainzArtistOption } from '$lib/features/artist/artistMusicBrainzController';
import { formatMusicBrainzArtistLifeSpan } from '$lib/features/artist/artistMusicBrainzController';
import type { ArtistAlbumDownloadState } from '$lib/features/artist/artistAlbumQueueController';
import type { FeaturedDiscographyAlbum } from '$lib/features/artist/artistDiscographyModel';
import { scoreAlbumForSelection } from '$lib/utils/albumSelection';
import { sortTopTracks } from '$lib/utils/topTracks';

export type ArtistDiscographyFilterKey =
	| 'album'
	| 'ep'
	| 'single'
	| 'live'
	| 'remaster'
	| 'explicit'
	| 'clean';

export type ArtistDiscographyFilterState = Record<ArtistDiscographyFilterKey, boolean>;

export const DEFAULT_ARTIST_DISCOGRAPHY_FILTER_STATE: ArtistDiscographyFilterState = {
	album: true,
	ep: true,
	single: true,
	live: true,
	remaster: true,
	explicit: true,
	clean: true
};

export type ArtistMusicBrainzSectionVM = {
	options: Array<{
		id: string;
		label: string;
	}>;
	facts: DetailFactVM[];
	notices: StateNoticeVM[];
	links: DetailLinkVM[];
	selectedArtistId: string;
	hasSelection: boolean;
};

export type ArtistScreenAlbumDownloadState = ArtistAlbumDownloadState;
export type ArtistFeaturedDiscographyAlbum = FeaturedDiscographyAlbum;

function parseNumericId(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

export function normalizeArtistDetails(data: ArtistDetails): ArtistDetails {
	const normalizedAlbumsInput = Array.isArray(data.albums) ? data.albums : [];
	const dedupedAlbums = new Map<number, Album>();
	for (const album of normalizedAlbumsInput) {
		const parsedId = parseNumericId((album as { id?: unknown }).id);
		if (parsedId === null) continue;
		const normalizedAlbum = { ...album, id: parsedId };
		const existing = dedupedAlbums.get(parsedId);
		if (!existing || scoreAlbumForSelection(normalizedAlbum) > scoreAlbumForSelection(existing)) {
			dedupedAlbums.set(parsedId, normalizedAlbum);
		}
	}

	const normalizedTracksInput = Array.isArray(data.tracks) ? data.tracks : [];
	const dedupedTracks = new Map<number, (typeof normalizedTracksInput)[number]>();
	for (const track of normalizedTracksInput) {
		const parsedId = parseNumericId((track as { id?: unknown }).id);
		if (parsedId === null) continue;
		if (!dedupedTracks.has(parsedId)) {
			dedupedTracks.set(parsedId, { ...track, id: parsedId });
		}
	}

	return {
		...data,
		albums: Array.from(dedupedAlbums.values()),
		tracks: sortTopTracks(Array.from(dedupedTracks.values()), 100)
	};
}

export function toggleArtistDiscographyFilterState(
	state: ArtistDiscographyFilterState,
	key: ArtistDiscographyFilterKey
): ArtistDiscographyFilterState {
	const nextState = {
		...state,
		[key]: !state[key]
	};
	if ((key === 'explicit' || key === 'clean') && !nextState.explicit && !nextState.clean) {
		nextState[key === 'explicit' ? 'clean' : 'explicit'] = true;
	}
	return nextState;
}

export function formatArtistAlbumMeta(album: Album): string | null {
	const parts: string[] = [];
	const year = formatReleaseYear(album.releaseDate ?? null);
	if (year) parts.push(year);
	if (album.type) parts.push(album.type.replace(/_/g, ' '));
	if (album.numberOfTracks) parts.push(`${album.numberOfTracks} tracks`);
	return parts.length > 0 ? parts.join(' • ') : null;
}

export function formatArtistQualityLabel(quality: AudioQuality): string {
	switch (quality) {
		case 'HI_RES_LOSSLESS':
			return 'Hi-Res';
		case 'LOSSLESS':
			return 'Lossless';
		case 'HIGH':
			return 'High';
		case 'LOW':
			return 'Low';
		default:
			return quality;
	}
}

export function displayArtistTrackTotal(total?: number | null): number {
	if (!Number.isFinite(total)) return 0;
	return total && total > 0 ? total : (total ?? 0);
}

export function buildArtistSectionNavItems(options: {
	hasRecommendationRail: boolean;
	hasHighlightsSection: boolean;
}) {
	const items = [
		{ id: 'artist-metadata', label: 'MusicBrainz', tone: 'tertiary' as const },
		{ id: 'artist-top-tracks', label: 'Top Tracks' }
	];
	if (options.hasRecommendationRail) {
		items.push({ id: 'artist-recommendations', label: 'Recommendations', tone: 'tertiary' as const });
	}
	if (options.hasHighlightsSection) {
		items.push({ id: 'artist-highlights', label: 'Highlights' });
	}
	items.push({ id: 'artist-discography', label: 'Discography' });
	return items;
}

export function buildArtistHeroViewModel(
	artist: ArtistDetails,
	artistImage: string | null
): DetailHeroVM {
	return {
		eyebrow: 'Artist',
		title: artist.name,
		visual: {
			kind: 'artwork',
			artwork: {
				...buildArtistArtworkVm(artist.picture, artist.name),
				src: artistImage
			}
		},
		metaItems: [
			typeof artist.popularity === 'number'
				? buildDetailIconMeta('user', `Popularity ${artist.popularity}`)
				: null,
			...(artist.artistTypes ?? []).map((type) => buildDetailIconMeta('user', type)),
			...(artist.artistRoles ?? []).map((role) => buildDetailIconMeta('user', role.category))
		].filter((item): item is NonNullable<typeof item> => Boolean(item))
	};
}

export function buildArtistMusicBrainzSectionViewModel(options: {
	candidates: MusicBrainzArtistOption[];
	selectedArtistId: string;
	selectedArtist: MusicBrainzArtistOption | null;
	isLoading: boolean;
	hasAttempted: boolean;
	error: string | null;
}): ArtistMusicBrainzSectionVM {
	const notices: StateNoticeVM[] = [];
	if (options.isLoading && options.candidates.length === 0) {
		notices.push({
			tone: 'info',
			message: 'Searching MusicBrainz artists…'
		});
	} else if (options.isLoading) {
		notices.push({
			tone: 'info',
			message: 'Refreshing MusicBrainz artist match…'
		});
	} else if (options.hasAttempted && options.candidates.length === 0) {
		notices.push({
			tone: 'neutral',
			message: 'No MusicBrainz artist match found for this artist.'
		});
	}
	if (options.selectedArtist?.disambiguation) {
		notices.push({
			tone: 'neutral',
			message: options.selectedArtist.disambiguation,
			liveRegion: 'off'
		});
	}
	if (options.error) {
		notices.push({
			tone: 'error',
			message: options.error
		});
	}

	const facts = [
		buildDetailFact('Type', options.selectedArtist?.type),
		buildDetailFact('Country', options.selectedArtist?.country),
		buildDetailFact('Area', options.selectedArtist?.area),
		buildDetailFact('Life Span', options.selectedArtist ? formatMusicBrainzArtistLifeSpan(options.selectedArtist) : null),
		buildDetailFact(
			'Match Score',
			typeof options.selectedArtist?.score === 'number' ? `${options.selectedArtist.score}/100` : null
		)
	].filter((fact): fact is DetailFactVM => Boolean(fact));

	const links =
		options.selectedArtist
			? [
					buildDetailLink({
						id: `musicbrainz-artist-${options.selectedArtist.id}`,
						label: 'Open artist in MusicBrainz',
						href: `https://musicbrainz.org/artist/${options.selectedArtist.id}`,
						ariaLabel: 'Open artist in MusicBrainz in a new tab',
						external: true
					})
				]
			: [];

	return {
		options: options.candidates.map((candidate, index) => ({
			id: candidate.id,
			label: `${index === 0 ? 'Best Match - ' : ''}${candidate.name || 'Unnamed artist'}${candidate.country ? ` · ${candidate.country}` : ''}${candidate.type ? ` · ${candidate.type}` : ''}`
		})),
		facts,
		notices,
		links,
		selectedArtistId: options.selectedArtistId,
		hasSelection: Boolean(options.selectedArtist)
	};
}

export function buildArtistRecommendationAlbumMeta(album: Album): string | null {
	return formatArtistAlbumMeta(album);
}

export function buildArtistRecommendationRailState(options: {
	recommendationsLoading: boolean;
	recommendationsError: string | null;
	recommendedArtistsCount: number;
	recommendedAlbumsCount: number;
}): boolean {
	return (
		options.recommendationsLoading ||
		Boolean(options.recommendationsError) ||
		options.recommendedArtistsCount > 0 ||
		options.recommendedAlbumsCount > 0
	);
}
