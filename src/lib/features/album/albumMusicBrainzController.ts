import { musicBrainzClient, type MusicBrainzReleaseOption } from '$lib/clients/musicBrainzClient';
import type { Album, Track } from '$lib/types';

export type { MusicBrainzReleaseOption } from '$lib/clients/musicBrainzClient';

export function formatMusicBrainzReleaseOption(release: MusicBrainzReleaseOption): string {
	const trackCountLabel =
		typeof release.trackCount === 'number' &&
		Number.isFinite(release.trackCount) &&
		release.trackCount > 0
			? `${Math.trunc(release.trackCount)} track${Math.trunc(release.trackCount) === 1 ? '' : 's'}`
			: undefined;
	const parts = [
		release.title?.trim() || 'Untitled release',
		trackCountLabel,
		release.artistCredit?.trim(),
		release.date?.trim(),
		release.country?.trim(),
		release.status?.trim()
	].filter((value): value is string => typeof value === 'string' && value.length > 0);
	return parts.join(' - ');
}

function resolveReleaseTrackCount(release: MusicBrainzReleaseOption): number | null {
	const count = Number(release.trackCount);
	if (!Number.isFinite(count) || count <= 0) {
		return null;
	}
	return Math.trunc(count);
}

function resolveMusicBrainzTargetTrackCount(album: Album | null, tracks: Track[]): number | null {
	const albumTrackCount = Number(album?.numberOfTracks);
	if (Number.isFinite(albumTrackCount) && albumTrackCount > 0) {
		return Math.trunc(albumTrackCount);
	}
	if (tracks.length > 0) {
		return tracks.length;
	}
	return null;
}

export function pickDefaultMusicBrainzReleaseId(
	releases: MusicBrainzReleaseOption[],
	targetTrackCount: number | null
): string {
	if (releases.length === 0) {
		return '';
	}
	if (targetTrackCount === null) {
		return releases[0]?.id ?? '';
	}

	const exactTrackCountMatch = releases.find(
		(release) => resolveReleaseTrackCount(release) === targetTrackCount
	);
	if (exactTrackCountMatch) {
		return exactTrackCountMatch.id;
	}

	const atLeastTrackCountMatch = releases.find((release) => {
		const trackCount = resolveReleaseTrackCount(release);
		return trackCount !== null && trackCount >= targetTrackCount;
	});
	if (atLeastTrackCountMatch) {
		return atLeastTrackCountMatch.id;
	}

	return releases[0]?.id ?? '';
}

export async function lookupAlbumMusicBrainzReleases(options: {
	album: Album;
	tracks: Track[];
	currentSelectionId?: string;
	fetchImpl?: typeof fetch;
}): Promise<{
	releases: MusicBrainzReleaseOption[];
	selectedReleaseId: string;
}> {
	const releases = await musicBrainzClient.searchReleases(
		{
			albumTitle: options.album.title,
			artistName: options.album.artist?.name,
			releaseDate: options.album.releaseDate,
			upc: options.album.upc,
			limit: 12
		},
		{
			fetchImpl: options.fetchImpl
		}
	);
	if (releases.length === 0) {
		return {
			releases: [],
			selectedReleaseId: ''
		};
	}

	const currentSelectionId = options.currentSelectionId ?? '';
	const hasExistingSelection = releases.some((release) => release.id === currentSelectionId);
	const targetTrackCount = resolveMusicBrainzTargetTrackCount(options.album, options.tracks);
	const recommendedSelection = pickDefaultMusicBrainzReleaseId(releases, targetTrackCount);
	if (hasExistingSelection) {
		if (targetTrackCount !== null) {
			const selectedRelease = releases.find((release) => release.id === currentSelectionId) ?? null;
			const selectedTrackCount = selectedRelease ? resolveReleaseTrackCount(selectedRelease) : null;
			const selectedIsTrackCompatible =
				selectedTrackCount !== null && selectedTrackCount >= targetTrackCount;
			if (selectedIsTrackCompatible) {
				return {
					releases,
					selectedReleaseId: currentSelectionId
				};
			}
		} else {
			return {
				releases,
				selectedReleaseId: currentSelectionId
			};
		}
	}

	return {
		releases,
		selectedReleaseId: recommendedSelection
	};
}
