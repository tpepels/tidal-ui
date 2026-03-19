import { queueClient } from '$lib/clients/queueClient';

export type QueueActionResult = {
	success: boolean;
	error?: string;
};

export async function runQueueJobAction(
	jobId: string,
	action: 'cancel' | 'pause' | 'resume' | 'retry'
): Promise<QueueActionResult> {
	return queueClient.requestJobAction(jobId, action);
}

export async function removeQueueJob(jobId: string): Promise<QueueActionResult> {
	return queueClient.deleteJob(jobId);
}
