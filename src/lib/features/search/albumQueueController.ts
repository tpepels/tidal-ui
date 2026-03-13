import { isAlbumDownloadQueueActive, type AlbumDownloadStatus } from '$lib/controllers/albumDownloadUi';

export type AlbumDownloadState = {
	status: AlbumDownloadStatus;
	downloading: boolean;
	completed: number;
	total: number;
	error: string | null;
	queueJobId: string | null;
};

export type DownloadQueueJobStatus =
	| 'queued'
	| 'processing'
	| 'paused'
	| 'completed'
	| 'failed'
	| 'cancelled';

export type DownloadQueueJobPayload = {
	status?: DownloadQueueJobStatus;
	trackCount?: number;
	completedTracks?: number;
	progress?: number;
	error?: string;
};

export type DownloadQueuePayload = {
	success?: boolean;
	job?: DownloadQueueJobPayload;
	error?: string;
};

export type AlbumQueueAction = 'cancel' | 'resume';

type QueueActionResponse = {
	success: boolean;
	error?: string;
};

type FetchQueueJob = (jobId: string) => Promise<DownloadQueuePayload | null>;
type SendQueueAction = (jobId: string, action: AlbumQueueAction) => Promise<QueueActionResponse>;

type AlbumQueueControllerOptions = {
	getState: (albumId: number) => AlbumDownloadState;
	patchState: (albumId: number, patch: Partial<AlbumDownloadState>) => void;
	pollIntervalMs?: number;
	fetchQueueJob?: FetchQueueJob;
	sendQueueAction?: SendQueueAction;
	onPollingError?: (albumId: number, error: unknown) => void;
};

const DEFAULT_POLL_INTERVAL_MS = 1000;

function actionFailureMessage(action: AlbumQueueAction): string {
	return action === 'cancel' ? 'Failed to cancel album download' : 'Failed to resume album download';
}

async function defaultFetchQueueJob(jobId: string): Promise<DownloadQueuePayload | null> {
	try {
		const response = await fetch(`/api/download-queue/${jobId}`);
		if (!response.ok) {
			return null;
		}
		return (await response.json()) as DownloadQueuePayload;
	} catch {
		return null;
	}
}

async function defaultSendQueueAction(
	jobId: string,
	action: AlbumQueueAction
): Promise<QueueActionResponse> {
	try {
		const response = await fetch(`/api/download-queue/${jobId}`, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ action })
		});
		if (!response.ok) {
			const body = await response.text();
			return {
				success: false,
				error: body || actionFailureMessage(action)
			};
		}
		const payload = (await response.json().catch(() => null)) as
			| { success?: boolean; error?: string }
			| null;
		if (payload && payload.success === false) {
			return {
				success: false,
				error: payload.error || actionFailureMessage(action)
			};
		}
		return { success: true };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error && error.message ? error.message : actionFailureMessage(action)
		};
	}
}

export function createDefaultAlbumDownloadState(total = 0): AlbumDownloadState {
	return {
		status: 'idle',
		downloading: false,
		completed: 0,
		total,
		error: null,
		queueJobId: null
	};
}

export function isAlbumQueueDownloadCancellable(state: AlbumDownloadState | undefined): boolean {
	if (!state) return false;
	return isAlbumDownloadQueueActive(state.status);
}

export function resolveAlbumQueueProgress(
	state: Pick<AlbumDownloadState, 'total' | 'completed'>,
	job: {
		trackCount?: number;
		completedTracks?: number;
		progress?: number;
	}
): { total: number; completed: number } {
	const totalCandidate = Number(job.trackCount);
	const completedCandidate = Number(job.completedTracks);
	const progressCandidate = Number(job.progress);

	const total =
		Number.isFinite(totalCandidate) && totalCandidate > 0
			? totalCandidate
			: state.total > 0
				? state.total
				: 0;
	const progressCompleted =
		Number.isFinite(progressCandidate) && total > 0
			? Math.round(progressCandidate * total)
			: state.completed;
	const completed =
		Number.isFinite(completedCandidate) && completedCandidate >= 0
			? completedCandidate
			: progressCompleted;

	if (total > 0) {
		return { total, completed: Math.min(total, Math.max(0, completed)) };
	}
	return { total, completed: Math.max(0, completed) };
}

