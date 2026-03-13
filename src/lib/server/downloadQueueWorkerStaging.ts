import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureDir, getDownloadDir, getTempDir } from '../../routes/api/download-track/_shared';

function randomSuffix(): string {
	return Math.random().toString(36).slice(2, 10);
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

export function getAlbumStagingRoot(): string {
	return path.join(getTempDir(), 'album-staging');
}

export function buildAlbumStagingRoot(jobId: string): string {
	return path.join(getAlbumStagingRoot(), `${jobId}-${Date.now()}-${randomSuffix()}`);
}

export async function cleanupAlbumStaging(stagingRoot: string | undefined): Promise<void> {
	if (!stagingRoot) return;
	try {
		await fs.rm(stagingRoot, { recursive: true, force: true });
	} catch (error) {
		console.warn(`[Worker] Failed to clean up staging directory ${stagingRoot}:`, error);
	}
}

export async function cleanupStaleAlbumStagingOnStartup(): Promise<number> {
	try {
		const stagingRoot = getAlbumStagingRoot();
		await ensureDir(stagingRoot);
		const entries = await fs.readdir(stagingRoot, { withFileTypes: true });
		let cleaned = 0;
		for (const entry of entries) {
			const entryPath = path.join(stagingRoot, entry.name);
			try {
				await fs.rm(entryPath, { recursive: true, force: true });
				cleaned += 1;
			} catch (error) {
				console.warn(`[Worker] Failed to remove stale album staging path ${entryPath}:`, error);
			}
		}
		if (cleaned > 0) {
			console.log(`[Worker] Cleaned ${cleaned} stale album staging path(s) on startup`);
		}
		return cleaned;
	} catch (error) {
		console.warn('[Worker] Failed to sweep album staging directory on startup:', error);
		return 0;
	}
}

export async function publishAlbumFromStaging(options: {
	jobId: string;
	stagingRoot: string;
	artistDirName: string;
	albumDirName: string;
}): Promise<void> {
	const stagedAlbumDir = path.join(
		options.stagingRoot,
		options.artistDirName,
		options.albumDirName
	);
	if (!(await pathExists(stagedAlbumDir))) {
		throw new Error('Album staging directory missing before publish');
	}

	const finalArtistDir = path.join(getDownloadDir(), options.artistDirName);
	const finalAlbumDir = path.join(finalArtistDir, options.albumDirName);
	await ensureDir(finalArtistDir);
	const publishingDir = path.join(
		finalArtistDir,
		`.${options.albumDirName}.publishing-${options.jobId}-${randomSuffix()}`
	);
	const backupDir = path.join(
		finalArtistDir,
		`.${options.albumDirName}.backup-${options.jobId}-${randomSuffix()}`
	);

	await fs.rm(publishingDir, { recursive: true, force: true });
	await fs.rm(backupDir, { recursive: true, force: true });
	await fs.cp(stagedAlbumDir, publishingDir, { recursive: true, force: true });

	const finalExists = await pathExists(finalAlbumDir);
	if (!finalExists) {
		try {
			await fs.rename(publishingDir, finalAlbumDir);
			await fs.rm(stagedAlbumDir, { recursive: true, force: true });
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== 'EEXIST' && code !== 'ENOTEMPTY') {
				throw error;
			}
		}
	}

	let movedExistingToBackup = false;
	try {
		if (await pathExists(finalAlbumDir)) {
			await fs.rename(finalAlbumDir, backupDir);
			movedExistingToBackup = true;
		}
		await fs.rename(publishingDir, finalAlbumDir);
		if (movedExistingToBackup) {
			await fs.rm(backupDir, { recursive: true, force: true });
		}
		await fs.rm(stagedAlbumDir, { recursive: true, force: true });
	} catch (error) {
		await fs.rm(finalAlbumDir, { recursive: true, force: true }).catch(() => {});
		if (movedExistingToBackup) {
			try {
				await fs.rename(backupDir, finalAlbumDir);
			} catch (restoreError) {
				console.error(
					`[Worker] Failed to restore album backup after publish error for ${finalAlbumDir}:`,
					restoreError
				);
			}
		}
		throw error;
	} finally {
		await fs.rm(publishingDir, { recursive: true, force: true }).catch(() => {});
		await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
	}
}
