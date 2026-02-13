import type { Album, AudioQuality } from '$lib/types';
import { deriveQualityFromTags, normalizeQualityToken } from './audioQuality';
import { scoreAlbumForSelection } from './albumSelection';

const QUALITY_ORDER_ASC: readonly AudioQuality[] = ['LOW', 'HIGH', 'LOSSLESS', 'HI_RES_LOSSLESS'];
const QUALITY_RANK = new Map<AudioQuality, number>(
	QUALITY_ORDER_ASC.map((quality, index) => [quality, index])
);

export type DiscographySection = 'album' | 'ep' | 'single';
export type DiscographyReleaseType = DiscographySection;
export type DiscographyBestEditionRule =
	| 'quality_first'
	| 'balanced'
	| 'completeness_first'
	| 'original_release';

export type DiscographyTraits = {
	releaseType: DiscographyReleaseType;
	isLive: boolean;
	isRemaster: boolean;
	isExplicit: boolean;
	trackCount: number;
};

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

function getDiscographySourcePriority(album: Album): number {
	// Prefer proxy/catalog albums over official enrichment IDs for stable downstream routing.
	return album.discographySource === 'official_tidal' ? 0 : 1;
}

function albumRecencyScore(album: Album): number {
	if (!album.releaseDate) return Number.NEGATIVE_INFINITY;
	const timestamp = Date.parse(album.releaseDate);
	return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function compareAlbumFallback(a: Album, b: Album): number {
	const recencyA = albumRecencyScore(a);
	const recencyB = albumRecencyScore(b);
	const hasRecencyA = Number.isFinite(recencyA);
	const hasRecencyB = Number.isFinite(recencyB);
	if (hasRecencyA && hasRecencyB && recencyA !== recencyB) {
		return recencyB - recencyA;
	}
	if (hasRecencyA && !hasRecencyB) return -1;
	if (!hasRecencyA && hasRecencyB) return 1;
	const popularity = (b.popularity ?? 0) - (a.popularity ?? 0);
	if (popularity !== 0) return popularity;
	return scoreAlbumForSelection(b) - scoreAlbumForSelection(a);
}

function compareAlbumOldestFirst(a: Album, b: Album): number {
	const recencyA = albumRecencyScore(a);
	const recencyB = albumRecencyScore(b);
	const hasRecencyA = Number.isFinite(recencyA);
	const hasRecencyB = Number.isFinite(recencyB);
	if (hasRecencyA && hasRecencyB && recencyA !== recencyB) {
		return recencyA - recencyB;
	}
	if (hasRecencyA && !hasRecencyB) return -1;
	if (!hasRecencyA && hasRecencyB) return 1;
	return compareAlbumFallback(a, b);
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

export function getDiscographyTraits(album: Album): DiscographyTraits {
	const type = (album.type ?? '').toUpperCase();
	const title = (album.title ?? '').toLowerCase();
	const corpus = `${type} ${title}`;
	const releaseType: DiscographyReleaseType = type.includes('SINGLE')
		? 'single'
		: type.includes('EP')
			? 'ep'
			: 'album';
	const isLive = /\blive\b|acoustic live|unplugged|concert|session/.test(corpus);
	const isRemaster =
		/\bremaster(ed)?\b|\banniversary\b|\bdeluxe\b|\bexpanded\b/.test(corpus);
	const trackCount =
		typeof album.numberOfTracks === 'number' && album.numberOfTracks > 0 ? album.numberOfTracks : 0;
	return {
		releaseType,
		isLive,
		isRemaster,
		isExplicit: Boolean(album.explicit),
		trackCount
	};
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
	return getDiscographyTraits(album).releaseType;
}

function qualityDistanceScore(rank: number, preferredRank: number): number {
	if (rank === preferredRank) return 0;
	if (rank > preferredRank) return rank - preferredRank + 0.1;
	return preferredRank - rank + 10;
}

function pickRepresentativeVersion(
	versions: Album[],
	preferredQuality: AudioQuality,
	bestEditionRule: DiscographyBestEditionRule
): Album {
	const preferredRank = getQualityRank(preferredQuality);
	const enriched = versions.map((album) => {
		const rank = getQualityRank(deriveAlbumQuality(album));
		const traits = getDiscographyTraits(album);
		const sourcePriority = getDiscographySourcePriority(album);
		return { album, rank, traits, sourcePriority };
	});

	const sorted = [...enriched].sort((a, b) => {
		const sourcePriorityDelta = b.sourcePriority - a.sourcePriority;
		if (sourcePriorityDelta !== 0) return sourcePriorityDelta;

		switch (bestEditionRule) {
			case 'completeness_first': {
				const trackDelta = b.traits.trackCount - a.traits.trackCount;
				if (trackDelta !== 0) return trackDelta;
				const qualityDelta =
					qualityDistanceScore(a.rank, preferredRank) - qualityDistanceScore(b.rank, preferredRank);
				if (qualityDelta !== 0) return qualityDelta;
				const variantPenaltyA = Number(a.traits.isLive) + Number(a.traits.isRemaster);
				const variantPenaltyB = Number(b.traits.isLive) + Number(b.traits.isRemaster);
				if (variantPenaltyA !== variantPenaltyB) return variantPenaltyA - variantPenaltyB;
				return compareAlbumFallback(a.album, b.album);
			}
			case 'original_release': {
				const variantPenaltyA = Number(a.traits.isLive) + Number(a.traits.isRemaster);
				const variantPenaltyB = Number(b.traits.isLive) + Number(b.traits.isRemaster);
				if (variantPenaltyA !== variantPenaltyB) return variantPenaltyA - variantPenaltyB;
				const dateDelta = compareAlbumOldestFirst(a.album, b.album);
				if (dateDelta !== 0) return dateDelta;
				const qualityDelta =
					qualityDistanceScore(a.rank, preferredRank) - qualityDistanceScore(b.rank, preferredRank);
				if (qualityDelta !== 0) return qualityDelta;
				return compareAlbumFallback(a.album, b.album);
			}
			case 'balanced': {
				const qualityDelta =
					qualityDistanceScore(a.rank, preferredRank) - qualityDistanceScore(b.rank, preferredRank);
				if (qualityDelta !== 0) return qualityDelta;
				const variantPenaltyA = Number(a.traits.isLive) + Number(a.traits.isRemaster);
				const variantPenaltyB = Number(b.traits.isLive) + Number(b.traits.isRemaster);
				if (variantPenaltyA !== variantPenaltyB) return variantPenaltyA - variantPenaltyB;
				const trackDelta = b.traits.trackCount - a.traits.trackCount;
				if (trackDelta !== 0) return trackDelta;
				return compareAlbumFallback(a.album, b.album);
			}
			case 'quality_first':
			default: {
				const qualityDelta =
					qualityDistanceScore(a.rank, preferredRank) - qualityDistanceScore(b.rank, preferredRank);
				if (qualityDelta !== 0) return qualityDelta;
				return compareAlbumFallback(a.album, b.album);
			}
		}
	});

	return sorted[0]!.album;
}

export function groupDiscography(
	albums: Album[],
	preferredQuality: AudioQuality,
	options?: { bestEditionRule?: DiscographyBestEditionRule }
): DiscographyGroup[] {
	const bestEditionRule = options?.bestEditionRule ?? 'balanced';
	const groups = new Map<string, Map<number, Album>>();

	for (const album of albums) {
		if (!album || typeof album !== 'object') continue;
		if (!Number.isFinite(album.id)) continue;

		const groupKey = buildDiscographyKey(album);
		const group = groups.get(groupKey) ?? new Map<number, Album>();
		const existing = group.get(album.id);
		if (!existing || scoreAlbumForSelection(album) > scoreAlbumForSelection(existing)) {
			group.set(album.id, album);
		}
		groups.set(groupKey, group);
	}

	const result: DiscographyGroup[] = [];

	for (const [key, albumMap] of groups.entries()) {
		const versions = Array.from(albumMap.values()).sort(compareAlbumFallback);
		if (versions.length === 0) continue;

		const representative = pickRepresentativeVersion(versions, preferredQuality, bestEditionRule);

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
