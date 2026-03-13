import { describe, expect, it, vi } from 'vitest';
import {
	createArtistCoverHydrationController,
	parseCoverCandidates,
	serializeCoverCandidates
} from './artistCoverHydrationController';

describe('artistCoverHydrationController', () => {
	it('serializes and parses candidate lists', () => {
		const encoded = serializeCoverCandidates(['a', 'b', 'c']);
		expect(parseCoverCandidates(encoded)).toEqual(['a', 'b', 'c']);
	});

	it('increments generation and emits generation changes', () => {
		const onGenerationChange = vi.fn();
		const controller = createArtistCoverHydrationController({
			getCoverOverride: () => undefined,
			setCoverOverride: () => undefined,
			clearCoverFailure: () => undefined,
			fetchCoverFromApi: async () => null,
			onGenerationChange
		});

		expect(controller.beginGeneration()).toBe(1);
		expect(controller.beginGeneration()).toBe(2);
		expect(controller.getGeneration()).toBe(2);
		expect(onGenerationChange).toHaveBeenNthCalledWith(1, 1);
		expect(onGenerationChange).toHaveBeenNthCalledWith(2, 2);
	});

	it('deduplicates in-flight cover lookups for the same album and generation', async () => {
		const overrides = new Map<number, string>();
		const fetchCoverFromApi = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return 'cover-11';
		});
		const setCoverOverride = vi.fn((albumId: number, coverId: string) => {
			overrides.set(albumId, coverId);
		});
		const clearCoverFailure = vi.fn();

		const controller = createArtistCoverHydrationController({
			getCoverOverride: (albumId) => overrides.get(albumId),
			setCoverOverride,
			clearCoverFailure,
			fetchCoverFromApi
		});

		const generation = controller.beginGeneration();
		const first = controller.resolveCoverFromApi(11, generation);
		const second = controller.resolveCoverFromApi(11, generation);
		const [firstResult, secondResult] = await Promise.all([first, second]);

		expect(firstResult).toBe('cover-11');
		expect(secondResult).toBe('cover-11');
		expect(fetchCoverFromApi).toHaveBeenCalledTimes(1);
		expect(setCoverOverride).toHaveBeenCalledWith(11, 'cover-11');
		expect(clearCoverFailure).toHaveBeenCalledWith(11);
	});

	it('drops stale lookup results when generation changes', async () => {
		const overrides = new Map<number, string>();
		let resolveCover: ((value: string | null) => void) | undefined;
		const fetchCoverFromApi = vi.fn(
			() =>
				new Promise<string | null>((resolve) => {
					resolveCover = resolve;
				})
		);
		const setCoverOverride = vi.fn((albumId: number, coverId: string) => {
			overrides.set(albumId, coverId);
		});

		const controller = createArtistCoverHydrationController({
			getCoverOverride: (albumId) => overrides.get(albumId),
			setCoverOverride,
			clearCoverFailure: () => undefined,
			fetchCoverFromApi
		});

		const generationOne = controller.beginGeneration();
		const pending = controller.resolveCoverFromApi(20, generationOne);
		controller.beginGeneration();
		if (resolveCover) {
			resolveCover('cover-20');
		}
		const result = await pending;

		expect(result).toBeNull();
		expect(setCoverOverride).not.toHaveBeenCalled();
	});

	it('enqueues albums once per generation scheduler', async () => {
		const overrides = new Map<number, string>();
		const fetchCoverFromApi = vi.fn(async (albumId: number) => `cover-${albumId}`);
		const controller = createArtistCoverHydrationController({
			maxConcurrentLookups: 1,
			getCoverOverride: (albumId) => overrides.get(albumId),
			setCoverOverride: (albumId, coverId) => {
				overrides.set(albumId, coverId);
			},
			clearCoverFailure: () => undefined,
			fetchCoverFromApi
		});

		const generation = controller.beginGeneration();
		controller.enqueue(33, generation);
		controller.enqueue(33, generation);
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(fetchCoverFromApi).toHaveBeenCalledTimes(1);
		expect(overrides.get(33)).toBe('cover-33');
	});
});
