import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deduplicateMediaLibrary,
	type MediaLibraryDedupeProgress,
	type MediaLibraryDedupeSummary
} from '$lib/server/mediaLibrary';
import {
	acquireMediaMaintenanceLock,
	getMediaMaintenanceLockHolder
} from '$lib/server/mediaMaintenanceLock';
import { writeMediaMaintenanceRunReport } from '$lib/server/mediaMaintenanceReports';

type DeduplicateRequestBody = {
	dryRun?: boolean;
	forceRescan?: boolean;
	maxAlbums?: number;
};

type DeduplicateRunStatus = 'idle' | 'running' | 'completed' | 'failed';

type DeduplicateCompletionReport = {
	runId?: string;
	startedAt: number;
	finishedAt: number;
	durationMs: number;
	dryRun: boolean;
	albumsScanned: number;
	albumsMerged: number;
	filesMovedBetweenAlbums: number;
	filesMoveErrors: number;
	albumsSkipped: number;
	duplicateTrackGroups: number;
	manualReviewRequired: number;
	duplicateFilesBackedUp: number;
	backupErrors: number;
	movedSamples: string[];
	backedUpSamples: string[];
	skippedSamples: string[];
	failedSamples: string[];
	backupRoot?: string;
	reportPath?: string | null;
};

type DeduplicateStatusPayload = {
	success: true;
	status: DeduplicateRunStatus;
	startedAt: number | null;
	finishedAt: number | null;
	progress: MediaLibraryDedupeProgress | null;
	result: MediaLibraryDedupeSummary | null;
	report: DeduplicateCompletionReport | null;
	error: string | null;
};

let activeRun: Promise<MediaLibraryDedupeSummary> | null = null;
let runStatus: DeduplicateRunStatus = 'idle';
let runStartedAt: number | null = null;
let runFinishedAt: number | null = null;
let runProgress: MediaLibraryDedupeProgress | null = null;
let runResult: MediaLibraryDedupeSummary | null = null;
let runReport: DeduplicateCompletionReport | null = null;
let runError: string | null = null;

function setRunStarted(startedAt: number): void {
	runStatus = 'running';
	runStartedAt = startedAt;
	runFinishedAt = null;
	runProgress = null;
	runResult = null;
	runReport = null;
	runError = null;
}

function setRunProgress(progress: MediaLibraryDedupeProgress): void {
	runProgress = progress;
}

function setRunCompleted(
	finishedAt: number,
	result: MediaLibraryDedupeSummary,
	report: DeduplicateCompletionReport
): void {
	runStatus = 'completed';
	runFinishedAt = finishedAt;
	runResult = result;
	runReport = report;
}

function setRunFailed(finishedAt: number, error: string): void {
	runStatus = 'failed';
	runFinishedAt = finishedAt;
	runError = error;
}

export const POST: RequestHandler = async ({ request }) => {
	if (activeRun) {
		return json(
			{
				success: false,
				error: 'A deduplication run is already in progress'
			},
			{ status: 409 }
		);
	}

	let lock: Awaited<ReturnType<typeof acquireMediaMaintenanceLock>> | null = null;
	let currentRunId: string | null = null;
	try {
		const body = (await request.json().catch(() => ({}))) as DeduplicateRequestBody;
		lock = await acquireMediaMaintenanceLock({
			owner: `api:deduplicate:${Date.now()}`,
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
		const startedAt = Date.now();
		setRunStarted(startedAt);
		const dryRun = body.dryRun !== false;
		currentRunId = `dedupe-${startedAt}-${Math.random().toString(36).slice(2, 10)}`;
		const maxAlbums =
			typeof body.maxAlbums === 'number' && Number.isFinite(body.maxAlbums) && body.maxAlbums > 0
				? Math.trunc(body.maxAlbums)
				: undefined;
		console.log(
			'[Media Library API] deduplicate started',
			JSON.stringify({
				runId: currentRunId,
				dryRun,
				forceRescan: body.forceRescan === true,
				maxAlbums: maxAlbums ?? null
			})
		);

		activeRun = deduplicateMediaLibrary({
			dryRun,
			forceRescan: body.forceRescan === true,
			maxAlbums,
			runId: currentRunId,
			onProgress: (progress) => {
				setRunProgress(progress);
			}
		});
		const result = await activeRun;
		const finishedAt = Date.now();
		const report: DeduplicateCompletionReport = {
			runId: result.runId,
			startedAt,
			finishedAt,
			durationMs: Math.max(0, finishedAt - startedAt),
			dryRun: result.dryRun,
			albumsScanned: result.albumsScanned,
			albumsMerged: result.albumsMerged,
			filesMovedBetweenAlbums: result.filesMovedBetweenAlbums,
			filesMoveErrors: result.filesMoveErrors,
			albumsSkipped: result.albumsSkipped,
			duplicateTrackGroups: result.duplicateTrackGroups,
			manualReviewRequired: result.manualReviewRequired,
			duplicateFilesBackedUp: result.duplicateFilesBackedUp,
			backupErrors: result.backupErrors,
			movedSamples: result.movedSamples,
			backedUpSamples: result.backedUpSamples,
			skippedSamples: result.skippedSamples,
			failedSamples: result.failedSamples,
			backupRoot: result.backupRoot
		};
		report.reportPath = await writeMediaMaintenanceRunReport({
			runId: currentRunId,
			kind: 'deduplicate',
			payload: {
				result,
				report
			}
		});
		setRunCompleted(finishedAt, result, report);
		console.log('[Media Library API] deduplicate completed', JSON.stringify(result));
		console.log('[Media Library API] deduplicate report', JSON.stringify(report));

		return json({
			success: true,
			...result,
			report
		});
	} catch (error) {
		console.error('[Media Library API] deduplicate error:', error);
		const message =
			error instanceof Error ? error.message : 'Failed to deduplicate media library directories';
		if (currentRunId) {
			await writeMediaMaintenanceRunReport({
				runId: currentRunId,
				kind: 'deduplicate',
				payload: {
					error: message,
					startedAt: runStartedAt,
					finishedAt: Date.now(),
					progress: runProgress
				}
			});
		}
		setRunFailed(Date.now(), message);
		return json(
			{
				success: false,
				error: message
			},
			{ status: 500 }
		);
	} finally {
		activeRun = null;
		await lock?.release();
	}
};

export const GET: RequestHandler = async () => {
	const payload: DeduplicateStatusPayload = {
		success: true,
		status: runStatus,
		startedAt: runStartedAt,
		finishedAt: runFinishedAt,
		progress: runProgress,
		result: runResult,
		report: runReport,
		error: runError
	};
	return json(payload);
};
