import type { Album } from '$lib/types';
import {
	getCoverCacheKey,
	getResolvedCoverUrl,
	getUnifiedCoverCandidates,
	isCoverInFailureBackoff
} from '$lib/utils/coverPipeline';

type PendingCoverLookup = {
	generation: number;
	promise: Promise<string | null>;
};

type CoverHydrationScheduler = {
	generation: number;
	activeLookups: number;
	queue: number[];
	queuedAlbumIds: Set<number>;
};

type ArtistCoverHydrationControllerOptions = {
	maxConcurrentLookups?: number;
	getCoverOverride: (albumId: number) => string | undefined;
	setCoverOverride: (albumId: number, coverId: string) => void;
	clearCoverFailure: (albumId: number) => void;
	fetchCoverFromApi: (albumId: number, generation: number) => Promise<string | null>;
	onGenerationChange?: (generation: number) => void;
	onLookupError?: (albumId: number, error: unknown) => void;
};

const DEFAULT_MAX_CONCURRENT_LOOKUPS = 4;
const COVER_CANDIDATE_DELIMITER = '\n';

function createCoverHydrationScheduler(generation: number): CoverHydrationScheduler {
	return {
		generation,
		activeLookups: 0,
		queue: [],
		queuedAlbumIds: new Set<number>()
	};
}

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

export function createArtistCoverHydrationController(options: ArtistCoverHydrationControllerOptions) {
	const maxConcurrentLookups = options.maxConcurrentLookups ?? DEFAULT_MAX_CONCURRENT_LOOKUPS;
	const pendingAlbumCoverLookups = new Map<number, PendingCoverLookup>();
	let coverHydrationGenerationCounter = 0;
	let coverHydrationGeneration = 0;
	let coverHydrationScheduler: CoverHydrationScheduler = createCoverHydrationScheduler(0);

	function beginGeneration(): number {
		coverHydrationGenerationCounter += 1;
		coverHydrationGeneration = coverHydrationGenerationCounter;
		coverHydrationScheduler = createCoverHydrationScheduler(coverHydrationGenerationCounter);
		pendingAlbumCoverLookups.clear();
		options.onGenerationChange?.(coverHydrationGenerationCounter);
		return coverHydrationGenerationCounter;
	}

	function getGeneration(): number {
		return coverHydrationGeneration;
	}

	async function resolveCoverFromApi(albumId: number, generation: number): Promise<string | null> {
		if (!Number.isFinite(albumId) || albumId <= 0 || generation !== coverHydrationGeneration) {
			return null;
		}

		const existingOverride = options.getCoverOverride(albumId);
		if (existingOverride) {
			return existingOverride;
		}

		const pending = pendingAlbumCoverLookups.get(albumId);
		if (pending && pending.generation === generation) {
			return pending.promise;
		}
		if (pending && pending.generation !== generation) {
			pendingAlbumCoverLookups.delete(albumId);
		}

		const lookupPromise = (async () => {
			try {
				const cover = await options.fetchCoverFromApi(albumId, generation);
				if (!cover || generation !== coverHydrationGeneration) {
					return null;
				}
				options.setCoverOverride(albumId, cover);
				options.clearCoverFailure(albumId);
				return cover;
			} catch (lookupError) {
				if (generation === coverHydrationGeneration) {
					options.onLookupError?.(albumId, lookupError);
				}
				return null;
			} finally {
				const current = pendingAlbumCoverLookups.get(albumId);
				if (current && current.generation === generation) {
					pendingAlbumCoverLookups.delete(albumId);
				}
			}
		})();

		pendingAlbumCoverLookups.set(albumId, {
			generation,
			promise: lookupPromise
		});
		return lookupPromise;
	}

	function drainQueue(scheduler: CoverHydrationScheduler): void {
		if (
			scheduler !== coverHydrationScheduler ||
			scheduler.generation !== coverHydrationGeneration
		) {
			return;
		}

		while (scheduler.activeLookups < maxConcurrentLookups && scheduler.queue.length > 0) {
			const albumId = scheduler.queue.shift();
			if (albumId === undefined || !Number.isFinite(albumId)) {
				continue;
			}
			scheduler.activeLookups += 1;
			void resolveCoverFromApi(albumId, scheduler.generation)
				.catch(() => null)
				.finally(() => {
					scheduler.activeLookups = Math.max(0, scheduler.activeLookups - 1);
					scheduler.queuedAlbumIds.delete(albumId);
					drainQueue(scheduler);
				});
		}
	}

	function enqueue(albumId: number, generation: number): void {
		if (!Number.isFinite(albumId) || albumId <= 0 || generation !== coverHydrationGeneration) {
			return;
		}

		const scheduler = coverHydrationScheduler;
		if (scheduler.generation !== generation) {
			return;
		}
		if (scheduler.queuedAlbumIds.has(albumId)) {
			return;
		}

		scheduler.queuedAlbumIds.add(albumId);
		scheduler.queue.push(albumId);
		drainQueue(scheduler);
	}

	return {
		beginGeneration,
		getGeneration,
		enqueue,
		resolveCoverFromApi
	};
}
