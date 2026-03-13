import { validateAudioFileIntegrity } from './download/audioIntegrity';
import { getEmbeddedTags, getLibraryAlbumLookupIndex } from './mediaLibraryCache';
import { resolveAlbumMatches } from './mediaLibraryLookup';
import {
	type AlbumIntegrityReport,
	type AlbumIntegrityTrackInput,
	type AlbumIntegrityTrackResult,
	type LocalMediaFile,
	keysLooselyMatch,
	mapWithConcurrency,
	normalizeKey,
	normalizeTrackFilename,
	parseTrackNumberFromFilename,
	toPositiveInt
} from './mediaLibraryShared';

async function scoreAlbumTrackCandidate(
	file: LocalMediaFile,
	expected: AlbumIntegrityTrackInput
): Promise<number> {
	const titleKey = normalizeKey(expected.trackTitle);
	const expectedTrackNo = toPositiveInt(expected.trackNumber);
	const tags = await getEmbeddedTags(file);
	const filenameTrackNo = parseTrackNumberFromFilename(file.filename);
	const filenameTrackKey = normalizeTrackFilename(file.filename);

	let score = 0;
	if (expectedTrackNo && tags?.trackNo === expectedTrackNo) {
		score += 100;
	}
	if (expectedTrackNo && filenameTrackNo === expectedTrackNo) {
		score += 80;
	}
	if (titleKey.length > 0 && tags?.titleKey && keysLooselyMatch(tags.titleKey, titleKey)) {
		score += tags.titleKey === titleKey ? 70 : 45;
	}
	if (titleKey.length > 0 && keysLooselyMatch(filenameTrackKey, titleKey)) {
		score += filenameTrackKey === titleKey ? 60 : 35;
	}

	return score;
}

