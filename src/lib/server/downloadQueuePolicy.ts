import type {
	CategorizedError,
	DownloadJob,
	JobPriority,
	QueueMetrics,
	QueuedJob,
	QueueStats
} from './downloadQueueTypes';

const PRIORITY_MAP: Record<JobPriority, number> = { high: 3, normal: 2, low: 1 };

type QueueCleanupRetentionPolicy = {
	completedMs: number;
	failedMs: number;
	cancelledMs: number;
	pausedMs: number;
};

function normalizeMusicBrainzReleaseKey(job: DownloadJob): string {
	const musicBrainzEnabled = job.experimentalMusicBrainzTagging !== false;
	if (
		!musicBrainzEnabled ||
		typeof job.musicBrainzReleaseId !== 'string' ||
		job.musicBrainzReleaseId.trim().length === 0
	) {
		return 'auto';
	}
	return job.musicBrainzReleaseId.trim().toLowerCase();
}

function jobStrictMatchEnabled(job: DownloadJob): boolean {
	return job.experimentalMusicBrainzTagging !== false ? job.strictMusicBrainzMatching === true : false;
}

export function categorizeError(error: string | Error, statusCode?: number): CategorizedError {
	const message = error instanceof Error ? error.message : error;
	const lowerMsg = message.toLowerCase();

	if (
		statusCode === 429 ||
		lowerMsg.includes('rate limit') ||
		lowerMsg.includes('too many requests')
	) {
		return {
			category: 'rate_limit',
			isRetryable: true,
			retryAfterMs: 60000,
			message
		};
	}

	if (
		lowerMsg.includes('timeout') ||
		lowerMsg.includes('econnrefused') ||
		lowerMsg.includes('enotfound') ||
		lowerMsg.includes('network')
	) {
		return {
			category: 'network',
			isRetryable: true,
			retryAfterMs: 5000,
			message
		};
	}

	if (
		statusCode === 401 ||
		statusCode === 403 ||
		lowerMsg.includes('unauthorized') ||
		lowerMsg.includes('forbidden')
	) {
		return {
			category: 'auth',
			isRetryable: false,
			message
		};
	}

	if (statusCode === 404 || lowerMsg.includes('not found')) {
		return {
			category: 'not_found',
			isRetryable: false,
			message
		};
	}

	if (statusCode && statusCode >= 500) {
		return {
			category: 'server_error',
			isRetryable: true,
			retryAfterMs: 30000,
			message
		};
	}

	if (statusCode && statusCode >= 400) {
		return {
			category: 'api_error',
			isRetryable: false,
			message
		};
	}

	return {
		category: 'unknown',
		isRetryable: true,
		retryAfterMs: 10000,
		message
	};
}

export function isDuplicateJobMatch(
	existingJob: QueuedJob,
	job: DownloadJob,
	now: number = Date.now()
): boolean {
	if (
		existingJob.status === 'completed' &&
		existingJob.completedAt &&
		now - existingJob.completedAt > 3600000
	) {
		return false;
	}

	if (existingJob.job.type !== job.type) {
		return false;
	}

	const existingMusicBrainz = existingJob.job.experimentalMusicBrainzTagging !== false;
	const requestedMusicBrainz = job.experimentalMusicBrainzTagging !== false;
	const strictMatches =
		existingMusicBrainz && requestedMusicBrainz
			? jobStrictMatchEnabled(existingJob.job) === jobStrictMatchEnabled(job)
			: true;
	const releaseMatches =
		existingMusicBrainz && requestedMusicBrainz
			? normalizeMusicBrainzReleaseKey(existingJob.job) === normalizeMusicBrainzReleaseKey(job)
			: true;

	if (job.type === 'track' && existingJob.job.type === 'track') {
		return (
			existingJob.job.trackId === job.trackId &&
			existingJob.job.quality === job.quality &&
			existingMusicBrainz === requestedMusicBrainz &&
			strictMatches &&
			releaseMatches
		);
	}

	if (job.type === 'album' && existingJob.job.type === 'album') {
		return (
			existingJob.job.albumId === job.albumId &&
			existingJob.job.quality === job.quality &&
			existingMusicBrainz === requestedMusicBrainz &&
			strictMatches &&
			releaseMatches
		);
	}

	return false;
}

