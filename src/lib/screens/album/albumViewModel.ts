import {
	buildAlbumArtworkVm,
	formatTrackDurationLabel
} from '$lib/presentation/catalogPresentation';
import {
	buildDetailButton,
	buildDetailFact,
	buildDetailIconMeta,
	buildDetailLink,
	buildDetailTag
} from '$lib/presentation/detailPresentation';
import type {
	ActionButtonVM,
	DetailFactVM,
	DetailHeroVM,
	DetailLinkVM,
	StateNoticeVM
} from '$lib/presentation/viewModels';
import type { Album } from '$lib/types';
import type { MusicBrainzReleaseOption } from '$lib/features/album/albumMusicBrainzController';
import type { AlbumDownloadStatus } from '$lib/controllers/albumDownloadUi';

export type AlbumActionSectionVM = {
	actions: ActionButtonVM[];
	notices: StateNoticeVM[];
};

export type AlbumMusicBrainzSectionVM = {
	options: Array<{
		id: string;
		label: string;
	}>;
	facts: DetailFactVM[];
	links: DetailLinkVM[];
	notices: StateNoticeVM[];
	selectedReleaseId: string;
	hasSelection: boolean;
	footerNote: string;
};

export function buildAlbumSectionNavItems(options: { hasNotes: boolean }) {
	const items = [
		{ id: 'album-actions', label: 'Actions', tone: 'secondary' as const },
		{ id: 'album-metadata', label: 'MusicBrainz', tone: 'tertiary' as const },
		{ id: 'album-tracks', label: 'Tracks' }
	];
	if (options.hasNotes) {
		items.push({ id: 'album-notes', label: 'Notes' });
	}
	return items;
}

export function buildAlbumHeroViewModel(options: {
	album: Album;
	trackCount: number;
	totalDuration: number;
	hasIncompleteTrackList: boolean;
	expectedTrackCount: number | null;
	missingTrackLabel: string;
}): { hero: DetailHeroVM; notices: StateNoticeVM[] } {
	const { album, trackCount, totalDuration, hasIncompleteTrackList, expectedTrackCount, missingTrackLabel } = options;
	const metaItems = [
		album.explicit ? buildDetailTag('Explicit') : null,
		buildDetailIconMeta('calendar', album.releaseDate ? String(new Date(album.releaseDate).getFullYear()) : null),
		buildDetailIconMeta('disc', `${trackCount || album.numberOfTracks || 0} tracks`),
		totalDuration > 0 ? buildDetailIconMeta('clock', `${formatTrackDurationLabel(totalDuration)} total`) : null,
		...(album.mediaMetadata?.tags ?? []).map((tag) => buildDetailTag(tag))
	].filter((item): item is NonNullable<typeof item> => Boolean(item));

	const notices: StateNoticeVM[] = [];
	if (hasIncompleteTrackList && expectedTrackCount !== null) {
		notices.push({
			tone: 'warning',
			message: `Tracklist may be incomplete from source metadata: showing ${trackCount}/${expectedTrackCount} tracks${missingTrackLabel ? ` (missing ${missingTrackLabel})` : ''}.`,
			liveRegion: 'off'
		});
	}

	const visual =
		album.videoCover
			? ({
					kind: 'video',
					src: `/api/artwork/video/${album.videoCover}/640`,
					posterSrc: album.cover ? buildAlbumArtworkVm(album.cover, album.title, '640').src : null,
					alt: album.title,
					shape: 'square'
				} as const)
			: ({
					kind: 'artwork',
					artwork: buildAlbumArtworkVm(album.cover, album.title, '640')
				} as const);

	return {
		hero: {
			eyebrow: 'Album',
			title: album.title,
			supportLinks: album.artist
				? [
						buildDetailLink({
							id: `album-artist-${album.artist.id}`,
							label: album.artist.name,
							href: `/artist/${album.artist.id}`,
							preload: true
						})
					]
				: [],
			visual,
			metaItems
		},
		notices
	};
}

