import type { Track } from '$lib/types';

function parseReleaseDate(value?: string): number {
	if (!value) return Number.NaN;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function compareString(a: string | undefined, b: string | undefined): number {
	return (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' });
}

export function compareTopTracks(a: Track, b: Track): number {
	const popularityDelta = (b.popularity ?? 0) - (a.popularity ?? 0);
	if (popularityDelta !== 0) return popularityDelta;

	const albumDateA = parseReleaseDate(a.album?.releaseDate);
	const albumDateB = parseReleaseDate(b.album?.releaseDate);
	const hasAlbumDateA = Number.isFinite(albumDateA);
	const hasAlbumDateB = Number.isFinite(albumDateB);
	if (hasAlbumDateA && hasAlbumDateB && albumDateA !== albumDateB) {
		return albumDateB - albumDateA;
	}
	if (hasAlbumDateA && !hasAlbumDateB) return -1;
	if (!hasAlbumDateA && hasAlbumDateB) return 1;

	const albumIdDelta = (a.album?.id ?? Number.MAX_SAFE_INTEGER) - (b.album?.id ?? Number.MAX_SAFE_INTEGER);
	if (albumIdDelta !== 0) return albumIdDelta;

	const volumeDelta = (a.volumeNumber ?? Number.MAX_SAFE_INTEGER) - (b.volumeNumber ?? Number.MAX_SAFE_INTEGER);
	if (volumeDelta !== 0) return volumeDelta;

	const trackNumberDelta =
		(a.trackNumber ?? Number.MAX_SAFE_INTEGER) - (b.trackNumber ?? Number.MAX_SAFE_INTEGER);
	if (trackNumberDelta !== 0) return trackNumberDelta;

	const titleDelta = compareString(a.title, b.title);
	if (titleDelta !== 0) return titleDelta;

	return a.id - b.id;
}

export function sortTopTracks(tracks: Track[], limit = 100): Track[] {
	return [...tracks].sort(compareTopTracks).slice(0, Math.max(1, limit));
}
