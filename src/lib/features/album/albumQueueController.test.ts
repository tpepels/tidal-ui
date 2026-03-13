import { describe, expect, it } from 'vitest';
import { pollAlbumQueueJob, requestAlbumQueueAction, resolveQueueProgress } from './albumQueueController';

describe('albumQueueController', () => {
	it('bounds completed progress to the total track count', () => {
		expect(resolveQueueProgress(10, 14, 8)).toEqual({ total: 10, completed: 10 });
		expect(resolveQueueProgress(NaN, 3, 7)).toEqual({ total: 7, completed: 3 });
	});

	it('parses queue poll payloads into stable state', async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(
				JSON.stringify({
					success: true,
					job: {
						status: 'processing',
						trackCount: 9,
						completedTracks: 4
					}
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);

		await expect(
			pollAlbumQueueJob({
				jobId: 'job-1',
				currentTotalTracks: 0,
				fallbackTrackCount: 7,
				fetchImpl
			})
		).resolves.toEqual({
			status: 'processing',
			totalTracks: 9,
			completedTracks: 4,
			error: null
		});
	});

	it('raises request errors for failed queue actions', async () => {
		const fetchImpl: typeof fetch = async () => new Response('boom', { status: 500 });

		await expect(
			requestAlbumQueueAction({
				jobId: 'job-2',
				action: 'cancel',
				fetchImpl
			})
		).rejects.toThrow('boom');
	});
});
