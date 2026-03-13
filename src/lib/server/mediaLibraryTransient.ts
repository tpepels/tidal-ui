import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { getDownloadDir } from '../../routes/api/download-track/_shared';
import { clearMediaLibraryScanCache } from './mediaLibraryCache';
import {
	type MediaLibraryTransientSweepSummary,
	isTransientAlbumArtifactDirName,
	parseTransientAlbumArtifactJobId
} from './mediaLibraryShared';

const TRANSIENT_SWEEP_MIN_AGE_MS = Math.max(
	0,
	Number(process.env.MEDIA_LIBRARY_TRANSIENT_SWEEP_MIN_AGE_MS || 30 * 60 * 1000)
);

export async function sweepTransientAlbumArtifacts(options?: {
	baseDir?: string;
	dryRun?: boolean;
	maxSamples?: number;
	minAgeMs?: number;
	activeJobIds?: Iterable<string>;
	nowMs?: number;
}): Promise<MediaLibraryTransientSweepSummary> {
	const baseDir = options?.baseDir ?? getDownloadDir();
	const dryRun = options?.dryRun === true;
	const maxSamples = Math.max(0, Number(options?.maxSamples ?? 25));
	const minAgeMs = Math.max(0, Number(options?.minAgeMs ?? TRANSIENT_SWEEP_MIN_AGE_MS));
	const nowMs = Number.isFinite(options?.nowMs) ? Number(options?.nowMs) : Date.now();
	const activeJobIds = new Set<string>(
		Array.from(options?.activeJobIds ?? [])
			.map((value) => String(value).trim())
			.filter((value) => value.length > 0)
	);
	const summary: MediaLibraryTransientSweepSummary = {
		scannedAt: Date.now(),
		baseDir,
		dryRun,
		minAgeMs,
		artistDirsScanned: 0,
		artifactDirsFound: 0,
		artifactDirsRemoved: 0,
		skippedTooFresh: 0,
		skippedActive: 0,
		samplePaths: []
	};

	let artistEntries: Dirent[];
	try {
		artistEntries = await fs.readdir(baseDir, { withFileTypes: true });
	} catch {
		return summary;
	}

	for (const artistEntry of artistEntries) {
		if (!artistEntry.isDirectory()) {
			continue;
		}
		summary.artistDirsScanned += 1;
		const artistPath = path.join(baseDir, artistEntry.name);
		let albumEntries: Dirent[];
		try {
			albumEntries = await fs.readdir(artistPath, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const albumEntry of albumEntries) {
			if (!albumEntry.isDirectory()) {
				continue;
			}
			if (!isTransientAlbumArtifactDirName(albumEntry.name)) {
				continue;
			}

			summary.artifactDirsFound += 1;
			const relativePath = `${artistEntry.name}/${albumEntry.name}`;
			if (summary.samplePaths.length < maxSamples) {
				summary.samplePaths.push(relativePath);
			}

			const targetPath = path.join(artistPath, albumEntry.name);
			const artifactJobId = parseTransientAlbumArtifactJobId(albumEntry.name);
			if (artifactJobId && activeJobIds.has(artifactJobId)) {
				summary.skippedActive += 1;
				continue;
			}
			const artifactStat = await fs.stat(targetPath).catch(() => null);
			if (artifactStat) {
				const artifactAgeMs = Math.max(0, nowMs - artifactStat.mtimeMs);
				if (artifactAgeMs < minAgeMs) {
					summary.skippedTooFresh += 1;
					continue;
				}
			}

			if (dryRun) {
				continue;
			}

			try {
				await fs.rm(targetPath, { recursive: true, force: true });
				summary.artifactDirsRemoved += 1;
			} catch (error) {
				console.warn(
					'[Media Library Sweep] Failed to remove transient album artifact directory',
					JSON.stringify({
						path: targetPath,
						error: error instanceof Error ? error.message : String(error)
					})
				);
			}
		}
	}

	if (summary.artifactDirsRemoved > 0) {
		clearMediaLibraryScanCache();
	}

	return summary;
}
