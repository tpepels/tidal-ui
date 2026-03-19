import { queueClient } from '$lib/clients/queueClient';

export type RemoteQueueStatus =
	| 'queued'
	| 'processing'
	| 'paused'
	| 'completed'
	| 'failed'
	| 'cancelled';

export function resolveQueueProgress(total: number, completed: number, fallbackTrackCount: number): {
	total: number;
	completed: number;
} {
	const safeTotal = Number.isFinite(total) && total > 0 ? total : Math.max(0, fallbackTrackCount);
	const safeCompleted = Number.isFinite(completed) && completed > 0 ? completed : 0;
	if (safeTotal > 0) {
		return { total: safeTotal, completed: Math.min(safeTotal, safeCompleted) };
	}
	return { total: safeTotal, completed: safeCompleted };
}

export async function pollAlbumQueueJob(options: {
	jobId: string;
	currentTotalTracks: number;
	fallbackTrackCount: number;
	fetchImpl?: typeof fetch;
}): Promise<{
	status: RemoteQueueStatus;
	totalTracks: number;
	completedTracks: number;
	error: string | null;
} | null> {
	const job = await queueClient.getJob(options.jobId, options.fetchImpl);
	if (!job?.status) {
		return null;
	}

	const total = Number(job.trackCount);
	const completed = Number(job.completedTracks);
	const fallbackCompleted =
		Number(job.progress) * (options.currentTotalTracks || options.fallbackTrackCount || 0);
	const progress = resolveQueueProgress(
		total,
		Number.isFinite(completed) ? completed : fallbackCompleted,
		options.fallbackTrackCount
	);

	return {
		status: job.status,
		totalTracks: progress.total,
		completedTracks: progress.completed,
		error: job.error ?? null
	};
}

export async function requestAlbumQueueAction(options: {
	jobId: string;
	action: 'cancel' | 'resume';
	fetchImpl?: typeof fetch;
}): Promise<void> {
	const result = await queueClient.requestJobAction(options.jobId, options.action, {
		fetchImpl: options.fetchImpl
	});
	if (!result.success) {
		throw new Error(result.error || `Failed to ${options.action} download`);
	}
}
