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

		// For processing jobs: mark as cancelled but keep briefly for audit trail
		// (will be cleaned up in next cleanup cycle)
		if (job.status === 'processing') {
			await updateJobStatus(jobId, {
				status: 'failed',
				error: 'Cancelled by user during processing',
				completedAt: Date.now()
			});
			return json({
				success: true,
				message: 'Job cancellation requested (in-flight work may continue)',
				jobId
			});
		}

		// For queued/completed/failed jobs: mark as failed with deletion marker
		if (job.status === 'queued' || job.status === 'completed' || job.status === 'failed') {
			await updateJobStatus(jobId, {
				status: 'failed',
				error: 'Deleted by user',
				completedAt: Date.now()
			});
			return json({
				success: true,
				message: 'Job marked for removal',
				jobId
			});
		}

		return json({
			success: true,
			message: 'Job status updated',
			jobId
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
