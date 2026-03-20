import { describe, expect, it } from 'vitest';
import type { QueueJob } from '$lib/features/download-manager/model';
import {
	buildDownloadCenterSectionNavItems,
	buildDownloadCenterStatusHeadline,
	sortDownloadCenterJobs
} from './downloadCenterViewModel';

describe('downloadCenterViewModel', () => {
	it('sorts processing jobs ahead of queued jobs', () => {
		const jobs = [
			{
				id: 'queued-1',
				status: 'queued',
				job: { type: 'track' },
				progress: 0,
				createdAt: 1
			},
			{
				id: 'processing-1',
				status: 'processing',
				job: { type: 'track' },
				progress: 0.4,
				createdAt: 2
			}
		] as QueueJob[];

		const sorted = sortDownloadCenterJobs(jobs);
		expect(sorted[0]?.id).toBe('processing-1');
	});

	it('adds the timeline tab only when details are visible', () => {
		expect(buildDownloadCenterSectionNavItems(false)).toHaveLength(2);
		expect(buildDownloadCenterSectionNavItems(true)).toHaveLength(3);
	});

	it('builds a status headline from queue activity', () => {
		expect(
			buildDownloadCenterStatusHeadline({
				running: 2,
				queued: 1,
				paused: 0,
				completed: 0,
				failed: 0,
				total: 3
			})
		).toContain('2 active downloads');
	});
});
