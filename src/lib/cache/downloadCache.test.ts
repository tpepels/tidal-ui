import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDownloadCache } from './downloadCache';
import type { TrackDownloadTask } from '$lib/stores/downloadState';

const storageKey = 'test-download-cache';

const makeTask = (overrides?: Partial<TrackDownloadTask>): TrackDownloadTask => ({
	id: 'task-1',
	trackId: 1,
	title: 'Test Track',
	subtitle: 'Test Artist',
	filename: 'test.flac',
	status: 'running',
	phase: 'downloading',
	storage: 'client',
	receivedBytes: 0,
	totalBytes: 100,
	progress: 0,
	error: undefined,
	startedAt: Date.now(),
	updatedAt: Date.now(),
	cancellable: true,
	controller: undefined,
	...overrides
});

describe('downloadCache', () => {
	beforeEach(() => {
		localStorage.removeItem(storageKey);
	});

	afterEach(() => {
		localStorage.removeItem(storageKey);
	});

	it('reconciles running entries on load', () => {
		const now = Date.now();
		const state = {
			version: 1,
			entries: [
				{
					id: 'task-1',
					trackId: 1,
					title: 'Track',
					filename: 'track.flac',
					status: 'running',
					startedAt: now - 5000,
					updatedAt: now - 5000
				}
			]
		};
		localStorage.setItem(storageKey, JSON.stringify(state));

		const cache = createDownloadCache({ storageKey, maxEntryAgeMs: 100000 });
		const entries = cache.getState().entries;

		expect(entries).toHaveLength(1);
		expect(entries[0]?.status).toBe('cancelled');
		expect(entries[0]?.error).toBe('Session ended before completion');
	});

	it('prunes stale entries beyond max age', () => {
		const now = Date.now();
		const state = {
			version: 1,
			entries: [
				{
					id: 'task-1',
					trackId: 1,
					title: 'Track',
					filename: 'track.flac',
					status: 'completed',
					startedAt: now - 1000,
					updatedAt: now - 1000
				}
			]
		};
		localStorage.setItem(storageKey, JSON.stringify(state));

		const cache = createDownloadCache({ storageKey, maxEntryAgeMs: 10 });
		const entries = cache.getState().entries;

		expect(entries).toHaveLength(0);
	});

	it('records terminal status updates', () => {
		const cache = createDownloadCache({ storageKey });
		const task = makeTask();

		cache.recordStart(task);
		cache.markCompleted(task.id);

		const entries = cache.getState().entries;
		expect(entries).toHaveLength(1);
		expect(entries[0]?.status).toBe('completed');

		cache.markFailed(task.id, 'Failed');
		expect(cache.getState().entries[0]?.status).toBe('error');
		expect(cache.getState().entries[0]?.error).toBe('Failed');

		cache.markCancelled(task.id);
		expect(cache.getState().entries[0]?.status).toBe('cancelled');
	});
});