export async function inspectAlbumIntegrity(input: {
	artistName?: string;
	albumTitle?: string;
	targetArtistDir?: string;
	targetAlbumDir?: string;
	tracks: AlbumIntegrityTrackInput[];
	force?: boolean;
	validationConcurrency?: number;
}): Promise<AlbumIntegrityReport> {
	const logPrefix = '[Media Library Integrity]';
	const requestedTracks = Array.isArray(input.tracks)
		? input.tracks
				.map((track) => ({
					trackId: Number(track.trackId),
					trackTitle: track.trackTitle,
					trackNumber: track.trackNumber,
					expectedDurationSeconds: track.expectedDurationSeconds
				}))
				.filter((track) => Number.isFinite(track.trackId) && track.trackId > 0)
		: [];

	const index = await getLibraryAlbumLookupIndex({ force: input.force });
	const albumFiles = await resolveAlbumMatches(
		index.files,
		{
			artistName: input.artistName,
			albumTitle: input.albumTitle,
			targetArtistDir: input.targetArtistDir,
			targetAlbumDir: input.targetAlbumDir
		},
		index
	);
	const resolvedArtistDir = albumFiles[0]?.artistDir;
	const resolvedAlbumDir = albumFiles[0]?.albumDir;

	const results: AlbumIntegrityTrackResult[] = requestedTracks.map((track) => ({
		...track,
		status: 'missing',
		reason: 'No matching local file found'
	}));
	const resultByTrackId = new Map<number, AlbumIntegrityTrackResult>(
		results.map((result) => [result.trackId, result])
	);
	const unusedFiles = [...albumFiles];
	const candidates: Array<{
		track: AlbumIntegrityTrackInput;
		file: LocalMediaFile;
		result: AlbumIntegrityTrackResult;
	}> = [];

	for (const track of requestedTracks) {
		let bestIndex = -1;
		let bestScore = 0;
		for (let i = 0; i < unusedFiles.length; i++) {
			const score = await scoreAlbumTrackCandidate(unusedFiles[i], track);
			if (score > bestScore) {
				bestScore = score;
				bestIndex = i;
			}
		}
		if (bestIndex < 0 || bestScore <= 0) {
			continue;
		}

		const [matchedFile] = unusedFiles.splice(bestIndex, 1);
		if (!matchedFile) continue;
		const result = resultByTrackId.get(track.trackId);
		if (!result) continue;
		result.filePath = matchedFile.path;
		result.relativePath = matchedFile.relativePath;
		candidates.push({ track, file: matchedFile, result });
	}

	const configuredConcurrency = Number(process.env.MEDIA_LIBRARY_VALIDATION_CONCURRENCY || '2');
	const validationConcurrency =
		toPositiveInt(input.validationConcurrency) ?? (toPositiveInt(configuredConcurrency) ?? 2);

	console.log(
		`${logPrefix} Starting integrity scan`,
		JSON.stringify({
			artistName: input.artistName ?? null,
			albumTitle: input.albumTitle ?? null,
			targetArtistDir: input.targetArtistDir ?? null,
			targetAlbumDir: input.targetAlbumDir ?? null,
			resolvedArtistDir: resolvedArtistDir ?? null,
			resolvedAlbumDir: resolvedAlbumDir ?? null,
			requestedTrackCount: requestedTracks.length,
			matchedAlbumFileCount: albumFiles.length,
			candidateTrackCount: candidates.length,
			validationConcurrency,
			forceRescan: input.force === true,
			scannedAt: index.scannedAt
		})
	);

	await mapWithConcurrency(candidates, validationConcurrency, async ({ track, file, result }) => {
		const expectedDurationSeconds =
			typeof track.expectedDurationSeconds === 'number' &&
			Number.isFinite(track.expectedDurationSeconds) &&
			track.expectedDurationSeconds > 0
				? track.expectedDurationSeconds
				: undefined;
		let integrity;
		try {
			integrity = await validateAudioFileIntegrity({
				filePath: file.path,
				expectedExtension: file.extension,
				expectedDurationSeconds
			});
		} catch (error) {
			result.status = 'corrupt';
			result.reason = error instanceof Error ? error.message : String(error);
			console.warn(
				`${logPrefix} Track marked corrupt after validation error`,
				JSON.stringify({
					trackId: track.trackId,
					trackNumber: track.trackNumber ?? null,
					trackTitle: track.trackTitle ?? null,
					relativePath: file.relativePath,
					reason: result.reason
				})
			);
			return;
		}

		if (!integrity.ok) {
			const reason = integrity.error || 'Integrity validation failed';
			if (reason.includes('binary not found')) {
				throw new Error(`Integrity scanner unavailable: ${reason}`);
			}
			result.status = 'corrupt';
			result.reason = reason;
			console.warn(
				`${logPrefix} Track marked corrupt`,
				JSON.stringify({
					trackId: track.trackId,
					trackNumber: track.trackNumber ?? null,
					trackTitle: track.trackTitle ?? null,
					relativePath: file.relativePath,
					reason
				})
			);
			return;
		}

		result.status = 'healthy';
		result.reason = undefined;
		console.log(
			`${logPrefix} Track healthy`,
			JSON.stringify({
				trackId: track.trackId,
				trackNumber: track.trackNumber ?? null,
				trackTitle: track.trackTitle ?? null,
				relativePath: file.relativePath,
				durationSeconds: integrity.durationSeconds ?? null,
				codecName: integrity.codecName ?? null,
				formatName: integrity.formatName ?? null
			})
		);
	});

	for (const track of results) {
		if (track.status !== 'missing') continue;
		console.warn(
			`${logPrefix} Track missing`,
			JSON.stringify({
				trackId: track.trackId,
				trackNumber: track.trackNumber ?? null,
				trackTitle: track.trackTitle ?? null,
				reason: track.reason ?? null
			})
		);
	}

	const healthy = results.filter((track) => track.status === 'healthy').length;
	const missing = results.filter((track) => track.status === 'missing').length;
	const corrupt = results.filter((track) => track.status === 'corrupt').length;

	console.log(
		`${logPrefix} Scan complete`,
		JSON.stringify({
			artistName: input.artistName ?? null,
			albumTitle: input.albumTitle ?? null,
			resolvedArtistDir: resolvedArtistDir ?? null,
			resolvedAlbumDir: resolvedAlbumDir ?? null,
			expected: results.length,
			healthy,
			missing,
			corrupt
		})
	);

	return {
		scannedAt: index.scannedAt,
		totalFilesInAlbumDir: albumFiles.length,
		resolvedArtistDir,
		resolvedAlbumDir,
		tracks: results,
		summary: {
			expected: results.length,
			healthy,
			missing,
			corrupt
		}
	};
}
