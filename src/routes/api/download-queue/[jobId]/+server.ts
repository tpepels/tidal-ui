/**
 * Individual job operations
 * GET: Get job details
 * DELETE: Cancel/remove job
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getJob, updateJobStatus } from '$lib/server/downloadQueueManager';

/**
 * GET /api/download-queue/:jobId
 * Get status and details for a specific job
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const { jobId } = params;
		const job = await getJob(jobId);

		if (!job) {
			return json(
				{ success: false, error: 'Job not found' },
				{ status: 404 }
			);
		}

		return json({
			success: true,
			job
		});
	} catch (error) {
		console.error('[Queue API] GET job error:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
};

/**
 * DELETE /api/download-queue/:jobId
 * Cancel a queued job or remove completed/failed job
 */
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const { jobId } = params;
		const job = await getJob(jobId);

		if (!job) {
			return json(
				{ success: false, error: 'Job not found' },
				{ status: 404 }
			);
		}

		// If job is processing, mark as failed
		if (job.status === 'processing') {
			await updateJobStatus(jobId, {
				status: 'failed',
				error: 'Cancelled by user',
				completedAt: Date.now()
			});
			return json({
				success: true,
				message: 'Job cancelled'
			});
		}

		// For queued/completed/failed, update status to indicate deletion
		// The cleanup handler will remove it
		if (job.status === 'queued') {
			await updateJobStatus(jobId, {
				status: 'failed',
				error: 'Cancelled by user',
				completedAt: Date.now()
			});
		}

		return json({
			success: true,
			message: 'Job removed'
		});
	} catch (error) {
		console.error('[Queue API] DELETE job error:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
};
