import type { QueueJob } from '$lib/features/download-manager/model';
import type { AudioQuality } from '$lib/types';

type FetchLike = typeof fetch;

export type QueueSource = 'redis' | 'memory';
export type QueueJobStatus =
	| 'queued'
	| 'processing'
	| 'paused'
	| 'completed'
	| 'failed'
	| 'cancelled';
export type QueueJobPriority = 'low' | 'normal' | 'high';
export type QueueJobAction =
	| 'cancel'
	| 'pause'
	| 'resume'
	| 'retry'
	| 'set_musicbrainz_release';

export interface QueueStats {
	queued: number;
	processing: number;
	paused: number;
	completed: number;
	failed: number;
	total: number;
}

export interface QueueMetrics {
	total_jobs: number;
	queued: number;
	processing: number;
	paused: number;
	completed: number;
	failed: number;
	cancelled: number;
	avg_success_rate: number;
	avg_retry_count: number;
	total_download_time_ms: number;
	avg_job_duration_ms: number;
	failure_by_code: Record<string, number>;
}

export interface QueueWorkerStatus {
	running: boolean;
	activeDownloads: number;
	maxConcurrent: number;
}

export interface QueueJobRecord extends QueueJob {
	priority?: QueueJobPriority;
	maxRetries?: number;
	retryCount?: number;
	nextRetryAt?: number;
	lastError?: string;
	errorCategory?: string;
	failureCode?: string;
	cancellationRequested?: boolean;
	pauseRequested?: boolean;
	trackProgress?: Array<{
		trackId: number;
		trackTitle?: string;
		status: 'pending' | 'downloading' | 'completed' | 'failed';
		error?: string;
	}>;
	downloadTimeMs?: number;
	fileSize?: number;
	fallbackHistory?: AudioQuality[];
}

export type QueueTrackJobInput = {
	type: 'track';
	trackId: number;
	quality: AudioQuality;
	albumTitle?: string;
	artistName?: string;
	trackTitle?: string;
	trackNumber?: number;
	coverUrl?: string;
	experimentalMusicBrainzTagging?: boolean;
	strictMusicBrainzMatching?: boolean;
	musicBrainzReleaseId?: string;
	targetArtistDir?: string;
	targetAlbumDir?: string;
	targetFilenameHint?: string;
	forceOverwrite?: boolean;
};

export type QueueAlbumJobInput = {
	type: 'album';
	albumId: number;
	quality: AudioQuality;
	albumTitle?: string;
	artistName?: string;
	trackCount?: number;
	experimentalMusicBrainzTagging?: boolean;
	strictMusicBrainzMatching?: boolean;
	musicBrainzReleaseId?: string;
	forceOverwrite?: boolean;
};

export type QueueJobInput = QueueTrackJobInput | QueueAlbumJobInput;

export interface QueueDashboardPayload {
	success: boolean;
	jobs: QueueJobRecord[];
	queue: QueueStats;
	metrics: QueueMetrics;
	worker: QueueWorkerStatus;
	queueSource?: QueueSource;
	warning?: string;
	localMode?: boolean;
	rateLimiting?: unknown;
	generatedAt?: string;
	error?: string;
}

export interface QueueSubmitResult {
	success: boolean;
	jobId?: string;
	message?: string;
	warning?: string;
	error?: string;
}

export interface QueueActionResult {
	success: boolean;
	error?: string;
}

type QueueEnvelope<T> = {
	success?: boolean;
	error?: string;
} & T;

async function readPayload<T>(response: Response): Promise<T | null> {
	try {
		const raw = await response.text();
		if (!raw) {
			return null;
		}
		try {
			return JSON.parse(raw) as T;
		} catch {
			return { error: raw.trim() || raw } as T;
		}
	} catch {
		return null;
	}
}

async function requestQueueJson<T>(
	path: string,
	init?: RequestInit,
	fetchImpl: FetchLike = fetch
): Promise<{ response: Response; payload: T | null }> {
	const response = await fetchImpl(path, init);
	const payload = await readPayload<T>(response);
	return { response, payload };
}

function requireSuccess<T extends { success?: boolean; error?: string }>(
	response: Response,
	payload: T | null,
	fallbackMessage: string
): asserts payload is T & { success: true } {
	if (!response.ok || !payload?.success) {
		throw new Error(payload?.error ?? fallbackMessage);
	}
}

export const queueClient = {
	async getDashboard(fetchImpl?: FetchLike): Promise<QueueDashboardPayload> {
		const { response, payload } = await requestQueueJson<QueueDashboardPayload>(
			'/api/download-queue/dashboard',
			undefined,
			fetchImpl
		);
		requireSuccess(response, payload, `Failed to fetch queue dashboard (${response.status})`);
		return payload;
	},

	async listJobs(
		options?: { status?: QueueJobStatus; fetchImpl?: FetchLike }
	): Promise<QueueJobRecord[]> {
		const params = new URLSearchParams();
		if (options?.status) {
			params.set('status', options.status);
		}
		const suffix = params.size > 0 ? `?${params.toString()}` : '';
		const { response, payload } = await requestQueueJson<QueueEnvelope<{ jobs?: QueueJobRecord[] }>>(
			`/api/download-queue${suffix}`,
			undefined,
			options?.fetchImpl
		);
		requireSuccess(response, payload, `Failed to fetch queue jobs (${response.status})`);
		return Array.isArray(payload.jobs) ? payload.jobs : [];
	},

	async getJob(jobId: string, fetchImpl?: FetchLike): Promise<QueueJobRecord | null> {
		const { response, payload } = await requestQueueJson<QueueEnvelope<{ job?: QueueJobRecord }>>(
			`/api/download-queue/${jobId}`,
			undefined,
			fetchImpl
		);
		if (response.status === 404) {
			return null;
		}
		requireSuccess(response, payload, `Failed to fetch queue job (${response.status})`);
		return payload.job ?? null;
	},

	async submitJob(
		input: {
			job: QueueJobInput;
			priority?: QueueJobPriority;
			maxRetries?: number;
			checkDuplicate?: boolean;
			forceOverwrite?: boolean;
		},
		fetchImpl?: FetchLike
	): Promise<QueueSubmitResult> {
		const { response, payload } = await requestQueueJson<QueueSubmitResult>(
			'/api/download-queue',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(input)
			},
			fetchImpl
		);
		requireSuccess(response, payload, `Failed to submit queue job (${response.status})`);
		return payload;
	},

	async requestJobAction(
		jobId: string,
		action: QueueJobAction,
		options?: {
			musicBrainzReleaseId?: string;
			fetchImpl?: FetchLike;
		}
	): Promise<QueueActionResult> {
		try {
			const { response, payload } = await requestQueueJson<QueueActionResult>(
				`/api/download-queue/${jobId}`,
				{
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action,
						musicBrainzReleaseId: options?.musicBrainzReleaseId
					})
				},
				options?.fetchImpl
			);
			if (!response.ok || !payload?.success) {
				return {
					success: false,
					error: payload?.error ?? `Failed to ${action} queue job`
				};
			}
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : `Failed to ${action} queue job`
			};
		}
	},

	async deleteJob(jobId: string, fetchImpl?: FetchLike): Promise<QueueActionResult> {
		try {
			const { response, payload } = await requestQueueJson<QueueActionResult>(
				`/api/download-queue/${jobId}`,
				{ method: 'DELETE' },
				fetchImpl
			);
			if (!response.ok || !payload?.success) {
				return {
					success: false,
					error: payload?.error ?? 'Failed to remove queue job'
				};
			}
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Failed to remove queue job'
			};
		}
	}
};
