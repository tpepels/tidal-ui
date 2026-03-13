import {
	describeMusicBrainzMode,
	jobShortId,
	progressBucket,
	summarizeJob,
	type QueueJob,
	type QueueJobObservation
} from './model';

type LogTone = 'success' | 'error' | 'warning' | 'info';
type LogEvent = (tone: LogTone, message: string) => void;

function buildObservation(job: QueueJob): QueueJobObservation {
	return {
		status: job.status,
		progressBucket: progressBucket(job.progress),
		completedTracks: job.completedTracks ?? 0
	};
}

export function createQueueLifecycleTracker(logEvent: LogEvent) {
	let queueObservations: Record<string, QueueJobObservation> = {};
	let queueObservationsReady = false;

	const trackQueueLifecycleEvents = (nextJobs: QueueJob[]): void => {
		const nextObservations: Record<string, QueueJobObservation> = {};

		if (!queueObservationsReady) {
			for (const job of nextJobs) {
				nextObservations[job.id] = buildObservation(job);
			}
			queueObservations = nextObservations;
			queueObservationsReady = true;
			if (nextJobs.length > 0) {
				logEvent('info', `[Queue] Monitoring ${nextJobs.length} existing job(s).`);
			}
			return;
		}

		for (const job of nextJobs) {
			const prev = queueObservations[job.id];
			const label = summarizeJob(job);
			const shortId = jobShortId(job.id);
			const next = buildObservation(job);
			const musicBrainzMode = describeMusicBrainzMode(job);

			if (!prev) {
				if (musicBrainzMode) {
					logEvent(
						'info',
						`[MusicBrainz] ${label} (job ${shortId}): tagging enabled (${musicBrainzMode}).`
					);
				}
				if (job.status === 'completed') {
					logEvent('success', `[Queue] ${label} completed (job ${shortId}).`);
				} else if (job.status === 'failed') {
					logEvent(
						'error',
						`[Queue] ${label} failed (job ${shortId}): ${job.error ?? 'Unknown error'}`
					);
				} else if (job.status === 'cancelled' || job.status === 'paused') {
					logEvent('warning', `[Queue] ${label} is ${job.status} (job ${shortId}).`);
				} else {
					logEvent('info', `[Queue] New ${job.job.type} job ${shortId}: ${label} (${job.status}).`);
				}
			} else {
				if (prev.status !== job.status) {
					if (job.status === 'processing') {
						logEvent('info', `[Queue] Started ${label} (job ${shortId}).`);
					} else if (job.status === 'completed') {
						logEvent('success', `[Queue] Completed ${label} (job ${shortId}).`);
					} else if (job.status === 'failed') {
						logEvent(
							'error',
							`[Queue] Failed ${label} (job ${shortId}): ${job.error ?? 'Unknown error'}`
						);
					} else if (job.status === 'paused') {
						logEvent('warning', `[Queue] Paused ${label} (job ${shortId}).`);
					} else if (job.status === 'cancelled') {
						logEvent('warning', `[Queue] Cancelled ${label} (job ${shortId}).`);
					} else if (job.status === 'queued') {
						logEvent('info', `[Queue] Re-queued ${label} (job ${shortId}).`);
					}
					if (musicBrainzMode && job.status === 'completed') {
						logEvent(
							'success',
							`[MusicBrainz] ${label} (job ${shortId}): server tagging finished.`
						);
					} else if (musicBrainzMode && job.status === 'failed') {
						logEvent(
							'warning',
							`[MusicBrainz] ${label} (job ${shortId}): job failed before tagging could complete.`
						);
					}
				}

				if (job.status === 'processing' && next.progressBucket !== prev.progressBucket && next.progressBucket > 0) {
					logEvent('info', `[Queue] ${label} (job ${shortId}) progress ${next.progressBucket}%`);
				}

				if (
					job.job.type === 'album' &&
					job.status === 'processing' &&
					typeof job.trackCount === 'number' &&
					job.trackCount > 0 &&
					next.completedTracks !== prev.completedTracks
				) {
					logEvent(
						'info',
						`[Queue] ${label} (job ${shortId}) track ${next.completedTracks}/${job.trackCount}`
					);
				}
			}

			nextObservations[job.id] = next;
		}

		for (const previousJobId of Object.keys(queueObservations)) {
			if (nextObservations[previousJobId]) continue;
			logEvent('info', `[Queue] Job ${jobShortId(previousJobId)} removed from queue history.`);
		}

		queueObservations = nextObservations;
	};

	const reset = (): void => {
		queueObservations = {};
		queueObservationsReady = false;
	};

	return {
		trackQueueLifecycleEvents,
		reset
	};
}
