import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearCoverPipelineCaches,
	getCoverFailureBackoffMs,
	getResolvedCoverUrl,
	isCoverInFailureBackoff,
	markCoverFailed,
	markCoverResolved,
	prefetchCoverCandidates
} from './coverPipeline';
import { userPreferencesStore } from '$lib/stores/userPreferences';

class MockImage {
	static outcomes = new Map<string, boolean>();
	static createdCount = 0;
	onload: ((event: Event) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	private _src = '';

	static setOutcome(url: string, success: boolean): void {
		MockImage.outcomes.set(url, success);
	}

	set src(value: string) {
		MockImage.createdCount += 1;
		this._src = value;
		const success = MockImage.outcomes.get(value) ?? false;
		queueMicrotask(() => {
			if (success) {
				this.onload?.(new Event('load'));
				return;
			}
			this.onerror?.(new Event('error'));
		});
	}

	get src(): string {
		return this._src;
	}
}

const originalImage = globalThis.Image;
const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');

describe('coverPipeline', () => {
	beforeEach(() => {
		clearCoverPipelineCaches();
		MockImage.outcomes.clear();
		MockImage.createdCount = 0;
		globalThis.Image = MockImage as unknown as typeof Image;
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-13T00:00:00.000Z'));
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			value: 'visible'
		});
		userPreferencesStore.reset();
	});

	afterEach(() => {
		clearCoverPipelineCaches();
		globalThis.Image = originalImage;
		vi.useRealTimers();
		if (originalVisibilityState) {
			Object.defineProperty(document, 'visibilityState', originalVisibilityState);
		}
		userPreferencesStore.reset();
	});

	it('applies exponential failure backoff and clears it after success', () => {
		markCoverFailed('cover:key');
		const firstBackoff = getCoverFailureBackoffMs('cover:key');
		expect(firstBackoff).toBeGreaterThanOrEqual(900);
		expect(firstBackoff).toBeLessThanOrEqual(1100);
		expect(isCoverInFailureBackoff('cover:key')).toBe(true);

		markCoverFailed('cover:key');
		const secondBackoff = getCoverFailureBackoffMs('cover:key');
		expect(secondBackoff).toBeGreaterThan(firstBackoff);
		expect(secondBackoff).toBeGreaterThanOrEqual(1900);
		expect(secondBackoff).toBeLessThanOrEqual(2100);

		markCoverResolved('cover:key', 'https://img.example.com/cover.jpg');
		expect(isCoverInFailureBackoff('cover:key')).toBe(false);
		expect(getCoverFailureBackoffMs('cover:key')).toBe(0);
		expect(getResolvedCoverUrl('cover:key')).toBe('https://img.example.com/cover.jpg');
	});

	it('expires failure backoff after its timer window', () => {
		markCoverFailed('cover:key');
		const backoffMs = getCoverFailureBackoffMs('cover:key');
		expect(backoffMs).toBeGreaterThan(0);
		vi.advanceTimersByTime(backoffMs + 1);
		expect(isCoverInFailureBackoff('cover:key')).toBe(false);
		expect(getCoverFailureBackoffMs('cover:key')).toBe(0);
	});

	it('prefetches candidates and resolves to the first successful URL', async () => {
		MockImage.setOutcome('https://img.example.com/a.jpg', false);
		MockImage.setOutcome('https://img.example.com/b.jpg', true);

		await prefetchCoverCandidates([
			{
				cacheKey: 'cover:key',
				candidates: ['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg']
			}
		]);

		expect(getResolvedCoverUrl('cover:key')).toBe('https://img.example.com/b.jpg');
		expect(isCoverInFailureBackoff('cover:key')).toBe(false);
	});

	it('marks the cache key as failed when all prefetch candidates fail', async () => {
		MockImage.setOutcome('https://img.example.com/a.jpg', false);
		MockImage.setOutcome('https://img.example.com/b.jpg', false);

		await prefetchCoverCandidates([
			{
				cacheKey: 'cover:key',
				candidates: ['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg']
			}
		]);

		expect(getResolvedCoverUrl('cover:key')).toBeNull();
		expect(isCoverInFailureBackoff('cover:key')).toBe(true);
		expect(getCoverFailureBackoffMs('cover:key')).toBeGreaterThan(0);
	});

	it('skips prefetch work when the document is hidden', async () => {
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			value: 'hidden'
		});
		MockImage.setOutcome('https://img.example.com/a.jpg', true);

		await prefetchCoverCandidates([
			{
				cacheKey: 'cover:key',
				candidates: ['https://img.example.com/a.jpg']
			}
		]);

		expect(MockImage.createdCount).toBe(0);
		expect(getResolvedCoverUrl('cover:key')).toBeNull();
	});
});
