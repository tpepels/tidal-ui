import type { AlbumDownloadState } from '$lib/features/search/albumQueueController';
import { createDefaultAlbumDownloadState, isAlbumQueueDownloadCancellable } from '$lib/features/search/albumQueueController';
import type { Album, Artist, PlayableTrack, Playlist } from '$lib/types';
import { isSonglinkTrack } from '$lib/types';
import {
	buildAlbumArtworkVm,
	buildArtistArtworkVm,
	buildPlaylistArtworkVm,
	buildTrackArtworkVm,
	formatAlbumMetaLine,
	formatPlaylistMetaLine,
	formatTrackPrimaryMeta
} from '$lib/presentation/catalogPresentation';
import type { ActionButtonVM, EntityRowVM } from '$lib/presentation/viewModels';

export type SearchTrackRowVM = {
	id: string;
	item: EntityRowVM;
	track: PlayableTrack;
	isDownloading: boolean;
	isCancelled: boolean;
	downloadActionLabel: string;
};

export type SearchAlbumRowVM = {
	id: string;
	item: EntityRowVM;
	album: Album;
	state: AlbumDownloadState;
	action: ActionButtonVM;
	canCancel: boolean;
};

export type SearchArtistRowVM = {
	id: string;
	item: EntityRowVM;
	artist: Artist;
};

export type SearchPlaylistRowVM = {
	id: string;
	item: EntityRowVM;
	playlist: Playlist;
};

function resolveAlbumStatusText(state: AlbumDownloadState): string | null {
	if (state.status === 'queued') return 'Queued';
	if (state.downloading) {
		if (state.total > 0) {
			return `Downloading ${state.completed}/${state.total}`;
		}
		return `Downloading ${state.completed}`;
	}
	if (state.status === 'completed') return 'Downloaded';
	if (state.status === 'cancelled') return 'Stopped';
	if (state.status === 'paused') return 'Paused';
	if (state.error) return 'Download error';
	return null;
}

function resolveAlbumActionVm(
	state: AlbumDownloadState,
	downloadActionLabel: string,
	albumTitle: string
): { action: ActionButtonVM; canCancel: boolean } {
	const canCancel = isAlbumQueueDownloadCancellable(state);
	if (canCancel) {
		return {
			canCancel,
			action: {
				label: 'Stop',
				ariaLabel: `Stop download ${albumTitle}`,
				title: `Stop download ${albumTitle}`,
				icon: 'stop'
			}
		};
	}
	if (state.status === 'paused') {
		return {
			canCancel,
			action: {
				label: 'Resume',
				ariaLabel: `Resume download ${albumTitle}`,
				title: `Resume download ${albumTitle}`,
				icon: 'resume'
			}
		};
	}
	if (state.status === 'submitting' || state.downloading) {
		return {
			canCancel,
			action: {
				label: 'Working',
				ariaLabel: `Processing download ${albumTitle}`,
				title: `Processing download ${albumTitle}`,
				icon: 'download',
				busy: true,
				disabled: state.status === 'submitting'
			}
		};
	}
	return {
		canCancel,
		action: {
			label: downloadActionLabel === 'Save to server' ? 'Save' : downloadActionLabel,
			ariaLabel: `${downloadActionLabel} ${albumTitle}`,
			title: `${downloadActionLabel} ${albumTitle}`,
			icon: 'download'
		}
	};
}

export function buildSearchTrackRowViewModel(options: {
	track: PlayableTrack;
	downloadingIds: Set<number | string>;
	cancelledIds: Set<number | string>;
	downloadActionLabel: string;
}): SearchTrackRowVM {
	const { track, downloadingIds, cancelledIds, downloadActionLabel } = options;
	return {
		id: String(track.id),
		track,
		isDownloading: downloadingIds.has(track.id),
		isCancelled: cancelledIds.has(track.id),
		downloadActionLabel,
		item: {
			id: String(track.id),
			title: track.title,
			titleSuffix: isSonglinkTrack(track) ? null : track.version ?? null,
			meta: formatTrackPrimaryMeta(track),
			tone: 'tertiary',
			primaryAction: 'button',
			primaryAriaLabel: `Play ${track.title}`,
			artwork: buildTrackArtworkVm(track, '160')
		}
	};
}

export function buildSearchAlbumRowViewModel(options: {
	album: Album;
	downloadState?: AlbumDownloadState;
	hasMusicBrainzMatch: boolean;
	isMusicBrainzLoading: boolean;
	pendingMusicBrainzAlbumIds: Set<number>;
	downloadActionLabel: string;
}): SearchAlbumRowVM {
	const {
		album,
		downloadState = createDefaultAlbumDownloadState(album.numberOfTracks ?? 0),
		hasMusicBrainzMatch,
		isMusicBrainzLoading,
		pendingMusicBrainzAlbumIds,
		downloadActionLabel
	} = options;
	const statusParts: string[] = [];
	if (isMusicBrainzLoading && pendingMusicBrainzAlbumIds.has(album.id) && !hasMusicBrainzMatch) {
		statusParts.push('Matching MusicBrainz…');
	}
	const downloadStatus = resolveAlbumStatusText(downloadState);
	if (downloadStatus) {
		statusParts.push(downloadStatus);
	}
	const { action, canCancel } = resolveAlbumActionVm(
		downloadState,
		downloadActionLabel,
		album.title
	);
	return {
		id: String(album.id),
		album,
		state: downloadState,
		canCancel,
		action,
		item: {
			id: String(album.id),
			title: album.title,
			meta: formatAlbumMetaLine(album),
			status: statusParts.length > 0 ? statusParts.join(' • ') : null,
			href: `/album/${album.id}`,
			preload: true,
			primaryAction: 'link',
			primaryAriaLabel: `Open album ${album.title}`,
			artwork: buildAlbumArtworkVm(album.cover, album.title, '160'),
			badge: hasMusicBrainzMatch
				? {
						kind: 'image',
						label: 'Matched with MusicBrainz release',
						title: 'Matched with MusicBrainz release',
						src: '/icons/musicbrainz-32.png'
					}
				: null
		}
	};
}

export function buildSearchArtistRowViewModel(artist: Artist): SearchArtistRowVM {
	return {
		id: String(artist.id),
		artist,
		item: {
			id: String(artist.id),
			title: artist.name,
			meta: artist.type?.trim().length ? artist.type : 'Artist',
			href: `/artist/${artist.id}`,
			preload: true,
			primaryAction: 'link',
			primaryAriaLabel: `Open artist ${artist.name}`,
			tone: 'secondary',
			artwork: buildArtistArtworkVm(artist.picture, artist.name)
		}
	};
}

export function buildSearchPlaylistRowViewModel(playlist: Playlist): SearchPlaylistRowVM {
	return {
		id: playlist.uuid,
		playlist,
		item: {
			id: playlist.uuid,
			title: playlist.title,
			meta: formatPlaylistMetaLine(playlist),
			href: `/playlist/${playlist.uuid}`,
			preload: true,
			primaryAction: 'link',
			primaryAriaLabel: `Open playlist ${playlist.title}`,
			tone: 'secondary',
			artwork: buildPlaylistArtworkVm(playlist.squareImage || playlist.image, playlist.title, '160')
		}
	};
}
