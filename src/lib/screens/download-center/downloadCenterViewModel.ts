import type { QueueJob } from '$lib/features/download-manager/model';

export type DownloadCenterStatsVM = {
	running: number;
	queued: number;
	paused: number;
	completed: number;
	failed: number;
	total: number;
};

const statusPriority: Record<QueueJob['status'], number> = {
	processing: 0,
	queued: 1,
	paused: 2,
	failed: 3,
	cancelled: 4,
	completed: 5
};

export function sortDownloadCenterJobs(jobs: QueueJob[]): QueueJob[] {
	return [...jobs].sort((a, b) => {
		const priorityDiff = statusPriority[a.status] - statusPriority[b.status];
		if (priorityDiff !== 0) {
			return priorityDiff;
		}
		return (
			(b.lastUpdatedAt ?? b.completedAt ?? b.createdAt) -
			(a.lastUpdatedAt ?? a.completedAt ?? a.createdAt)
		);
	});
}

export function buildDownloadCenterSectionNavItems(showDetailedSections: boolean) {
	const items: Array<{
		id: string;
		label: string;
		tone?: 'secondary' | 'tertiary';
	}> = [
		{ id: 'download-center-summary', label: 'Summary', tone: 'secondary' as const },
		{ id: 'download-center-priority', label: 'Priority', tone: 'secondary' as const }
	];
	if (showDetailedSections) {
		items.push({ id: 'download-center-details', label: 'Timeline', tone: 'tertiary' as const });
	}
	return items;
}

export function buildDownloadCenterStatusHeadline(stats: DownloadCenterStatsVM): string {
	if (stats.running > 0) {
		return `${stats.running} active download${stats.running === 1 ? '' : 's'}`;
	}
	if (stats.queued > 0) {
		return `${stats.queued} queued download${stats.queued === 1 ? '' : 's'}`;
	}
	return 'Download queue is idle';
}

export function buildDownloadCenterStatusSubline(options: {
	stats: DownloadCenterStatsVM;
	pausedCount: number;
	resumableCount: number;
}): string {
	return `${options.stats.queued} queued · ${options.pausedCount} paused · ${options.resumableCount} needs attention`;
}

export function buildDownloadCenterRedisStatus(queueSource: string | null | undefined) {
	if (queueSource === 'redis') {
		return { label: 'Redis: connected', state: 'ok' as const };
	}
	if (queueSource === 'memory') {
		return { label: 'Redis: unavailable', state: 'warn' as const };
	}
	return { label: 'Redis: unknown', state: 'unknown' as const };
}

export function buildDownloadCenterPollStatusLabel(options: {
	pollingError: string | null;
	nextPollAt: number;
	pollCountdownSeconds: number;
}): string {
	if (options.pollingError) {
		return `Retry in ${options.pollCountdownSeconds}s`;
	}
	if (options.nextPollAt > 0) {
		return `Next poll in ${options.pollCountdownSeconds}s`;
	}
	return 'Polling paused';
}
