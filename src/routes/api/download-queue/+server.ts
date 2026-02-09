/**
 * Server-side download queue API endpoint
 * POST: Submit new job
 * GET: List all jobs
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enqueueJob, getAllJobs, type DownloadJob } from '$lib/server/downloadQueueManager';

/**
 * POST /api/download-queue
 * Submit a new download job (track or album)
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { job } = body as { job: DownloadJob };

		if (!job || !job.type) {
			return json(
				{ success: false, error: 'Invalid job format' },
				{ status: 400 }
			);
		}

		// Validate track job
		if (job.type === 'track') {
			if (!job.trackId || !job.quality) {
				return json(
					{ success: false, error: 'Track job requires trackId and quality' },
					{ status: 400 }
				);
			}
		}

		// Validate album job
		if (job.type === 'album') {
			if (!job.albumId || !job.quality) {
				return json(
					{ success: false, error: 'Album job requires albumId and quality' },
					{ status: 400 }
				);
			}
		}

		const jobId = await enqueueJob(job);

		return json({
			success: true,
			jobId,
			message: `${job.type} job queued successfully`
		});
	} catch (error) {
		console.error('[Queue API] POST error:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
};

/**
 * GET /api/download-queue
 * List all jobs with their status
 */
export const GET: RequestHandler = async () => {
	try {
		const jobs = await getAllJobs();
		return json({
			success: true,
			jobs
		});
	} catch (error) {
		console.error('[Queue API] GET error:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
};
