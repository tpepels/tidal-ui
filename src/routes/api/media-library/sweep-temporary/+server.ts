import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sweepTransientAlbumArtifacts } from '$lib/server/mediaLibrary';
import { getActiveJobIdsForMaintenance } from '$lib/server/downloadQueueManager';
import {
	acquireMediaMaintenanceLock,
	getMediaMaintenanceLockHolder
} from '$lib/server/mediaMaintenanceLock';
import { writeMediaMaintenanceRunReport } from '$lib/server/mediaMaintenanceReports';

type SweepTemporaryRequestBody = {
	dryRun?: boolean;
};

export const POST: RequestHandler = async ({ request }) => {
	let lock: Awaited<ReturnType<typeof acquireMediaMaintenanceLock>> | null = null;
	let runId: string | null = null;
	try {
		const body = (await request.json().catch(() => ({}))) as SweepTemporaryRequestBody;
		const dryRun = body.dryRun === true;
		runId = `sweep-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		lock = await acquireMediaMaintenanceLock({
			owner: `api:sweep-temporary:${runId}`,
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
		const activeJobIds = await getActiveJobIdsForMaintenance();
		const summary = await sweepTransientAlbumArtifacts({
			dryRun,
			activeJobIds
		});
		const reportPath = await writeMediaMaintenanceRunReport({
			runId,
			kind: 'sweep-temporary',
			payload: summary
		});

		console.log(
			'[Media Library API] sweep-temporary completed',
			JSON.stringify({
				dryRun: summary.dryRun,
				artistDirsScanned: summary.artistDirsScanned,
				artifactDirsFound: summary.artifactDirsFound,
				artifactDirsRemoved: summary.artifactDirsRemoved,
				skippedTooFresh: summary.skippedTooFresh,
				skippedActive: summary.skippedActive,
				samplePaths: summary.samplePaths
			})
		);

		return json({
			success: true,
			runId,
			reportPath,
			...summary
		});
	} catch (error) {
		console.error('[Media Library API] sweep-temporary error:', error);
		if (runId) {
			await writeMediaMaintenanceRunReport({
				runId,
				kind: 'sweep-temporary',
				payload: {
					error: error instanceof Error ? error.message : String(error),
					finishedAt: Date.now()
				}
			});
		}
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to sweep temporary album artifacts'
			},
			{ status: 500 }
		);
	} finally {
		await lock?.release();
	}
};
