import type { Album } from '$lib/types';

type AlbumSelectionFields = Pick<Album, 'cover' | 'releaseDate' | 'numberOfTracks' | 'audioQuality'>;

export function scoreAlbumForSelection(album: AlbumSelectionFields): number {
	let score = 0;
	if (album.cover) score += 2;
	if (album.releaseDate) score += 1;
	if (album.numberOfTracks) score += 1;
	if (album.audioQuality) score += 1;
	return score;
}

export function pickHigherScoredAlbum<T extends AlbumSelectionFields>(current: T, candidate: T): T {
	return scoreAlbumForSelection(candidate) > scoreAlbumForSelection(current) ? candidate : current;
}
