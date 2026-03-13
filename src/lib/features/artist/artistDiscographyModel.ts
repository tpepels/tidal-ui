import { getDiscographyTraits, type DiscographyGroup } from '$lib/utils/discography';
import type { Track } from '$lib/types';

export type DiscographyFilterState = {
	album: boolean;
	ep: boolean;
	single: boolean;
	live: boolean;
	remaster: boolean;
	explicit: boolean;
	clean: boolean;
};

export type AlbumTopTrackSignal = {
	hits: number;
	popularitySum: number;
	rankWeight: number;
};

export type FeaturedDiscographyAlbum = {
	entry: DiscographyGroup;
	score: number;
	topTrackHits: number;
	topTrackPopularity: number;
};

export function filterDiscographyEntries(
	entries: DiscographyGroup[],
	filterState: DiscographyFilterState
): DiscographyGroup[] {
	return entries.filter((entry) => {
		const traits = getDiscographyTraits(entry.representative);
		if (!filterState[traits.releaseType]) return false;
		if (!filterState.live && traits.isLive) return false;
		if (!filterState.remaster && traits.isRemaster) return false;
		if (!filterState.explicit && traits.isExplicit) return false;
		if (!filterState.clean && !traits.isExplicit) return false;
		return true;
	});
}

export function buildTopTrackAlbumSignals(
	topTracks: Track[],
	options?: { maxTracks?: number }
): Map<number, AlbumTopTrackSignal> {
	const signals = new Map<number, AlbumTopTrackSignal>();
	const rankedTracks = topTracks.slice(0, options?.maxTracks ?? 80);
	const rankedTrackCount = rankedTracks.length;
	for (const [index, track] of rankedTracks.entries()) {
		const albumId = track.album?.id;
		if (!Number.isFinite(albumId)) {
			continue;
		}
		const existing = signals.get(albumId) ?? { hits: 0, popularitySum: 0, rankWeight: 0 };
		existing.hits += 1;
		existing.popularitySum += Math.max(0, track.popularity ?? 0);
		existing.rankWeight += Math.max(0, rankedTrackCount - index);
		signals.set(albumId, existing);
	}
	return signals;
}

export function buildFeaturedDiscographyAlbums(
	entries: DiscographyGroup[],
	topTrackSignals: Map<number, AlbumTopTrackSignal>,
	options?: { limit?: number }
): FeaturedDiscographyAlbum[] {
	const limit = options?.limit ?? 12;
	return entries
		.filter((entry) => entry.section === 'album')
		.map((entry) => {
			const album = entry.representative;
			const topTrackSignal = topTrackSignals.get(album.id);
			const traits = getDiscographyTraits(album);
			const popularityScore = Math.max(0, album.popularity ?? 0) * 1.6;
			const trackCountScore = Math.min(Math.max(album.numberOfTracks ?? 0, 0), 24) * 0.45;
			const topTrackHits = topTrackSignal?.hits ?? 0;
			const topTrackPopularity = topTrackSignal?.popularitySum ?? 0;
			const topTrackHitsScore = topTrackHits * 16;
			const topTrackPopularityScore = topTrackPopularity * 0.55;
			const topTrackRankScore = (topTrackSignal?.rankWeight ?? 0) * 0.75;
			const variantPenalty = (traits.isLive ? 26 : 0) + (traits.isRemaster ? 10 : 0);
			const score =
				popularityScore +
				trackCountScore +
				topTrackHitsScore +
				topTrackPopularityScore +
				topTrackRankScore -
				variantPenalty;
			return {
				entry,
				score,
				topTrackHits,
				topTrackPopularity
			} satisfies FeaturedDiscographyAlbum;
		})
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			const popularityA = a.entry.representative.popularity ?? 0;
			const popularityB = b.entry.representative.popularity ?? 0;
			if (popularityB !== popularityA) return popularityB - popularityA;
			const hitsDelta = b.topTrackHits - a.topTrackHits;
			if (hitsDelta !== 0) return hitsDelta;
			return a.entry.representative.title.localeCompare(b.entry.representative.title);
		})
		.slice(0, limit);
}
