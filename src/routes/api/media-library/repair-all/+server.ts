import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Album, AudioQuality } from '$lib/types';
import { losslessAPI } from '$lib/api';
import { inspectAlbumIntegrity, scanLocalMediaLibrary, type LocalMediaFile } from '$lib/server/mediaLibrary';
import { enqueueJob } from '$lib/server/downloadQueueManager';
import { sanitizeDirName } from '../../download-track/_shared';

type RepairAllRequestBody = {
	quality?: AudioQuality;
	forceRescan?: boolean;
	queue?: boolean;
	maxAlbums?: number;
};

type LocalAlbumGroup = {
	artistDir: string;
	albumDir: string;
	files: LocalMediaFile[];
	trackCount: number;
	localArtistName: string;
	localAlbumTitle: string;
};

type FullLibraryRepairSummary = {
	albumsDiscovered: number;
	albumsProcessed: number;
	albumsMatched: number;
	albumsUnresolved: number;
	albumsErrored: number;
	albumsWithRepairTargets: number;
	albumsWithQueuedRepairs: number;
	tracksExpected: number;
	tracksHealthy: number;
	tracksMissing: number;
	tracksCorrupt: number;
	tracksQueued: number;
};

type UnresolvedAlbum = {
	artistName: string;
	albumTitle: string;
	reason: string;
};

type FullLibraryRepairResult = {
	success: true;
	startedAt: number;
	finishedAt: number;
	durationMs: number;
	queueEnabled: boolean;
	quality: AudioQuality;
	summary: FullLibraryRepairSummary;
	unresolvedAlbums: UnresolvedAlbum[];
	errorAlbums: UnresolvedAlbum[];
};

type FullLibraryRepairRunStatus = 'idle' | 'running' | 'completed' | 'failed';

type FullLibraryRepairCurrentAlbum = {
	index: number;
	total: number;
	artistName: string;
	albumTitle: string;
};

type FullLibraryRepairStatusPayload = {
	success: true;
	status: FullLibraryRepairRunStatus;
	startedAt: number | null;
	finishedAt: number | null;
	currentAlbum: FullLibraryRepairCurrentAlbum | null;
	summary: FullLibraryRepairSummary;
	error: string | null;
};

const ALLOWED_QUALITIES = new Set<AudioQuality>(['LOW', 'HIGH', 'LOSSLESS', 'HI_RES_LOSSLESS']);
const VARIOUS_ARTISTS_DIR = sanitizeDirName('Various Artists');
const UNRESOLVED_PAYLOAD_LIMIT = 50;
const MATCH_MIN_SCORE = 180;
const MATCH_AMBIGUITY_WINDOW = 25;
const logPrefix = '[Media Library Auto Repair]';

function createEmptySummary(): FullLibraryRepairSummary {
	return {
		albumsDiscovered: 0,
		albumsProcessed: 0,
		albumsMatched: 0,
		albumsUnresolved: 0,
		albumsErrored: 0,
		albumsWithRepairTargets: 0,
		albumsWithQueuedRepairs: 0,
		tracksExpected: 0,
		tracksHealthy: 0,
		tracksMissing: 0,
		tracksCorrupt: 0,
		tracksQueued: 0
	};
}

let activeRun: Promise<FullLibraryRepairResult> | null = null;
let runStatus: FullLibraryRepairRunStatus = 'idle';
let runStartedAt: number | null = null;
let runFinishedAt: number | null = null;
let runCurrentAlbum: FullLibraryRepairCurrentAlbum | null = null;
let runSummary: FullLibraryRepairSummary = createEmptySummary();
let runError: string | null = null;

function setRunStatusRunning(startedAt: number): void {
	runStatus = 'running';
	runStartedAt = startedAt;
	runFinishedAt = null;
	runCurrentAlbum = null;
	runSummary = createEmptySummary();
	runError = null;
}

function setRunCurrentAlbum(
	currentAlbum:
		| {
				index: number;
				total: number;
				artistName: string;
				albumTitle: string;
		  }
		| null
): void {
	runCurrentAlbum = currentAlbum;
}

