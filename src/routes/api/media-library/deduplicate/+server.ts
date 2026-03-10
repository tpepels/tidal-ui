import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deduplicateMediaLibrary,
	type MediaLibraryDedupeProgress,
	type MediaLibraryDedupeSummary
} from '$lib/server/mediaLibrary';

type DeduplicateRequestBody = {
	dryRun?: boolean;
	forceRescan?: boolean;
	maxAlbums?: number;
};

type DeduplicateRunStatus = 'idle' | 'running' | 'completed' | 'failed';

type DeduplicateCompletionReport = {
	startedAt: number;
	finishedAt: number;
	durationMs: number;
	dryRun: boolean;
	albumsScanned: number;
	albumsMerged: number;
	filesMovedBetweenAlbums: number;
	duplicateTrackGroups: number;
	duplicateFilesBackedUp: number;
	backupRoot?: string;
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

	try {
		const body = (await request.json().catch(() => ({}))) as DeduplicateRequestBody;
		const startedAt = Date.now();
		setRunStarted(startedAt);
		const dryRun = body.dryRun !== false;
		const maxAlbums =
			typeof body.maxAlbums === 'number' && Number.isFinite(body.maxAlbums) && body.maxAlbums > 0
				? Math.trunc(body.maxAlbums)
				: undefined;
		console.log(
			'[Media Library API] deduplicate started',
			JSON.stringify({
				dryRun,
				forceRescan: body.forceRescan === true,
				maxAlbums: maxAlbums ?? null
			})
		);

		activeRun = deduplicateMediaLibrary({
			dryRun,
			forceRescan: body.forceRescan === true,
			maxAlbums,
			onProgress: (progress) => {
				setRunProgress(progress);
			}
		});
		const result = await activeRun;
		const finishedAt = Date.now();
		const report: DeduplicateCompletionReport = {
			startedAt,
			finishedAt,
			durationMs: Math.max(0, finishedAt - startedAt),
			dryRun: result.dryRun,
			albumsScanned: result.albumsScanned,
			albumsMerged: result.albumsMerged,
			filesMovedBetweenAlbums: result.filesMovedBetweenAlbums,
			duplicateTrackGroups: result.duplicateTrackGroups,
			duplicateFilesBackedUp: result.duplicateFilesBackedUp,
			backupRoot: result.backupRoot
		};
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
