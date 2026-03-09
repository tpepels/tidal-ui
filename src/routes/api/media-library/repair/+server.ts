import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enqueueJob } from '$lib/server/downloadQueueManager';
import { inspectAlbumIntegrity } from '$lib/server/mediaLibrary';
import type { AudioQuality } from '$lib/types';

type RepairTrackRequest = {
	trackId: number;
	trackTitle?: string;
	trackNumber?: number;
	durationSeconds?: number;
};

type RepairRequestBody = {
	albumId?: number;
	artistName?: string;
	albumTitle?: string;
	quality?: AudioQuality;
	tracks?: RepairTrackRequest[];
	coverUrl?: string;
	forceRescan?: boolean;
	queue?: boolean;
};

const ALLOWED_QUALITIES = new Set<AudioQuality>([
	'LOW',
	'HIGH',
	'LOSSLESS',
	'HI_RES_LOSSLESS'
]);

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as RepairRequestBody;
		const albumId = Number(body.albumId);
		if (!Number.isFinite(albumId) || albumId <= 0) {
			return json({ success: false, error: 'albumId must be a positive number' }, { status: 400 });
		}

		if (!body.quality || !ALLOWED_QUALITIES.has(body.quality)) {
			return json(
				{ success: false, error: 'quality must be one of LOW, HIGH, LOSSLESS, HI_RES_LOSSLESS' },
				{ status: 400 }
			);
		}

		const normalizedTracks = Array.isArray(body.tracks)
			? body.tracks
					.map((track) => ({
						trackId: Number(track.trackId),
						trackTitle: typeof track.trackTitle === 'string' ? track.trackTitle : undefined,
						trackNumber:
							typeof track.trackNumber === 'number' && Number.isFinite(track.trackNumber)
								? track.trackNumber
								: undefined,
						expectedDurationSeconds:
							typeof track.durationSeconds === 'number' && Number.isFinite(track.durationSeconds)
								? track.durationSeconds
								: undefined
					}))
					.filter((track) => Number.isFinite(track.trackId) && track.trackId > 0)
			: [];

		if (normalizedTracks.length === 0) {
			return json(
				{ success: false, error: 'tracks must contain at least one valid trackId' },
				{ status: 400 }
			);
		}

		console.log(
			'[Media Library API] repair requested',
			JSON.stringify({
				albumId,
				artistName: body.artistName ?? null,
				albumTitle: body.albumTitle ?? null,
				quality: body.quality,
				requestedTrackCount: normalizedTracks.length,
				forceRescan: body.forceRescan === true,
				queue: body.queue !== false
			})
		);

		const report = await inspectAlbumIntegrity({
			artistName: body.artistName,
			albumTitle: body.albumTitle,
			tracks: normalizedTracks,
			force: body.forceRescan === true
		});

		const repairTargets = report.tracks.filter((track) => track.status === 'missing' || track.status === 'corrupt');
		const shouldQueue = body.queue !== false;
		const queuedJobIds: string[] = [];
		const resolvedArtistDir = report.resolvedArtistDir;
		const resolvedAlbumDir = report.resolvedAlbumDir;

		if (shouldQueue && repairTargets.length > 0 && (!resolvedArtistDir || !resolvedAlbumDir)) {
			return json(
				{
					success: false,
					error:
						'No existing local album directory could be resolved for repair. Refusing to create a new directory in repair mode.'
				},
				{ status: 409 }
			);
		}

		console.log(
			'[Media Library API] repair scan completed',
			JSON.stringify({
				albumId,
				expected: report.summary.expected,
				healthy: report.summary.healthy,
				missing: report.summary.missing,
				corrupt: report.summary.corrupt,
				resolvedArtistDir: resolvedArtistDir ?? null,
				resolvedAlbumDir: resolvedAlbumDir ?? null,
				repairTargetCount: repairTargets.length,
				queueEnabled: shouldQueue
			})
		);

		if (shouldQueue) {
			for (const track of repairTargets) {
				const jobId = await enqueueJob(
					{
						type: 'track',
						trackId: track.trackId,
						quality: body.quality,
						albumTitle: body.albumTitle,
						artistName: body.artistName,
						targetArtistDir: resolvedArtistDir,
						targetAlbumDir: resolvedAlbumDir,
						trackTitle: track.trackTitle,
						trackNumber: track.trackNumber,
						coverUrl: body.coverUrl,
						forceOverwrite: true
					},
					{
						priority: 'high',
						maxRetries: 6,
						checkDuplicate: true,
						forceOverwrite: true
					}
				);
				queuedJobIds.push(jobId);
			}
		}

		console.log(
			'[Media Library API] repair queue outcome',
			JSON.stringify({
				albumId,
				queuedCount: queuedJobIds.length,
				queuedTrackIds: repairTargets.map((track) => track.trackId)
			})
		);

		return json({
			success: true,
			albumId,
			scannedAt: report.scannedAt,
			resolvedArtistDir: resolvedArtistDir ?? null,
			resolvedAlbumDir: resolvedAlbumDir ?? null,
			summary: {
				expected: report.summary.expected,
				healthy: report.summary.healthy,
				missing: report.summary.missing,
				corrupt: report.summary.corrupt,
				repairNeeded: repairTargets.length,
				queued: queuedJobIds.length
			},
			repairTargets,
			queuedJobIds
		});
	} catch (error) {
		console.error('[Media Library API] repair error:', error);
		const message = error instanceof Error ? error.message : 'Failed to inspect/repair album in library';
		const status = message.includes('Integrity scanner unavailable') ? 503 : 500;
		return json({ success: false, error: message }, { status });
	}
};
