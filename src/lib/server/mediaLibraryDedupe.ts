import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { parseFile } from 'music-metadata';
import { getTempDir, moveFile } from '$lib/server/download/shared';
import { validateAudioFileIntegrity } from './download/audioIntegrity';
import { clearMediaLibraryScanCache } from './mediaLibraryCache';
import { scanLocalMediaLibrary } from './mediaLibraryScan';
import {
	AUDIO_EXTENSIONS,
	type AlbumDirGroup,
	type DedupeFileCandidate,
	type EvaluatedDedupeFileCandidate,
	type MediaLibraryDedupeProgress,
	type MediaLibraryDedupeSummary,
	chooseCanonicalAlbumGroup,
	ensureUniquePath,
	hasTrackDuplicates,
	normalizeDirComparable,
	parseTrackOrderKey,
	pathExists,
	pushSample,
	toPositiveInt
} from './mediaLibraryShared';

const DEDUPE_SAMPLE_LIMIT = Math.max(
	1,
	Number(process.env.MEDIA_LIBRARY_DEDUPE_SAMPLE_LIMIT || 25)
);

const AUDIO_EXTENSION_RANK: Record<string, number> = {
	'.flac': 600,
	'.alac': 550,
	'.wav': 520,
	'.m4a': 500,
	'.mp4': 480,
	'.aac': 450,
	'.ogg': 430,
	'.opus': 420,
	'.mp3': 400
};

async function parseTrackOrderKeyFromEmbeddedTags(filePath: string): Promise<string | null> {
	try {
		const metadata = await parseFile(filePath, { duration: false, skipCovers: true });
		const discNo = toPositiveInt(metadata.common.disk?.no);
		const trackNo = toPositiveInt(metadata.common.track?.no);
		if (!trackNo) {
			return null;
		}
		if (discNo) {
			return `${String(discNo).padStart(2, '0')}${String(trackNo).padStart(2, '0')}`;
		}
		return String(trackNo).padStart(2, '0');
	} catch {
		return null;
	}
}

async function moveDirectoryContents(
	sourceDir: string,
	targetDir: string,
	dryRun: boolean
): Promise<{
	movedFiles: number;
	moveErrors: Array<{
		sourcePath: string;
		targetPath: string;
		error: string;
	}>;
}> {
	const entries = await fs.readdir(sourceDir, { withFileTypes: true });
	let movedFiles = 0;
	const moveErrors: Array<{
		sourcePath: string;
		targetPath: string;
		error: string;
	}> = [];
	if (!dryRun) {
		await fs.mkdir(targetDir, { recursive: true });
	}

	for (const entry of entries) {
		const sourcePath = path.join(sourceDir, entry.name);
		const targetPath = path.join(targetDir, entry.name);

		if (entry.isDirectory()) {
			const nested = await moveDirectoryContents(sourcePath, targetPath, dryRun);
			movedFiles += nested.movedFiles;
			moveErrors.push(...nested.moveErrors);
			if (!dryRun) {
				if (nested.moveErrors.length === 0) {
					await fs.rm(sourcePath, { recursive: true, force: true }).catch(() => {});
				} else {
					await fs.rmdir(sourcePath).catch(() => {});
				}
			}
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		if (dryRun) {
			movedFiles += 1;
			continue;
		}

		const resolvedTargetPath = (await pathExists(targetPath))
			? await ensureUniquePath(targetDir, entry.name)
			: targetPath;
		try {
			await moveFile(sourcePath, resolvedTargetPath);
			movedFiles += 1;
		} catch (error) {
			let effectiveError = error;
			const exdevLike = (error as NodeJS.ErrnoException | undefined)?.code === 'EXDEV';
			if (exdevLike) {
				try {
					await fs.copyFile(sourcePath, resolvedTargetPath);
					await fs.unlink(sourcePath);
					movedFiles += 1;
					continue;
				} catch (fallbackError) {
					effectiveError = fallbackError;
				}
			}
			moveErrors.push({
				sourcePath,
				targetPath: resolvedTargetPath,
				error: effectiveError instanceof Error ? effectiveError.message : String(effectiveError)
			});
		}
	}

	return { movedFiles, moveErrors };
}

async function listAlbumAudioCandidates(albumPath: string): Promise<DedupeFileCandidate[]> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(albumPath, { withFileTypes: true });
	} catch {
		return [];
	}

	const candidates: DedupeFileCandidate[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const extension = path.extname(entry.name).toLowerCase();
		if (!AUDIO_EXTENSIONS.has(extension)) continue;
		const filePath = path.join(albumPath, entry.name);
		const stat = await fs.stat(filePath).catch(() => null);
		if (!stat) continue;
		let trackKey = parseTrackOrderKey(entry.name);
		if (!trackKey) {
			trackKey = await parseTrackOrderKeyFromEmbeddedTags(filePath);
		}
		candidates.push({
			path: filePath,
			filename: entry.name,
			extension,
			size: stat.size,
			trackKey
		});
	}
	return candidates;
}

