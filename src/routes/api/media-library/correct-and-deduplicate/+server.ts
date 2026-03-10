import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deduplicateMediaLibrary,
	sweepTransientAlbumArtifacts,
	type MediaLibraryDedupeProgress,
	type MediaLibraryDedupeSummary,
	type MediaLibraryTransientSweepSummary
} from '$lib/server/mediaLibrary';
import { getActiveJobIdsForMaintenance } from '$lib/server/downloadQueueManager';
import {
	acquireMediaMaintenanceLock,
	getMediaMaintenanceLockHolder
} from '$lib/server/mediaMaintenanceLock';
import { writeMediaMaintenanceRunReport } from '$lib/server/mediaMaintenanceReports';

type CorrectAndDeduplicateRequestBody = {
	dryRun?: boolean;
	forceRescan?: boolean;
	maxAlbums?: number;
};

type CorrectAndDeduplicateRunStatus = 'idle' | 'running' | 'completed' | 'failed';

type CorrectAndDeduplicateReport = {
	runId: string;
	startedAt: number;
	finishedAt: number;
	durationMs: number;
	dryRun: boolean;
	sweep: MediaLibraryTransientSweepSummary;
	deduplicate: MediaLibraryDedupeSummary;
	reportPath?: string | null;
};

type CorrectAndDeduplicateStatusPayload = {
	success: true;
	status: CorrectAndDeduplicateRunStatus;
	runId: string | null;
	phase: 'idle' | 'sweep' | 'deduplicate' | 'completed' | 'failed';
	startedAt: number | null;
	finishedAt: number | null;
	progress: MediaLibraryDedupeProgress | null;
	result: CorrectAndDeduplicateReport | null;
	error: string | null;
};

let activeRun: Promise<CorrectAndDeduplicateReport> | null = null;
let runStatus: CorrectAndDeduplicateRunStatus = 'idle';
let runId: string | null = null;
let runPhase: CorrectAndDeduplicateStatusPayload['phase'] = 'idle';
let runStartedAt: number | null = null;
let runFinishedAt: number | null = null;
let runProgress: MediaLibraryDedupeProgress | null = null;
let runResult: CorrectAndDeduplicateReport | null = null;
let runError: string | null = null;

function setRunStarted(startedAt: number, currentRunId: string): void {
	runStatus = 'running';
	runId = currentRunId;
	runPhase = 'sweep';
	runStartedAt = startedAt;
	runFinishedAt = null;
	runProgress = null;
	runResult = null;
	runError = null;
}

function setRunPhase(phase: CorrectAndDeduplicateStatusPayload['phase']): void {
	runPhase = phase;
}

function setRunProgress(progress: MediaLibraryDedupeProgress): void {
	runProgress = progress;
}

function setRunCompleted(result: CorrectAndDeduplicateReport): void {
	runStatus = 'completed';
	runPhase = 'completed';
	runFinishedAt = result.finishedAt;
	runResult = result;
}

function setRunFailed(error: string): void {
	runStatus = 'failed';
	runPhase = 'failed';
	runFinishedAt = Date.now();
	runError = error;
}

export const POST: RequestHandler = async ({ request }) => {
	if (activeRun) {
		return json(
			{
				success: false,
				error: 'A correction + deduplicate run is already in progress'
			},
			{ status: 409 }
		);
	}

	let lock: Awaited<ReturnType<typeof acquireMediaMaintenanceLock>> | null = null;
	let currentRunId: string | null = null;
	let partialSweep: MediaLibraryTransientSweepSummary | null = null;
	let partialDeduplicate: MediaLibraryDedupeSummary | null = null;
	try {
		const body = (await request.json().catch(() => ({}))) as CorrectAndDeduplicateRequestBody;
		const dryRun = body.dryRun === true;
		const forceRescan = body.forceRescan === true;
		const maxAlbums =
			typeof body.maxAlbums === 'number' && Number.isFinite(body.maxAlbums) && body.maxAlbums > 0
				? Math.trunc(body.maxAlbums)
				: undefined;
		const startedAt = Date.now();
		currentRunId = `correct-dedup-${startedAt}-${Math.random().toString(36).slice(2, 10)}`;
		lock = await acquireMediaMaintenanceLock({
			owner: `api:correct-and-deduplicate:${currentRunId}`,
			waitTimeoutMs: 0
		});
		if (!lock) {
			const holder = await getMediaMaintenanceLockHolder();
			return json(
				{
					success: false,
					error: 'Media-library maintenance is already running',
					holder
				},
				{ status: 409 }
			);
		}

		setRunStarted(startedAt, currentRunId);
		console.log(
			'[Media Library API] correct-and-deduplicate started',
			JSON.stringify({
				runId: currentRunId,
				dryRun,
				forceRescan,
				maxAlbums: maxAlbums ?? null
			})
		);

		activeRun = (async (): Promise<CorrectAndDeduplicateReport> => {
			const activeJobIds = await getActiveJobIdsForMaintenance();
			const sweep = await sweepTransientAlbumArtifacts({
				dryRun,
				activeJobIds
			});
			partialSweep = sweep;
			setRunPhase('deduplicate');
			const deduplicate = await deduplicateMediaLibrary({
				dryRun,
				forceRescan,
				maxAlbums,
				runId: currentRunId,
				onProgress: (progress) => {
					setRunProgress(progress);
				}
			});
			partialDeduplicate = deduplicate;
			const finishedAt = Date.now();
			const result: CorrectAndDeduplicateReport = {
				runId: currentRunId,
				startedAt,
				finishedAt,
				durationMs: Math.max(0, finishedAt - startedAt),
				dryRun,
				sweep,
				deduplicate
			};
			result.reportPath = await writeMediaMaintenanceRunReport({
				runId: currentRunId,
				kind: 'correct-and-deduplicate',
				payload: result
			});
			return result;
		})();

		const result = await activeRun;
		setRunCompleted(result);
		console.log('[Media Library API] correct-and-deduplicate completed', JSON.stringify(result));
		return json({
			success: true,
			...result
		});
	} catch (error) {
		console.error('[Media Library API] correct-and-deduplicate error:', error);
		const message =
			error instanceof Error
				? error.message
				: 'Failed to run correction sweep and deduplication';
		const partial = {
			sweep: partialSweep,
			deduplicate: partialDeduplicate
		};
		if (currentRunId) {
			await writeMediaMaintenanceRunReport({
				runId: currentRunId,
				kind: 'correct-and-deduplicate',
				payload: {
					error: message,
					startedAt: runStartedAt,
					finishedAt: Date.now(),
					phase: runPhase,
					progress: runProgress,
					partial
				}
			});
		}
		setRunFailed(message);
		return json(
			{
				success: false,
				error: message,
				partial
			},
			{ status: 500 }
		);
	} finally {
		activeRun = null;
		await lock?.release();
	}
};

export const GET: RequestHandler = async () => {
	const payload: CorrectAndDeduplicateStatusPayload = {
		success: true,
		status: runStatus,
		runId,
		phase: runPhase,
		startedAt: runStartedAt,
		finishedAt: runFinishedAt,
		progress: runProgress,
		result: runResult,
		error: runError
	};
	return json(payload);
};