export function selectNextQueuedJob(
	jobs: QueuedJob[],
	processingJobs: ReadonlySet<string>,
	now: number = Date.now()
): QueuedJob | null {
	const next = jobs
		.filter((job) => {
			if (processingJobs.has(job.id)) return false;
			if (job.cancellationRequested) return false;
			if (job.status !== 'queued') return false;
			if (job.nextRetryAt && job.nextRetryAt > now) return false;
			return true;
		})
		.sort((left, right) => {
			const priorityDiff =
				PRIORITY_MAP[right.priority || 'normal'] - PRIORITY_MAP[left.priority || 'normal'];
			if (priorityDiff !== 0) return priorityDiff;
			return left.createdAt - right.createdAt;
		})[0];

	return next ?? null;
}

export function shouldCleanupJob(
	job: QueuedJob,
	now: number,
	retention: QueueCleanupRetentionPolicy
): boolean {
	const endedAt = job.completedAt ?? job.lastUpdatedAt ?? job.startedAt ?? job.createdAt;
	const ageMs = now - endedAt;
	return (
		(job.status === 'completed' && ageMs > retention.completedMs) ||
		(job.status === 'failed' && ageMs > retention.failedMs) ||
		(job.status === 'cancelled' && ageMs > retention.cancelledMs) ||
		(job.status === 'paused' && ageMs > retention.pausedMs)
	);
}

export function resetTrackProgressForRetry(
	trackProgress: QueuedJob['trackProgress']
): QueuedJob['trackProgress'] | undefined {
	if (!trackProgress || !Array.isArray(trackProgress)) {
		return undefined;
	}
	return trackProgress.map((track) => ({
		...track,
		status: 'pending',
		error: undefined
	}));
}

export function summarizeQueueStats(jobs: QueuedJob[]): QueueStats {
	return {
		queued: jobs.filter((job) => job.status === 'queued').length,
		processing: jobs.filter((job) => job.status === 'processing').length,
		paused: jobs.filter((job) => job.status === 'paused').length,
		completed: jobs.filter((job) => job.status === 'completed').length,
		failed: jobs.filter((job) => job.status === 'failed').length,
		total: jobs.length
	};
}

export function buildQueueMetrics(jobs: QueuedJob[]): QueueMetrics {
	const completed = jobs.filter((job) => job.status === 'completed');
	const failed = jobs.filter((job) => job.status === 'failed');
	const total = completed.length + failed.length;

	const totalTime = jobs.reduce((sum, job) => {
		if (job.startedAt && job.completedAt) {
			return sum + (job.completedAt - job.startedAt);
		}
		return sum;
	}, 0);

	const avgRetries =
		jobs.reduce((sum, job) => sum + (job.retryCount || 0), 0) / Math.max(jobs.length, 1);

	const failureByCode: Record<string, number> = {};
	for (const job of failed) {
		const code = job.failureCode || 'UNKNOWN';
		failureByCode[code] = (failureByCode[code] || 0) + 1;
	}

	return {
		total_jobs: jobs.length,
		queued: jobs.filter((job) => job.status === 'queued').length,
		processing: jobs.filter((job) => job.status === 'processing').length,
		paused: jobs.filter((job) => job.status === 'paused').length,
		completed: completed.length,
		failed: failed.length,
		cancelled: jobs.filter((job) => job.status === 'cancelled').length,
		avg_success_rate: total > 0 ? Math.round((completed.length / total) * 100) : 0,
		avg_retry_count: Math.round(avgRetries * 100) / 100,
		total_download_time_ms: totalTime,
		avg_job_duration_ms: total > 0 ? Math.round(totalTime / total) : 0,
		failure_by_code: failureByCode
	};
}