function compareDedupeCandidatePriority(a: DedupeFileCandidate, b: DedupeFileCandidate): number {
	const evaluatedA = a as EvaluatedDedupeFileCandidate;
	const evaluatedB = b as EvaluatedDedupeFileCandidate;
	if (evaluatedA.integrityState !== evaluatedB.integrityState) {
		return evaluatedB.integrityState - evaluatedA.integrityState;
	}
	if (evaluatedA.durationSeconds !== evaluatedB.durationSeconds) {
		return evaluatedB.durationSeconds - evaluatedA.durationSeconds;
	}
	const rankA = AUDIO_EXTENSION_RANK[a.extension] ?? 100;
	const rankB = AUDIO_EXTENSION_RANK[b.extension] ?? 100;
	if (rankA !== rankB) {
		return rankB - rankA;
	}
	if (a.size !== b.size) {
		return b.size - a.size;
	}
	if (a.filename.length !== b.filename.length) {
		return a.filename.length - b.filename.length;
	}
	return a.filename.localeCompare(b.filename);
}

async function evaluateDedupeCandidate(
	candidate: DedupeFileCandidate
): Promise<EvaluatedDedupeFileCandidate> {
	let integrityState: 0 | 1 | 2 = 1;
	let durationSeconds = 0;

	try {
		const integrity = await validateAudioFileIntegrity({
			filePath: candidate.path,
			expectedExtension: candidate.extension
		});
		if (typeof integrity.durationSeconds === 'number' && Number.isFinite(integrity.durationSeconds)) {
			durationSeconds = Math.max(0, integrity.durationSeconds);
		}
		if (integrity.ok) {
			integrityState = 2;
		} else {
			const reason = (integrity.error || '').toLowerCase();
			if (reason.includes('binary not found')) {
				integrityState = 1;
			} else {
				integrityState = 0;
			}
		}
	} catch {
		integrityState = 1;
	}

	if (durationSeconds <= 0) {
		try {
			const metadata = await parseFile(candidate.path, { duration: true, skipCovers: true });
			if (typeof metadata.format.duration === 'number' && Number.isFinite(metadata.format.duration)) {
				durationSeconds = Math.max(0, metadata.format.duration);
			}
		} catch {
			// Keep default 0 duration when probing fails.
		}
	}

	return {
		...candidate,
		integrityState,
		durationSeconds
	};
}

async function moveToBackup(
	filePath: string,
	backupRoot: string,
	artistDir: string,
	albumDir: string
): Promise<void> {
	const backupDir = path.join(backupRoot, artistDir, albumDir);
	await fs.mkdir(backupDir, { recursive: true });
	const fileName = path.basename(filePath);
	const backupPath = await ensureUniquePath(backupDir, fileName);
	await moveFile(filePath, backupPath);
}

