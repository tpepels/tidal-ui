/**
 * Individual job operations
 * GET: Get job details
 * DELETE: Delete completed/failed job
 * PATCH: Request cancellation
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getJob, requestCancellation, requestRetry, deleteJob } from '$lib/server/downloadQueueManager';

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
 * PATCH /api/download-queue/:jobId
 * Request cancellation or retry of a job
 * 
 * Body: { action: 'cancel' | 'retry' }
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const { jobId } = params;
		const body = await request.json();
		const { action } = body as { action: string };

		if (action === 'cancel') {
			const cancelled = await requestCancellation(jobId);
			if (!cancelled) {
				return json(
					{ success: false, error: 'Could not cancel job (not found or already completed)' },
					{ status: 400 }
				);
			}

			return json({
				success: true,
				message: 'Cancellation requested',
				jobId
			});
		}

		if (action === 'retry') {
			const retried = await requestRetry(jobId);
			if (!retried) {
				return json(
					{
						success: false,
						error: 'Could not retry job (not found or status is not failed/cancelled)'
					},
					{ status: 400 }
				);
			}

			return json({
				success: true,
				message: 'Retry requested',
				jobId
			});
		}

		return json(
			{ success: false, error: 'Unknown action' },
			{ status: 400 }
		);
	} catch (error) {
		console.error('[Queue API] PATCH job error:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
};

/**
 * DELETE /api/download-queue/:jobId
 * Permanently delete a completed/failed job from queue
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

		// Can only delete completed or failed jobs
		if (job.status === 'queued' || job.status === 'processing') {
			return json(
				{ 
					success: false, 
					error: `Cannot delete ${job.status} job. Use PATCH to cancel instead.` 
				},
				{ status: 400 }
			);
		}

		const deleted = await deleteJob(jobId);

		if (!deleted) {
			return json(
				{ success: false, error: 'Could not delete job' },
				{ status: 500 }
			);
		}

		return json({
			success: true,
			message: 'Job permanently deleted',
			jobId
		});
	} catch (error) {
		console.error('[Queue API] DELETE job error:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{ success: false, error: message },
			{ status: 500 }
		);	}
};
