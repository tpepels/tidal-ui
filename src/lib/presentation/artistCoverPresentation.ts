import type { Album } from '$lib/types';
import {
	getCoverCacheKey,
	getResolvedCoverUrl,
	getUnifiedCoverCandidates,
	isCoverInFailureBackoff
} from '$lib/utils/coverPipeline';

const COVER_CANDIDATE_DELIMITER = '\n';

export function buildArtistAlbumCoverCandidates(
	representative: Album,
	versions: Album[],
	useProxy: boolean,
	overrideCoverId?: string
): string[] {
	const coverIds: string[] = [];
	const seenIds = new Set<string>();
	const normalizedOverride = typeof overrideCoverId === 'string' ? overrideCoverId.trim() : '';
	if (normalizedOverride) {
		seenIds.add(normalizedOverride);
		coverIds.push(normalizedOverride);
	}
	for (const version of [representative, ...versions]) {
		const cover = typeof version.cover === 'string' ? version.cover.trim() : '';
		if (!cover || seenIds.has(cover)) continue;
		seenIds.add(cover);
		coverIds.push(cover);
		if (coverIds.length >= 4) break;
	}

	const urls: string[] = [];
	for (const coverId of coverIds) {
		const cacheKey = getCoverCacheKey({
			coverId,
			size: '640',
			proxy: useProxy
		});
		const resolved = getResolvedCoverUrl(cacheKey);
		if (resolved && !urls.includes(resolved)) {
			urls.push(resolved);
		}
		if (isCoverInFailureBackoff(cacheKey) && !resolved) {
			continue;
		}
		const candidates = getUnifiedCoverCandidates({
			coverId,
			size: '640',
			proxy: useProxy,
			includeLowerSizes: true
		});
		for (const candidate of candidates) {
			if (candidate && !urls.includes(candidate)) {
				urls.push(candidate);
			}
		}
	}
	return urls;
}

export function serializeCoverCandidates(candidates: string[]): string {
	return candidates.join(COVER_CANDIDATE_DELIMITER);
}

export function parseCoverCandidates(rawCandidates: string): string[] {
	return rawCandidates
		.split(COVER_CANDIDATE_DELIMITER)
		.map((candidate) => candidate.trim())
		.filter((candidate) => candidate.length > 0);
}
