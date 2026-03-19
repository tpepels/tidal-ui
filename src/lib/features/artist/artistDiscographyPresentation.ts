import type { Album } from '$lib/types';
import type { DiscographyGroup } from '$lib/utils/discography';

type ResolveCachedMusicBrainzReleaseId = (album: Album) => string | undefined;

type ResolveDiscographyGroupMusicBrainzReleaseIdOptions = {
	albumMusicBrainzReleaseMatches: Record<number, string>;
	resolveCachedMusicBrainzReleaseId?: ResolveCachedMusicBrainzReleaseId;
};

function normalizeReleaseId(value: string | undefined): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

export function resolveDiscographyGroupMusicBrainzReleaseId(
	entry: Pick<DiscographyGroup, 'representative' | 'versions'>,
	options: ResolveDiscographyGroupMusicBrainzReleaseIdOptions
): string | undefined {
	const seenAlbumIds = new Set<number>();
	const albumsToCheck = [entry.representative, ...entry.versions];

	for (const album of albumsToCheck) {
		if (!album || seenAlbumIds.has(album.id)) {
			continue;
		}
		seenAlbumIds.add(album.id);

		const exactMatch = normalizeReleaseId(options.albumMusicBrainzReleaseMatches[album.id]);
		if (exactMatch) {
			return exactMatch;
		}

		const cachedMatch = normalizeReleaseId(options.resolveCachedMusicBrainzReleaseId?.(album));
		if (cachedMatch) {
			return cachedMatch;
		}
	}

	return undefined;
}

export function describeDiscographyEntrySource(
	entry: Pick<DiscographyGroup, 'representative' | 'versions'>
): string {
	if (entry.representative.discographySource === 'official_tidal') {
		return 'Artist page only release';
	}

	const hasArtistPageOnlyDuplicate = entry.versions.some(
		(album) => album.discographySource === 'official_tidal'
	);
	if (hasArtistPageOnlyDuplicate) {
		return 'Catalog release · artist page also found';
	}

	return 'Catalog release';
}
