import {
	buildArtistArtworkVm,
	buildPlaylistArtworkVm,
	formatPlaylistDurationLabel
} from '$lib/presentation/catalogPresentation';
import {
	buildDetailButton,
	buildDetailFact,
	buildDetailIconMeta,
	buildDetailRelationRow
} from '$lib/presentation/detailPresentation';
import type {
	ActionButtonVM,
	DetailFactVM,
	DetailHeroVM,
	EntityRowVM
} from '$lib/presentation/viewModels';
import type { Playlist } from '$lib/types';

export function buildPlaylistSectionNavItems(options: { hasFeaturedArtists: boolean }) {
	const items: Array<{
		id: string;
		label: string;
		tone?: 'secondary' | 'tertiary';
	}> = [
		{ id: 'playlist-actions', label: 'Actions', tone: 'secondary' as const },
		{ id: 'playlist-tracks', label: 'Tracks' }
	];
	if (options.hasFeaturedArtists) {
		items.push({ id: 'playlist-artists', label: 'Featured Artists', tone: 'tertiary' as const });
	}
	items.push({ id: 'playlist-metadata', label: 'Metadata' });
	return items;
}

export function buildPlaylistHeroViewModel(playlist: Playlist): DetailHeroVM {
	return {
		eyebrow: 'Playlist',
		title: playlist.title,
		description: playlist.description,
		visual: {
			kind: 'artwork',
			artwork: buildPlaylistArtworkVm(playlist.squareImage || playlist.image, playlist.title, '640')
		},
		metaItems: [
			buildDetailIconMeta('user', playlist.creator.name, {
				imageSrc: playlist.creator.picture
					? buildArtistArtworkVm(playlist.creator.picture, playlist.creator.name).src
					: null,
				imageAlt: playlist.creator.name,
				imageShape: 'circle'
			}),
			buildDetailIconMeta('disc', `${playlist.numberOfTracks} tracks`),
			playlist.duration ? buildDetailIconMeta('clock', formatPlaylistDurationLabel(playlist.duration)) : null,
			playlist.type ? buildDetailIconMeta('disc', playlist.type) : null
		].filter((item): item is NonNullable<typeof item> => Boolean(item))
	};
}

export function buildPlaylistActionButtons(): ActionButtonVM[] {
	return [
		buildDetailButton({
			id: 'play',
			label: 'Play Playlist',
			ariaLabel: 'Play playlist',
			icon: 'play',
			tone: 'primary'
		})
	];
}

export function buildPlaylistMetadataFacts(playlist: Playlist): DetailFactVM[] {
	return [
		buildDetailFact(
			'Created',
			playlist.created ? new Date(playlist.created).toLocaleDateString() : null
		),
		buildDetailFact(
			'Last Updated',
			playlist.lastUpdated ? new Date(playlist.lastUpdated).toLocaleDateString() : null
		)
	].filter((fact): fact is DetailFactVM => Boolean(fact));
}

export function buildPlaylistFeaturedArtistRows(playlist: Playlist): EntityRowVM[] {
	return (playlist.promotedArtists ?? []).map((artist) =>
		buildDetailRelationRow({
			id: `playlist-artist:${artist.id}`,
			title: artist.name,
			subtitle: artist.type || 'Artist',
			href: `/artist/${artist.id}`,
			preload: true,
			primaryAriaLabel: `Open artist ${artist.name}`,
			artwork: buildArtistArtworkVm(artist.picture, artist.name)
		})
	);
}
