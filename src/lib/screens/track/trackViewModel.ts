import {
	buildAlbumArtworkVm,
	buildArtistArtworkVm,
	buildTrackArtworkVm,
	formatTrackDurationLabel
} from '$lib/presentation/catalogPresentation';
import {
	buildDetailButton,
	buildDetailIconMeta,
	buildDetailLink,
	buildDetailRelationRow
} from '$lib/presentation/detailPresentation';
import type {
	ActionButtonVM,
	DetailFactVM,
	DetailHeroVM,
	DetailLinkVM,
	StateNoticeVM
} from '$lib/presentation/viewModels';
import type { Track } from '$lib/types';
import type { TrackMusicBrainzViewModel } from '$lib/features/track/trackMusicBrainzModel';
import { formatArtists } from '$lib/utils/formatters';

export type TrackMusicBrainzSectionVM = {
	facts: DetailFactVM[];
	artistLinks: DetailLinkVM[];
	albumArtistLinks: DetailLinkVM[];
	links: DetailLinkVM[];
	identifierFacts: DetailFactVM[];
	notices: StateNoticeVM[];
};

export function buildTrackSectionNavItems() {
	return [
		{ id: 'track-actions', label: 'Actions', tone: 'secondary' as const },
		{ id: 'track-metadata', label: 'MusicBrainz', tone: 'tertiary' as const }
	];
}

export function buildTrackHeroViewModel(track: Track): DetailHeroVM {
	return {
		eyebrow: 'Track',
		title: track.title,
		visual: {
			kind: 'artwork',
			artwork: buildTrackArtworkVm(track, '640')
		},
		metaItems: [
			track.version ? buildDetailIconMeta('disc', track.version) : null,
			buildDetailIconMeta('clock', formatTrackDurationLabel(track.duration)),
			track.audioQuality ? buildDetailIconMeta('disc', track.audioQuality.replaceAll('_', ' ')) : null
		].filter((item): item is NonNullable<typeof item> => Boolean(item)),
		relatedItems: [
			buildDetailRelationRow({
				id: `artist:${track.artist.id}`,
				title: track.artist.name,
				subtitle:
					track.artists.length > 1
						? `${track.artists.length} credited artists • ${formatArtists(track.artists)}`
						: track.artist.type || 'Artist',
				href: `/artist/${track.artist.id}`,
				preload: true,
				primaryAriaLabel: `Open artist ${track.artist.name}`,
				artwork: buildArtistArtworkVm(track.artist.picture, track.artist.name)
			}),
			buildDetailRelationRow({
				id: `album:${track.album.id}`,
				title: track.album.title,
				subtitle: `${track.album.artist?.name ?? track.artist.name}${track.album.releaseDate ? ` • ${track.album.releaseDate.split('-')[0]}` : ''}`,
				href: `/album/${track.album.id}`,
				preload: true,
				primaryAriaLabel: `Open album ${track.album.title}`,
				artwork: buildAlbumArtworkVm(track.album.cover, track.album.title, '320')
			})
		]
	};
}

export function buildTrackActionButtons(options: {
	isDownloading: boolean;
	isCancelled: boolean;
	downloadActionLabel: string;
}): ActionButtonVM[] {
	return [
		buildDetailButton({
			id: 'play',
			label: 'Play',
			ariaLabel: 'Play track',
			icon: 'play',
			tone: 'primary'
		}),
		options.isDownloading
			? buildDetailButton({
					id: 'cancel-download',
					label: 'Cancel',
					ariaLabel: 'Cancel track download',
					icon: 'stop'
				})
			: options.isCancelled
				? buildDetailButton({
						id: 'cancelled',
						label: 'Cancelled',
						ariaLabel: 'Download cancelled',
						icon: 'stop',
						disabled: true
					})
				: buildDetailButton({
						id: 'download',
						label: options.downloadActionLabel,
						ariaLabel: `${options.downloadActionLabel} track`,
						icon: 'download'
					})
	];
}

export function buildTrackMusicBrainzSectionViewModel(options: {
	musicBrainzView: TrackMusicBrainzViewModel;
	isLoading: boolean;
	hasAttempted: boolean;
}): TrackMusicBrainzSectionVM {
	const notices: StateNoticeVM[] = [];
	if (options.isLoading && options.musicBrainzView.status !== 'matched') {
		notices.push({
			tone: 'info',
			message: 'Resolving MusicBrainz metadata…'
		});
	} else if (options.isLoading) {
		notices.push({
			tone: 'info',
			message: 'Refreshing MusicBrainz metadata…'
		});
	} else if (options.hasAttempted && options.musicBrainzView.status === 'no_match') {
		notices.push({
			tone: 'neutral',
			message: 'No MusicBrainz metadata match found for this track.'
		});
	}
	if (options.musicBrainzView.errorMessage) {
		notices.push({
			tone: 'error',
			message: options.musicBrainzView.errorMessage
		});
	}

	return {
		facts: options.musicBrainzView.facts
			.filter((fact) => !fact.label.endsWith('MBID'))
			.map((fact) => ({ label: fact.label, value: fact.value })),
		identifierFacts: options.musicBrainzView.facts
			.filter((fact) => fact.label.endsWith('MBID'))
			.map((fact) => ({ label: fact.label, value: fact.value })),
		artistLinks: options.musicBrainzView.artistLinks.map((artist) =>
			buildDetailLink({
				id: `recording-artist:${artist.id}`,
				label: artist.label,
				href: artist.href,
				external: true
			})
		),
		albumArtistLinks: options.musicBrainzView.albumArtistLinks.map((artist) =>
			buildDetailLink({
				id: `album-artist:${artist.id}`,
				label: artist.label,
				href: artist.href,
				external: true
			})
		),
		links: options.musicBrainzView.links.map((link) =>
			buildDetailLink({
				id: link.label,
				label: link.label,
				href: link.href,
				external: true
			})
		),
		notices
	};
}
