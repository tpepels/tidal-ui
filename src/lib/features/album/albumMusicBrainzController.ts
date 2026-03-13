import type { Album, Track } from '$lib/types';

export type MusicBrainzReleaseOption = {
	id: string;
	title?: string;
	artistCredit?: string;
	status?: string;
	country?: string;
	date?: string;
	trackCount?: number;
	barcode?: string;
};

type MusicBrainzReleaseSearchPayload = {
	success?: boolean;
	error?: string;
	releases?: MusicBrainzReleaseOption[];
} | null;

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
	const fetchImpl = options.fetchImpl ?? fetch;
	const response = await fetchImpl('/api/metadata/musicbrainz-release-search', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			albumTitle: options.album.title,
			artistName: options.album.artist?.name,
			releaseDate: options.album.releaseDate,
			upc: options.album.upc,
			limit: 12
		})
	});
	const payload = (await response.json().catch(() => null)) as MusicBrainzReleaseSearchPayload;
	if (!response.ok || !payload?.success) {
		throw new Error(payload?.error || 'Failed to search MusicBrainz releases');
	}

	const releases = Array.isArray(payload.releases)
		? payload.releases.filter((release) => typeof release?.id === 'string' && release.id.length > 0)
		: [];
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