export async function deduplicateMediaLibrary(options?: {
	dryRun?: boolean;
	forceRescan?: boolean;
	maxAlbums?: number;
	runId?: string;
	onProgress?: (progress: MediaLibraryDedupeProgress) => void;
}): Promise<MediaLibraryDedupeSummary> {
	const dryRun = options?.dryRun !== false;
	const snapshot = await scanLocalMediaLibrary({ force: options?.forceRescan === true || !dryRun });
	const albumGroupsMap = new Map<string, AlbumDirGroup>();
	for (const file of snapshot.files) {
		const key = `${file.artistDir}::${file.albumDir}`;
		const existing = albumGroupsMap.get(key);
		if (existing) {
			existing.files.push(file);
		} else {
			albumGroupsMap.set(key, {
				artistDir: file.artistDir,
				albumDir: file.albumDir,
				files: [file]
			});
		}
	}
	const albumGroups = Array.from(albumGroupsMap.values());
	const summary: MediaLibraryDedupeSummary = {
		scannedAt: snapshot.scannedAt,
		dryRun,
		runId: options?.runId,
		albumsScanned: albumGroups.length,
		duplicateAlbumGroups: 0,
		duplicateAlbumDirs: 0,
		albumsMerged: 0,
		filesMovedBetweenAlbums: 0,
		filesMoveErrors: 0,
		albumsWithTrackDuplicates: 0,
		albumsSkipped: 0,
		duplicateTrackGroups: 0,
		manualReviewRequired: 0,
		duplicateFilesBackedUp: 0,
		backupErrors: 0,
		movedSamples: [],
		backedUpSamples: [],
		skippedSamples: [],
		failedSamples: []
	};
	const emitProgress = (
		phase: MediaLibraryDedupeProgress['phase'],
		message: string,
		processed: number,
		total: number,
		current?: { artistDir?: string; albumDir?: string }
	): void => {
		const progress: MediaLibraryDedupeProgress = {
			phase,
			message,
			processed,
			total,
			currentArtistDir: current?.artistDir,
			currentAlbumDir: current?.albumDir,
			summary: { ...summary }
		};
		console.log(
			`[Media Library Dedupe] ${message}`,
			JSON.stringify({
				phase,
				processed,
				total,
				currentArtistDir: progress.currentArtistDir ?? null,
				currentAlbumDir: progress.currentAlbumDir ?? null,
				summary: progress.summary
			})
		);
		try {
			options?.onProgress?.(progress);
		} catch {
			// Never fail dedupe due to progress observers.
		}
	};
	emitProgress(
		'scan',
		`Scanned ${summary.albumsScanned} album directory group(s).`,
		0,
		summary.albumsScanned
	);

	const duplicateAlbumGroups = new Map<string, AlbumDirGroup[]>();
	for (const album of albumGroups) {
		const key = `${album.artistDir}::${normalizeDirComparable(album.albumDir)}`;
		const existing = duplicateAlbumGroups.get(key);
		if (existing) {
			existing.push(album);
		} else {
			duplicateAlbumGroups.set(key, [album]);
		}
	}

	const dedupeTargets = new Map<string, { artistDir: string; albumDir: string }>();
	const maxAlbums = toPositiveInt(options?.maxAlbums);
	let mergedGroupCount = 0;
	const candidateMergeGroups = Array.from(duplicateAlbumGroups.values()).filter(
		(groups) => groups.length > 1
	);
	const mergeTotal =
		typeof maxAlbums === 'number'
			? Math.min(maxAlbums, candidateMergeGroups.length)
			: candidateMergeGroups.length;
	emitProgress('merge', 'Starting duplicate album directory merge phase.', 0, mergeTotal);

	for (const groups of duplicateAlbumGroups.values()) {
		if (groups.length <= 1) continue;
		if (typeof maxAlbums === 'number' && mergedGroupCount >= maxAlbums) break;
		mergedGroupCount += 1;
		summary.duplicateAlbumGroups += 1;
		summary.duplicateAlbumDirs += groups.length;

		const canonical = chooseCanonicalAlbumGroup(groups);
		const canonicalKey = `${canonical.artistDir}::${canonical.albumDir}`;
		dedupeTargets.set(canonicalKey, {
			artistDir: canonical.artistDir,
			albumDir: canonical.albumDir
		});
		emitProgress(
			'merge',
			`Merging duplicate directories for ${canonical.artistDir}/${canonical.albumDir}`,
			mergedGroupCount,
			mergeTotal,
			{ artistDir: canonical.artistDir, albumDir: canonical.albumDir }
		);

		for (const group of groups) {
			if (group.albumDir === canonical.albumDir) continue;
			summary.albumsMerged += 1;

			const sourceDir = path.join(snapshot.baseDir, group.artistDir, group.albumDir);
			const targetDir = path.join(snapshot.baseDir, canonical.artistDir, canonical.albumDir);
			if (dryRun) {
				summary.filesMovedBetweenAlbums += group.files.length;
				pushSample(summary.movedSamples, `${sourceDir} -> ${targetDir} (dry-run)`);
				continue;
			}

			const moved = await moveDirectoryContents(sourceDir, targetDir, dryRun);
			summary.filesMovedBetweenAlbums += moved.movedFiles;
			summary.filesMoveErrors += moved.moveErrors.length;
			if (moved.movedFiles > 0) {
				pushSample(summary.movedSamples, `${sourceDir} -> ${targetDir} (${moved.movedFiles} file(s))`);
			}
			if (moved.moveErrors.length > 0) {
				summary.albumsSkipped += 1;
				pushSample(summary.skippedSamples, `${group.artistDir}/${group.albumDir} (merge errors)`);
				console.warn(
					'[Media Library Dedupe] Merge completed with file move errors',
					JSON.stringify({
						artistDir: group.artistDir,
						albumDir: group.albumDir,
						targetArtistDir: canonical.artistDir,
						targetAlbumDir: canonical.albumDir,
						errorCount: moved.moveErrors.length,
						samples: moved.moveErrors.slice(0, 5)
					})
				);
				for (const moveError of moved.moveErrors.slice(0, DEDUPE_SAMPLE_LIMIT)) {
					pushSample(
						summary.failedSamples,
						`${moveError.sourcePath} -> ${moveError.targetPath}: ${moveError.error}`
					);
				}
				continue;
			}
			await fs.rm(sourceDir, { recursive: true, force: true }).catch(() => {});
		}
	}

	for (const album of albumGroups) {
		if (hasTrackDuplicates(album.files)) {
			summary.albumsWithTrackDuplicates += 1;
			const key = `${album.artistDir}::${album.albumDir}`;
			if (!dedupeTargets.has(key)) {
				dedupeTargets.set(key, {
					artistDir: album.artistDir,
					albumDir: album.albumDir
				});
			}
		}
	}
	const trackDedupeTotal =
		typeof maxAlbums === 'number' ? Math.min(maxAlbums, dedupeTargets.size) : dedupeTargets.size;
	emitProgress(
		'track_dedupe',
		'Starting duplicate track resolution phase.',
		0,
		trackDedupeTotal
	);

	let backupRoot: string | undefined;
	if (!dryRun) {
		backupRoot = path.join(
			getTempDir(),
			'library-dedup-backups',
			`run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
		);
		await fs.mkdir(backupRoot, { recursive: true });
	}

	let dedupeProcessedAlbums = 0;
	for (const target of dedupeTargets.values()) {
		if (typeof maxAlbums === 'number' && dedupeProcessedAlbums >= maxAlbums) {
			break;
		}
		dedupeProcessedAlbums += 1;
		emitProgress(
			'track_dedupe',
			`Resolving duplicate tracks in ${target.artistDir}/${target.albumDir}`,
			dedupeProcessedAlbums,
			trackDedupeTotal,
			{ artistDir: target.artistDir, albumDir: target.albumDir }
		);
		const albumPath = path.join(snapshot.baseDir, target.artistDir, target.albumDir);
		if (!(await pathExists(albumPath))) {
			continue;
		}
		const files = await listAlbumAudioCandidates(albumPath);
		const grouped = new Map<string, DedupeFileCandidate[]>();
		for (const file of files) {
			if (!file.trackKey) {
				continue;
			}
			const existing = grouped.get(file.trackKey);
			if (existing) {
				existing.push(file);
			} else {
				grouped.set(file.trackKey, [file]);
			}
		}

		for (const candidates of grouped.values()) {
			if (candidates.length <= 1) continue;
			summary.duplicateTrackGroups += 1;
			const evaluated = await Promise.all(candidates.map((candidate) => evaluateDedupeCandidate(candidate)));
			const sorted = [...evaluated].sort(compareDedupeCandidatePriority);
			const [winner, ...losers] = sorted;
			if (!winner) {
				continue;
			}
			if (winner.integrityState !== 2) {
				summary.manualReviewRequired += 1;
				summary.albumsSkipped += 1;
				pushSample(
					summary.skippedSamples,
					`${target.artistDir}/${target.albumDir} track ${winner.trackKey ?? 'unknown'} (winner not verified)`
				);
				console.warn(
					'[Media Library Dedupe] Skipping duplicate group due to unverified winner',
					JSON.stringify({
						artistDir: target.artistDir,
						albumDir: target.albumDir,
						trackKey: winner.trackKey,
						winner: {
							path: winner.path,
							integrityState: winner.integrityState,
							durationSeconds: winner.durationSeconds
						},
						candidates: sorted.map((candidate) => ({
							path: candidate.path,
							integrityState: candidate.integrityState,
							durationSeconds: candidate.durationSeconds
						}))
					})
				);
				continue;
			}
			summary.duplicateFilesBackedUp += losers.length;
			for (const loser of losers) {
				pushSample(
					summary.backedUpSamples,
					`${target.artistDir}/${target.albumDir}/${path.basename(loser.path)}${dryRun ? ' (dry-run)' : ''}`
				);
			}
			if (dryRun || !backupRoot) {
				continue;
			}
			for (const loser of losers) {
				try {
					await moveToBackup(loser.path, backupRoot, target.artistDir, target.albumDir);
				} catch (error) {
					summary.backupErrors += 1;
					pushSample(
						summary.failedSamples,
						`${loser.path}: ${error instanceof Error ? error.message : String(error)}`
					);
					console.warn(
						'[Media Library Dedupe] Failed to move duplicate file to backup',
						JSON.stringify({
							artistDir: target.artistDir,
							albumDir: target.albumDir,
							filePath: loser.path,
							error: error instanceof Error ? error.message : String(error)
						})
					);
				}
			}
		}
	}

	if (!dryRun) {
		summary.backupRoot = backupRoot;
		clearMediaLibraryScanCache();
	}
	emitProgress(
		'complete',
		`Deduplication complete: merged ${summary.albumsMerged} album folder(s), backed up ${summary.duplicateFilesBackedUp} duplicate file(s).`,
		trackDedupeTotal,
		trackDedupeTotal
	);

	return summary;
}