export function buildAlbumActionSectionViewModel(options: {
	queueStatus: AlbumDownloadStatus;
	isQueueDownloadCancellable: boolean;
	isDownloadingAll: boolean;
	downloadedCount: number;
	trackCount: number;
	albumInLibrary: boolean;
	albumLibraryTrackCount: number;
	isRepairingAlbum: boolean;
	repairMessage: string | null;
	downloadError: string | null;
	queueCompletedTracks: number;
	queueTotalTracks: number;
	downloadStoragePreference: 'client' | 'server';
	isMusicBrainzReleaseLookupLoading: boolean;
	selectedMusicBrainzReleaseId: string;
	hasActiveQueueDownload: boolean;
}): AlbumActionSectionVM {
	const actions: ActionButtonVM[] = [
		buildDetailButton({
			id: 'play',
			label: 'Play Album',
			ariaLabel: 'Play album',
			icon: 'play',
			tone: 'primary'
		}),
		buildDetailButton({
			id: 'shuffle',
			label: 'Shuffle Album',
			ariaLabel: 'Shuffle album'
		}),
		buildDetailButton({
			id: 'download',
			label:
				options.isQueueDownloadCancellable
					? 'Stop Download'
					: options.queueStatus === 'submitting'
						? 'Queueing…'
						: options.isDownloadingAll
							? `Downloading ${options.downloadedCount}/${options.trackCount}`
							: options.queueStatus === 'failed'
								? 'Retry Download'
								: options.queueStatus === 'paused' || options.queueStatus === 'cancelled'
									? 'Resume Download'
									: options.queueStatus === 'completed'
										? 'Download Again'
										: options.albumInLibrary && options.queueStatus === 'idle'
											? 'Redownload Album'
											: 'Download Album',
			ariaLabel: options.isQueueDownloadCancellable ? 'Stop album download' : 'Download album',
			icon:
				options.isQueueDownloadCancellable
					? 'stop'
					: options.queueStatus === 'submitting' || options.isDownloadingAll
						? 'download'
						: 'download',
			disabled: options.queueStatus === 'submitting',
			busy: options.hasActiveQueueDownload || options.isDownloadingAll
		})
	];

	if (options.albumInLibrary) {
		actions.push(
			buildDetailButton({
				id: 'repair',
				label: options.isRepairingAlbum ? 'Checking Integrity…' : 'Repair Corrupt Files',
				ariaLabel: options.isRepairingAlbum ? 'Checking album file integrity' : 'Repair corrupt album files',
				busy: options.isRepairingAlbum,
				disabled: options.isRepairingAlbum
			})
		);
	}

	const notices: StateNoticeVM[] = [];
	if (options.queueStatus === 'queued') {
		notices.push({
			tone: 'info',
			message: 'Queued on server. Open Download Manager for live progress.'
		});
	} else if (options.queueStatus === 'processing') {
		notices.push({
			tone: 'info',
			message: `Downloading on server${options.queueTotalTracks > 0 ? ` (${options.queueCompletedTracks}/${options.queueTotalTracks} tracks)` : ''}…`,
			busy: true
		});
	} else if (options.queueStatus === 'completed') {
		notices.push({
			tone: 'success',
			message: 'Album download completed.'
		});
	} else if (options.queueStatus === 'cancelled') {
		notices.push({
			tone: 'warning',
			message: 'Album download stopped.'
		});
	} else if (options.queueStatus === 'paused') {
		notices.push({
			tone: 'warning',
			message: 'Album download paused.'
		});
	} else if (options.albumInLibrary) {
		notices.push({
			tone: 'success',
			message:
				options.downloadStoragePreference === 'server'
					? `Already in local library (${options.albumLibraryTrackCount} track${options.albumLibraryTrackCount === 1 ? '' : 's'} found). Click "Redownload Album" to overwrite.`
					: `Already in local library (${options.albumLibraryTrackCount} track${options.albumLibraryTrackCount === 1 ? '' : 's'} found). Browser redownloads may append (2) to filenames.`,
			liveRegion: 'off'
		});
	}
	if (options.repairMessage) {
		notices.push({
			tone: 'success',
			message: options.repairMessage
		});
	}
	if (options.downloadError) {
		notices.push({
			tone: 'error',
			message: options.downloadError
		});
	}
	if (options.isMusicBrainzReleaseLookupLoading && !options.selectedMusicBrainzReleaseId) {
		notices.push({
			tone: 'info',
			message:
				'MusicBrainz release data is loading in the background and will be applied automatically if it resolves in time.',
			busy: true
		});
	}

	return {
		actions,
		notices
	};
}

export function buildAlbumMusicBrainzSectionViewModel(options: {
	releases: MusicBrainzReleaseOption[];
	selectedReleaseId: string;
	selectedRelease: MusicBrainzReleaseOption | null;
	isLoading: boolean;
	hasAttempted: boolean;
	error: string | null;
	experimentalMusicBrainzTaggingPreference: boolean;
}): AlbumMusicBrainzSectionVM {
	const notices: StateNoticeVM[] = [];
	if (options.isLoading && options.releases.length === 0) {
		notices.push({
			tone: 'info',
			message: 'Searching MusicBrainz releases…'
		});
	} else if (options.isLoading) {
		notices.push({
			tone: 'info',
			message: 'Refreshing MusicBrainz releases…'
		});
	} else if (options.hasAttempted && options.releases.length === 0) {
		notices.push({
			tone: 'neutral',
			message: 'No MusicBrainz release matches found for this album.'
		});
	}
	if (options.error) {
		notices.push({
			tone: 'error',
			message: options.error
		});
	}

	return {
		options: options.releases.map((release, index) => ({
			id: release.id,
			label: `${release.id === options.selectedReleaseId ? 'Selected - ' : index === 0 ? 'Best Score - ' : ''}${release.title}${release.date ? ` · ${release.date}` : ''}${release.country ? ` · ${release.country}` : ''}`
		})),
		facts: [
			buildDetailFact('Track Count', options.selectedRelease?.trackCount),
			buildDetailFact('Release Date', options.selectedRelease?.date),
			buildDetailFact('Country', options.selectedRelease?.country),
			buildDetailFact('Status', options.selectedRelease?.status),
			buildDetailFact('Barcode', options.selectedRelease?.barcode),
			buildDetailFact('Release MBID', options.selectedRelease?.id)
		].filter((fact): fact is DetailFactVM => Boolean(fact)),
		links: options.selectedRelease
			? [
					buildDetailLink({
						id: `musicbrainz-release-${options.selectedRelease.id}`,
						label: 'Open release in MusicBrainz',
						href: `https://musicbrainz.org/release/${options.selectedRelease.id}`,
						ariaLabel: 'Open release in MusicBrainz in a new tab',
						external: true
					})
				]
			: [],
		notices,
		selectedReleaseId: options.selectedReleaseId,
		hasSelection: Boolean(options.selectedRelease),
		footerNote: options.experimentalMusicBrainzTaggingPreference
			? 'The selected release is used for MusicBrainz tagging when downloading this album.'
			: 'Enable experimental MusicBrainz tagging in Settings to apply this release when downloading.'
	};
}
