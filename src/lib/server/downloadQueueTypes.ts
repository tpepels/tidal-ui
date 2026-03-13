import type { AudioQuality } from '$lib/types';

export type JobType = 'track' | 'album';
export type JobStatus = 'queued' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type JobPriority = 'low' | 'normal' | 'high';
export type ErrorCategory =
	| 'network'
	| 'api_error'
	| 'rate_limit'
	| 'auth'
	| 'not_found'
	| 'server_error'
	| 'unknown';
export type QueueSource = 'redis' | 'memory';

export interface CategorizedError {
	category: ErrorCategory;
	isRetryable: boolean;
	retryAfterMs?: number;
	message: string;
}

export interface TrackJob {
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
}

export interface AlbumJob {
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
}

export type DownloadJob = TrackJob | AlbumJob;

export interface QueuedJob {
	id: string;
	job: DownloadJob;
	status: JobStatus;
	progress: number;
	error?: string;
	errorCategory?: ErrorCategory;
	failureCode?: string;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	lastUpdatedAt?: number;
	trackCount?: number;
	completedTracks?: number;
	retryCount?: number;
	maxRetries?: number;
	nextRetryAt?: number;
	lastError?: string;
	priority?: JobPriority;
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

export type QueueStats = {
	queued: number;
	processing: number;
	paused: number;
	completed: number;
	failed: number;
	total: number;
};

export type QueueMetrics = {
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
};
