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
	const fetchImpl = options.fetchImpl ?? fetch;
	const response = await fetchImpl(`/api/download-queue/${options.jobId}`);
	if (!response.ok) {
		return null;
	}
	const payload = (await response.json()) as {
		success?: boolean;
		job?: {
			status?: RemoteQueueStatus;
			trackCount?: number;
			completedTracks?: number;
			progress?: number;
			error?: string;
		};
	};
	if (!payload.success || !payload.job || !payload.job.status) {
		return null;
	}

	const total = Number(payload.job.trackCount);
	const completed = Number(payload.job.completedTracks);
	const fallbackCompleted =
		Number(payload.job.progress) * (options.currentTotalTracks || options.fallbackTrackCount || 0);
	const progress = resolveQueueProgress(
		total,
		Number.isFinite(completed) ? completed : fallbackCompleted,
		options.fallbackTrackCount
	);

	return {
		status: payload.job.status,
		totalTracks: progress.total,
		completedTracks: progress.completed,
		error: payload.job.error ?? null
	};
}

export async function requestAlbumQueueAction(options: {
	jobId: string;
	action: 'cancel' | 'resume';
	fetchImpl?: typeof fetch;
}): Promise<void> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const response = await fetchImpl(`/api/download-queue/${options.jobId}`, {
		method: 'PATCH',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ action: options.action })
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(body || `Failed to ${options.action} download`);
	}
}
