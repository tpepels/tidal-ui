export interface QueueJob {
	id: string;
	status: 'queued' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
	job: {
		type: 'track' | 'album';
		trackId?: number;
		trackTitle?: string;
		artistName?: string;
		albumTitle?: string;
		albumId?: number;
		quality?: string;
		experimentalMusicBrainzTagging?: boolean;
		strictMusicBrainzMatching?: boolean;
		musicBrainzReleaseId?: string;
	};
	progress: number;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	lastUpdatedAt?: number;
	error?: string;
	trackCount?: number;
	completedTracks?: number;
}

export interface QueueJobObservation {
	status: QueueJob['status'];
	progressBucket: number;
	completedTracks: number;
}

export type JobTypeFilter = 'all' | 'albums' | 'tracks';
export type CollapsibleSection = 'active' | 'queue' | 'failed';

export function matchesTypeFilter(job: QueueJob, filter: JobTypeFilter): boolean {
	if (filter === 'all') return true;
	return filter === 'albums' ? job.job.type === 'album' : job.job.type === 'track';
}

export function summarizeJob(job: QueueJob): string {
	const title = job.job.trackTitle || job.job.albumTitle || 'Unknown';
	const artist = job.job.artistName ? ` by ${job.job.artistName}` : '';
	return `${title}${artist}`;
}

export function describeMusicBrainzMode(job: QueueJob): string | null {
	if (job.job.experimentalMusicBrainzTagging === false) {
		return null;
	}
	const baseMode = job.job.strictMusicBrainzMatching === true ? 'strict ISRC mode' : 'flex mode';
	return job.job.musicBrainzReleaseId ? `${baseMode} (release selected)` : baseMode;
}

export function jobShortId(jobId: string): string {
	return jobId.slice(0, 8);
}

export function progressBucket(progress: number): number {
	const clamped = Math.max(0, Math.min(1, progress));
	return Math.min(100, Math.floor((clamped * 100) / 20) * 20);
}

export const downloadManagerActionKeys = {
	refresh: 'refresh',
	bulkPause: 'bulk-pause',
	bulkStop: 'bulk-stop',
	bulkResume: 'bulk-resume',
	bulkReport: 'bulk-report',
	createBundle: 'create-bundle',
	clearHistory: 'clear-history'
} as const;

const jobActionKey = (jobId: string, action: string): string => `job:${jobId}:${action}`;

export const cancelActionKey = (jobId: string): string => jobActionKey(jobId, 'cancel');
export const pauseActionKey = (jobId: string): string => jobActionKey(jobId, 'pause');
export const resumeActionKey = (jobId: string): string => jobActionKey(jobId, 'resume');
export const retryActionKey = (jobId: string): string => jobActionKey(jobId, 'retry');
export const deleteActionKey = (jobId: string): string => jobActionKey(jobId, 'delete');
export const reportActionKey = (jobId: string): string => jobActionKey(jobId, 'report');
