import { getJob } from './downloadQueueManager';

export async function waitWithJitter(baseMs: number): Promise<void> {
	const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseMs * 0.2)));
	await new Promise((resolve) => setTimeout(resolve, baseMs + jitter));
}

export async function shouldStopJob(jobId: string): Promise<'cancelled' | 'paused' | null> {
	const latest = await getJob(jobId);
	if (!latest) {
		return 'cancelled';
	}
	if (latest.cancellationRequested) {
		return 'cancelled';
	}
	if (latest.pauseRequested) {
		return 'paused';
	}
	return null;
}
