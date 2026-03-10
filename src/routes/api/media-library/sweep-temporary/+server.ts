import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sweepTransientAlbumArtifacts } from '$lib/server/mediaLibrary';

type SweepTemporaryRequestBody = {
	dryRun?: boolean;
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json().catch(() => ({}))) as SweepTemporaryRequestBody;
		const dryRun = body.dryRun === true;
		const summary = await sweepTransientAlbumArtifacts({ dryRun });

		console.log(
			'[Media Library API] sweep-temporary completed',
			JSON.stringify({
				dryRun: summary.dryRun,
				artistDirsScanned: summary.artistDirsScanned,
				artifactDirsFound: summary.artifactDirsFound,
				artifactDirsRemoved: summary.artifactDirsRemoved,
				samplePaths: summary.samplePaths
			})
		);

		return json({
			success: true,
			...summary
		});
	} catch (error) {
		console.error('[Media Library API] sweep-temporary error:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to sweep temporary album artifacts'
			},
			{ status: 500 }
		);
	}
};