export function reconcileAlbumQueueJobState(
	current: AlbumDownloadState,
	job: DownloadQueueJobPayload
): {
	patch: Partial<AlbumDownloadState>;
	terminal: boolean;
} {
	const progress = resolveAlbumQueueProgress(current, job);

	switch (job.status) {
		case 'queued':
			return {
				patch: {
					status: 'queued',
					downloading: false,
					total: progress.total,
					completed: progress.completed,
					error: null
				},
				terminal: false
			};
		case 'processing':
			return {
				patch: {
					status: 'processing',
					downloading: true,
					total: progress.total,
					completed: progress.completed,
					error: null
				},
				terminal: false
			};
		case 'paused':
			return {
				patch: {
					status: 'paused',
					downloading: false,
					total: progress.total,
					completed: progress.completed,
					error: null
				},
				terminal: true
			};
		case 'completed':
			return {
				patch: {
					status: 'completed',
					downloading: false,
					total: progress.total,
					completed: progress.total || progress.completed,
					error: null,
					queueJobId: null
				},
				terminal: true
			};
		case 'cancelled':
			return {
				patch: {
					status: 'cancelled',
					downloading: false,
					error: null,
					queueJobId: null
				},
				terminal: true
			};
		case 'failed':
			return {
				patch: {
					status: 'failed',
					downloading: false,
					error: job.error ?? 'Album download failed.',
					queueJobId: null
				},
				terminal: true
			};
		default:
			return {
				patch: {},
				terminal: false
			};
	}
}

export function createAlbumQueueController(options: AlbumQueueControllerOptions) {
	const fetchQueueJob = options.fetchQueueJob ?? defaultFetchQueueJob;
	const sendQueueAction = options.sendQueueAction ?? defaultSendQueueAction;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const pollTimers = new Map<number, ReturnType<typeof setInterval>>();
	const pollTokens = new Map<number, number>();

	async function pollAlbumQueueJob(albumId: number, jobId: string, pollToken: number): Promise<void> {
		if (!jobId || pollTokens.get(albumId) !== pollToken) {
			return;
		}

		try {
			const payload = await fetchQueueJob(jobId);
			if (!payload?.success || !payload.job || pollTokens.get(albumId) !== pollToken) {
				return;
			}
			const current = options.getState(albumId);
			const next = reconcileAlbumQueueJobState(current, payload.job);
			if (Object.keys(next.patch).length > 0) {
				options.patchState(albumId, next.patch);
			}
			if (next.terminal) {
				stopPolling(albumId);
			}
		} catch (error) {
			options.onPollingError?.(albumId, error);
		}
	}

	function stopPolling(albumId: number): void {
		const timer = pollTimers.get(albumId);
		if (timer) {
			clearInterval(timer);
			pollTimers.delete(albumId);
		}
		pollTokens.delete(albumId);
	}

	function stopAllPolling(): void {
		for (const timer of pollTimers.values()) {
			clearInterval(timer);
		}
		pollTimers.clear();
		pollTokens.clear();
	}

	function startPolling(albumId: number, jobId: string): void {
		stopPolling(albumId);
		const currentToken = (pollTokens.get(albumId) ?? 0) + 1;
		pollTokens.set(albumId, currentToken);
		void pollAlbumQueueJob(albumId, jobId, currentToken);
		const timer = setInterval(() => {
			void pollAlbumQueueJob(albumId, jobId, currentToken);
		}, pollIntervalMs);
		pollTimers.set(albumId, timer);
	}

	async function cancelQueueDownload(albumId: number): Promise<QueueActionResponse> {
		const state = options.getState(albumId);
		if (!isAlbumQueueDownloadCancellable(state) || !state.queueJobId) {
			return { success: false };
		}
		const result = await sendQueueAction(state.queueJobId, 'cancel');
		if (!result.success) {
			return result;
		}
		options.patchState(albumId, {
			status: 'cancelled',
			downloading: false,
			error: null,
			queueJobId: null
		});
		stopPolling(albumId);
		return { success: true };
	}

	async function resumeQueueDownload(albumId: number): Promise<QueueActionResponse> {
		const state = options.getState(albumId);
		if (state.status !== 'paused' || !state.queueJobId) {
			return { success: false };
		}
		const result = await sendQueueAction(state.queueJobId, 'resume');
		if (!result.success) {
			return result;
		}
		options.patchState(albumId, {
			status: 'queued',
			downloading: false,
			error: null
		});
		startPolling(albumId, state.queueJobId);
		return { success: true };
	}

	return {
		startPolling,
		stopPolling,
		stopAllPolling,
		cancelQueueDownload,
		resumeQueueDownload
	};
}
