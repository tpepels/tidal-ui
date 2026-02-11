import type { Album, AudioQuality } from '$lib/types';
import { deriveQualityFromTags, normalizeQualityToken } from './audioQuality';

const QUALITY_ORDER_ASC: readonly AudioQuality[] = ['LOW', 'HIGH', 'LOSSLESS', 'HI_RES_LOSSLESS'];
const QUALITY_RANK = new Map<AudioQuality, number>(
	QUALITY_ORDER_ASC.map((quality, index) => [quality, index])
);

export type DiscographySection = 'album' | 'single';

export type DiscographyGroup = {
	key: string;
	representative: Album;
	versions: Album[];
	availableQualities: AudioQuality[];
	section: DiscographySection;
};

function normalizeTitle(title?: string): string {
	if (!title) return '';
	return title
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"')
		.trim();
}

function getPrimaryArtistId(album: Album): number {
	const candidate = album.artist?.id ?? album.artists?.[0]?.id;
	return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : 0;
}

function scoreAlbum(album: Album): number {
	let score = 0;
	if (album.cover) score += 2;
	if (album.releaseDate) score += 1;
	if (album.numberOfTracks) score += 1;
	if (album.audioQuality) score += 1;
	return score;
}

function albumRecencyScore(album: Album): number {
	if (!album.releaseDate) return Number.NEGATIVE_INFINITY;
	const timestamp = Date.parse(album.releaseDate);
	return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function compareAlbumFallback(a: Album, b: Album): number {
	const popularity = (b.popularity ?? 0) - (a.popularity ?? 0);
	if (popularity !== 0) return popularity;
	const recencyA = albumRecencyScore(a);
	const recencyB = albumRecencyScore(b);
	const hasRecencyA = Number.isFinite(recencyA);
	const hasRecencyB = Number.isFinite(recencyB);
	if (hasRecencyA && hasRecencyB && recencyA !== recencyB) {
		return recencyB - recencyA;
	}
	if (hasRecencyA && !hasRecencyB) return -1;
	if (!hasRecencyA && hasRecencyB) return 1;
	return scoreAlbum(b) - scoreAlbum(a);
}

function deriveAlbumQuality(album: Album): AudioQuality | null {
	const fromField = normalizeQualityToken(album.audioQuality ?? null);
	const fromTags = deriveQualityFromTags(album.mediaMetadata?.tags);
	if (fromField && fromTags) {
		const fromFieldRank = QUALITY_RANK.get(fromField) ?? -1;
		const fromTagsRank = QUALITY_RANK.get(fromTags) ?? -1;
		return fromFieldRank >= fromTagsRank ? fromField : fromTags;
	}
	return fromField ?? fromTags;
}

function getQualityRank(quality: AudioQuality | null | undefined): number {
	if (!quality) return -1;
	return QUALITY_RANK.get(quality) ?? -1;
}

function buildDiscographyKey(album: Album): string {
	const titleKey = normalizeTitle(album.title);
	const artistKey = `${getPrimaryArtistId(album)}`;
	const section = classifyAlbum(album);
	if (titleKey.length > 0) {
		// Group by canonical title so quality variants collapse to one visible release.
		return `title:${artistKey}:${section}:${titleKey}`;
	}
	return `fallback:${artistKey}:${section}:${album.id}`;
}

function classifyAlbum(album: Album): DiscographySection {
	const type = (album.type ?? '').toUpperCase();
	if (type.includes('SINGLE')) return 'single';
	return 'album';
}

function pickRepresentativeVersion(versions: Album[], preferredQuality: AudioQuality): Album {
	const preferredRank = getQualityRank(preferredQuality);
	const exactPreferred = versions
		.map((album) => ({
			album,
			rank: getQualityRank(deriveAlbumQuality(album))
		}))
		.filter((entry) => entry.rank === preferredRank)
		.sort((a, b) => compareAlbumFallback(a.album, b.album));
	if (exactPreferred.length > 0) {
		return exactPreferred[0]!.album;
	}

	const atOrAbovePreferred = versions
		.map((album) => ({
			album,
			rank: getQualityRank(deriveAlbumQuality(album))
		}))
		.filter((entry) => entry.rank >= preferredRank)
		.sort((a, b) => {
			const rankDelta = a.rank - b.rank;
			if (rankDelta !== 0) return rankDelta;
			return compareAlbumFallback(a.album, b.album);
		});

	if (atOrAbovePreferred.length > 0) {
		return atOrAbovePreferred[0]!.album;
	}

	const bestAvailable = [...versions].sort((a, b) => {
		const rankDelta = getQualityRank(deriveAlbumQuality(b)) - getQualityRank(deriveAlbumQuality(a));
		if (rankDelta !== 0) return rankDelta;
		return compareAlbumFallback(a, b);
	});
	return bestAvailable[0]!;
}

export function groupDiscography(
	albums: Album[],
	preferredQuality: AudioQuality
): DiscographyGroup[] {
	const groups = new Map<string, Map<number, Album>>();

	for (const album of albums) {
		if (!album || typeof album !== 'object') continue;
		if (!Number.isFinite(album.id)) continue;

		const groupKey = buildDiscographyKey(album);
		const group = groups.get(groupKey) ?? new Map<number, Album>();
		const existing = group.get(album.id);
		if (!existing || scoreAlbum(album) > scoreAlbum(existing)) {
			group.set(album.id, album);
		}
		groups.set(groupKey, group);
	}

	const result: DiscographyGroup[] = [];

	for (const [key, albumMap] of groups.entries()) {
		const versions = Array.from(albumMap.values()).sort(compareAlbumFallback);
		if (versions.length === 0) continue;

		const representative = pickRepresentativeVersion(versions, preferredQuality);

		const availableQualities = Array.from(
			new Set(
				versions
					.map((album) => deriveAlbumQuality(album))
					.filter((quality): quality is AudioQuality => quality !== null)
			)
		).sort((a, b) => getQualityRank(b) - getQualityRank(a));

		result.push({
			key,
			representative,
			versions,
			availableQualities,
			section: classifyAlbum(representative)
		});
	}

	return result.sort((a, b) => compareAlbumFallback(a.representative, b.representative));
}