function setRunSummary(summary: FullLibraryRepairSummary): void {
	runSummary = { ...summary };
}

function setRunStatusFinished(status: FullLibraryRepairRunStatus, finishedAt: number, error?: string): void {
	runStatus = status;
	runFinishedAt = finishedAt;
	runCurrentAlbum = null;
	runError = error ?? null;
}

function normalizeComparable(value: string): string {
	return value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function restoreDirName(value: string): string {
	return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildCoverUrl(coverId?: string | null): string | undefined {
	if (!coverId || typeof coverId !== 'string') {
		return undefined;
	}
	return `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/1280x1280.jpg`;
}

function toPositiveInt(value: unknown): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function groupLibraryAlbums(files: LocalMediaFile[]): LocalAlbumGroup[] {
	const groups = new Map<string, LocalAlbumGroup>();
	for (const file of files) {
		if (!file.artistDir || !file.albumDir) continue;
		const key = `${file.artistDir}::${file.albumDir}`;
		const existing = groups.get(key);
		if (existing) {
			existing.files.push(file);
			existing.trackCount += 1;
			continue;
		}
		groups.set(key, {
			artistDir: file.artistDir,
			albumDir: file.albumDir,
			files: [file],
			trackCount: 1,
			localArtistName: restoreDirName(file.artistDir),
			localAlbumTitle: restoreDirName(file.albumDir)
		});
	}

	return Array.from(groups.values()).sort((a, b) => {
		const byArtist = a.artistDir.localeCompare(b.artistDir);
		if (byArtist !== 0) return byArtist;
		return a.albumDir.localeCompare(b.albumDir);
	});
}

function scoreAlbumCandidate(localAlbum: LocalAlbumGroup, candidate: Album): number {
	const candidateArtistName = candidate.artist?.name ?? candidate.artists?.[0]?.name ?? '';
	const candidateArtistDir = sanitizeDirName(candidateArtistName);
	const candidateAlbumDir = sanitizeDirName(candidate.title ?? '');
	const localArtistKey = normalizeComparable(localAlbum.artistDir);
	const localAlbumKey = normalizeComparable(localAlbum.albumDir);
	const candidateArtistKey = normalizeComparable(candidateArtistDir);
	const candidateAlbumKey = normalizeComparable(candidateAlbumDir);

	let score = 0;

	if (candidateArtistDir === localAlbum.artistDir) {
		score += 140;
	} else if (candidateArtistKey === localArtistKey) {
		score += 90;
	} else if (candidateArtistKey.includes(localArtistKey) || localArtistKey.includes(candidateArtistKey)) {
		score += 35;
	}

	if (candidateAlbumDir === localAlbum.albumDir) {
		score += 180;
	} else if (candidateAlbumKey === localAlbumKey) {
		score += 110;
	} else if (candidateAlbumKey.includes(localAlbumKey) || localAlbumKey.includes(candidateAlbumKey)) {
		score += 50;
	}

	const candidateTrackCount = Number(candidate.numberOfTracks);
	if (Number.isFinite(candidateTrackCount) && candidateTrackCount > 0) {
		const difference = Math.abs(candidateTrackCount - localAlbum.trackCount);
		if (difference === 0) {
			score += 40;
		} else if (difference <= 1) {
			score += 25;
		} else if (difference <= 2) {
			score += 10;
		}
		if (candidateTrackCount < localAlbum.trackCount) {
			score -= 20;
		}
	}

	if (candidate.id > 0) {
		score += 5;
	}

	return score;
}

async function resolveAlbumMatch(localAlbum: LocalAlbumGroup): Promise<{
	match: Album | null;
	reason?: string;
}> {
	const queryCandidates = [
		`${localAlbum.localArtistName} ${localAlbum.localAlbumTitle}`.trim(),
		localAlbum.localAlbumTitle
	].filter((query, index, values) => query.length > 0 && values.indexOf(query) === index);

	let best: { album: Album; score: number } | null = null;
	let second: { album: Album; score: number } | null = null;

	for (const query of queryCandidates) {
		let searchResult;
		try {
			searchResult = await losslessAPI.searchAlbums(query);
		} catch (error) {
			console.warn(
				`${logPrefix} Album search failed`,
				JSON.stringify({
					artistDir: localAlbum.artistDir,
					albumDir: localAlbum.albumDir,
					query,
					error: error instanceof Error ? error.message : String(error)
				})
			);
			continue;
		}

		for (const candidate of searchResult.items.slice(0, 20)) {
			const score = scoreAlbumCandidate(localAlbum, candidate);
			if (!best || score > best.score) {
				second = best;
				best = { album: candidate, score };
				continue;
			}
			if (!second || score > second.score) {
				second = { album: candidate, score };
			}
		}
	}

	if (!best) {
		return { match: null, reason: 'No album search results' };
	}

	const bestArtistDir = sanitizeDirName(best.album.artist?.name ?? best.album.artists?.[0]?.name ?? '');
	const bestAlbumDir = sanitizeDirName(best.album.title ?? '');
	const exactAlbumMatch = bestAlbumDir === localAlbum.albumDir;
	const exactArtistMatch = bestArtistDir === localAlbum.artistDir;
	const isCompilationMatch = localAlbum.artistDir === VARIOUS_ARTISTS_DIR && exactAlbumMatch;

	if (best.score < MATCH_MIN_SCORE && !(exactAlbumMatch && (exactArtistMatch || isCompilationMatch))) {
		return { match: null, reason: `Low match confidence (${best.score})` };
	}

	if (
		second &&
		second.score > 0 &&
		best.score - second.score <= MATCH_AMBIGUITY_WINDOW &&
		!exactAlbumMatch
	) {
		return {
			match: null,
			reason: `Ambiguous album match (${best.score} vs ${second.score})`
		};
	}

	return { match: best.album };
}

async function runRepairAll(input: {
	quality: AudioQuality;
	forceRescan: boolean;
	queue: boolean;
	maxAlbums?: number;
}): Promise<FullLibraryRepairResult> {
	const startedAt = Date.now();
	const unresolvedAlbums: UnresolvedAlbum[] = [];
	const errorAlbums: UnresolvedAlbum[] = [];
	setRunStatusRunning(startedAt);

	const summary: FullLibraryRepairSummary = createEmptySummary();

	const snapshot = await scanLocalMediaLibrary({ force: input.forceRescan });
	const groupedAlbums = groupLibraryAlbums(snapshot.files);
	const maxAlbums = toPositiveInt(input.maxAlbums);
	const albumsToProcess =
		typeof maxAlbums === 'number' ? groupedAlbums.slice(0, maxAlbums) : groupedAlbums;
	summary.albumsDiscovered = groupedAlbums.length;
	setRunSummary(summary);

	console.log(
		`${logPrefix} Starting full library repair`,
		JSON.stringify({
			scannedAt: snapshot.scannedAt,
			totalFiles: snapshot.files.length,
			albumsDiscovered: groupedAlbums.length,
			albumsToProcess: albumsToProcess.length,
			queueEnabled: input.queue,
			quality: input.quality
		})
	);

	for (const [index, localAlbum] of albumsToProcess.entries()) {
		summary.albumsProcessed += 1;
		setRunCurrentAlbum({
			index: index + 1,
			total: albumsToProcess.length,
			artistName: localAlbum.localArtistName,
			albumTitle: localAlbum.localAlbumTitle
		});
		setRunSummary(summary);
		console.log(
			`${logPrefix} Processing album`,
			JSON.stringify({
				processed: summary.albumsProcessed,
				total: albumsToProcess.length,
				artistDir: localAlbum.artistDir,
				albumDir: localAlbum.albumDir,
				localTrackCount: localAlbum.trackCount
			})
		);

		let matchResult;
		try {
			matchResult = await resolveAlbumMatch(localAlbum);
		} catch (error) {
			summary.albumsErrored += 1;
			const reason = error instanceof Error ? error.message : String(error);
			errorAlbums.push({
				artistName: localAlbum.localArtistName,
				albumTitle: localAlbum.localAlbumTitle,
				reason
			});
			console.error(
				`${logPrefix} Album matching failed`,
				JSON.stringify({
					artistDir: localAlbum.artistDir,
					albumDir: localAlbum.albumDir,
					error: reason
				})
			);
			setRunSummary(summary);
			continue;
		}

		if (!matchResult.match) {
			summary.albumsUnresolved += 1;
			unresolvedAlbums.push({
				artistName: localAlbum.localArtistName,
				albumTitle: localAlbum.localAlbumTitle,
				reason: matchResult.reason ?? 'No confident match'
			});
			console.warn(
				`${logPrefix} Skipping unresolved local album`,
				JSON.stringify({
					artistDir: localAlbum.artistDir,
					albumDir: localAlbum.albumDir,
					reason: matchResult.reason ?? 'No confident match'
				})
			);
			setRunSummary(summary);
			continue;
		}

		const matchedAlbum = matchResult.match;
		summary.albumsMatched += 1;
		setRunSummary(summary);

		let albumDetails;
		try {
			albumDetails = await losslessAPI.getAlbum(matchedAlbum.id);
		} catch (error) {
			summary.albumsErrored += 1;
			const reason = error instanceof Error ? error.message : String(error);
			errorAlbums.push({
				artistName: localAlbum.localArtistName,
				albumTitle: localAlbum.localAlbumTitle,
				reason
			});
			console.error(
				`${logPrefix} Failed to load matched album tracks`,
				JSON.stringify({
					artistDir: localAlbum.artistDir,
					albumDir: localAlbum.albumDir,
					matchedAlbumId: matchedAlbum.id,
					error: reason
				})
			);
			setRunSummary(summary);
			continue;
		}

		const trackInputs = albumDetails.tracks
			.map((track) => ({
				trackId: Number(track.id),
				trackTitle: track.version ? `${track.title} (${track.version})` : track.title,
				trackNumber: track.trackNumber,
				expectedDurationSeconds: track.duration
			}))
			.filter((track) => Number.isFinite(track.trackId) && track.trackId > 0);

		if (trackInputs.length === 0) {
			summary.albumsUnresolved += 1;
			unresolvedAlbums.push({
				artistName: localAlbum.localArtistName,
				albumTitle: localAlbum.localAlbumTitle,
				reason: `Matched album ${matchedAlbum.id} has no tracks`
			});
			console.warn(
				`${logPrefix} Matched album has no tracks`,
				JSON.stringify({
					artistDir: localAlbum.artistDir,
					albumDir: localAlbum.albumDir,
					matchedAlbumId: matchedAlbum.id
				})
			);
			setRunSummary(summary);
			continue;
		}

		let report;
		try {
			report = await inspectAlbumIntegrity({
				artistName: localAlbum.localArtistName,
				albumTitle: localAlbum.localAlbumTitle,
				targetArtistDir: localAlbum.artistDir,
				targetAlbumDir: localAlbum.albumDir,
				tracks: trackInputs
			});
		} catch (error) {
			summary.albumsErrored += 1;
			const reason = error instanceof Error ? error.message : String(error);
			errorAlbums.push({
				artistName: localAlbum.localArtistName,
				albumTitle: localAlbum.localAlbumTitle,
				reason
			});
			console.error(
				`${logPrefix} Integrity scan failed`,
				JSON.stringify({
					artistDir: localAlbum.artistDir,
					albumDir: localAlbum.albumDir,
					matchedAlbumId: matchedAlbum.id,
					error: reason
				})
			);
			setRunSummary(summary);
			continue;
		}

		summary.tracksExpected += report.summary.expected;
		summary.tracksHealthy += report.summary.healthy;
		summary.tracksMissing += report.summary.missing;
		summary.tracksCorrupt += report.summary.corrupt;
		setRunSummary(summary);

		const repairTargets = report.tracks.filter((track) => track.status === 'missing' || track.status === 'corrupt');
		if (repairTargets.length === 0) {
			console.log(
				`${logPrefix} Album healthy`,
				JSON.stringify({
					artistDir: localAlbum.artistDir,
					albumDir: localAlbum.albumDir,
					matchedAlbumId: matchedAlbum.id
				})
			);
			continue;
		}

		summary.albumsWithRepairTargets += 1;
		setRunSummary(summary);

		let queuedForAlbum = 0;
		if (input.queue) {
			const coverUrl = buildCoverUrl(albumDetails.album.cover);
			for (const target of repairTargets) {
				await enqueueJob(
					{
						type: 'track',
						trackId: target.trackId,
						quality: input.quality,
						albumTitle: localAlbum.localAlbumTitle,
						artistName: localAlbum.localArtistName,
						targetArtistDir: localAlbum.artistDir,
						targetAlbumDir: localAlbum.albumDir,
						trackTitle: target.trackTitle,
						trackNumber: target.trackNumber,
						coverUrl,
						forceOverwrite: true
					},
					{
						priority: 'high',
						maxRetries: 6,
						checkDuplicate: true,
						forceOverwrite: true
					}
				);
				queuedForAlbum += 1;
				summary.tracksQueued += 1;
				setRunSummary(summary);
			}
		}

		if (queuedForAlbum > 0) {
			summary.albumsWithQueuedRepairs += 1;
			setRunSummary(summary);
		}

		console.log(
			`${logPrefix} Album repair scan complete`,
			JSON.stringify({
				artistDir: localAlbum.artistDir,
				albumDir: localAlbum.albumDir,
				matchedAlbumId: matchedAlbum.id,
				repairTargetCount: repairTargets.length,
				queuedForAlbum
			})
		);
	}

	const finishedAt = Date.now();
	setRunSummary(summary);
	setRunStatusFinished('completed', finishedAt);

	console.log(
		`${logPrefix} Full library repair completed`,
		JSON.stringify({
			durationMs: finishedAt - startedAt,
			summary
		})
	);

	return {
		success: true,
		startedAt,
		finishedAt,
		durationMs: finishedAt - startedAt,
		queueEnabled: input.queue,
		quality: input.quality,
		summary,
		unresolvedAlbums: unresolvedAlbums.slice(0, UNRESOLVED_PAYLOAD_LIMIT),
		errorAlbums: errorAlbums.slice(0, UNRESOLVED_PAYLOAD_LIMIT)
	};
}

export const POST: RequestHandler = async ({ request }) => {
	if (activeRun) {
		return json(
			{
				success: false,
				error: 'A full library repair run is already in progress'
			},
			{ status: 409 }
		);
	}

	try {
		const body = (await request.json().catch(() => ({}))) as RepairAllRequestBody;
		const quality = ALLOWED_QUALITIES.has(body.quality as AudioQuality)
			? (body.quality as AudioQuality)
			: 'LOSSLESS';
		const queueEnabled = body.queue !== false;
		const forceRescan = body.forceRescan === true;
		const maxAlbums = toPositiveInt(body.maxAlbums);

		activeRun = runRepairAll({
			quality,
			queue: queueEnabled,
			forceRescan,
			maxAlbums
		});
		const result = await activeRun;
		return json(result);
	} catch (error) {
		console.error('[Media Library API] repair-all error:', error);
		const message = error instanceof Error ? error.message : 'Failed to auto-repair full library';
		setRunStatusFinished('failed', Date.now(), message);
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
	const payload: FullLibraryRepairStatusPayload = {
		success: true,
		status: runStatus,
		startedAt: runStartedAt,
		finishedAt: runFinishedAt,
		currentAlbum: runCurrentAlbum,
		summary: runSummary,
		error: runError
	};
	return json(payload);
};
