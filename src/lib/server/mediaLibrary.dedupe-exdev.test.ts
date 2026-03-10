import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const sharedMocks = vi.hoisted(() => ({
	moveFile: vi.fn()
}));

vi.mock('../../routes/api/download-track/_shared', async () => {
	const actual = await vi.importActual<typeof import('../../routes/api/download-track/_shared')>(
		'../../routes/api/download-track/_shared'
	);
	return {
		...actual,
		moveFile: sharedMocks.moveFile
	};
});

import { clearMediaLibraryScanCache, deduplicateMediaLibrary } from './mediaLibrary';
import { sanitizeDirName } from '../../routes/api/download-track/_shared';

describe('mediaLibrary dedupe EXDEV handling', () => {
	let downloadDir: string;
	let originalDownloadDir: string | undefined;
	let originalHashBytes: string | undefined;

	beforeEach(async () => {
		downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tidal-ui-media-library-exdev-'));
		originalDownloadDir = process.env.DOWNLOAD_DIR;
		originalHashBytes = process.env.MEDIA_LIBRARY_HASH_SAMPLE_BYTES;
		process.env.DOWNLOAD_DIR = downloadDir;
		process.env.MEDIA_LIBRARY_HASH_SAMPLE_BYTES = '0';
		clearMediaLibraryScanCache();

		sharedMocks.moveFile.mockReset();
		sharedMocks.moveFile.mockImplementation(async (sourcePath: string, targetPath: string) => {
			await fs.rename(sourcePath, targetPath);
		});
	});

	afterEach(async () => {
		if (originalDownloadDir === undefined) {
			delete process.env.DOWNLOAD_DIR;
		} else {
			process.env.DOWNLOAD_DIR = originalDownloadDir;
		}
		if (originalHashBytes === undefined) {
			delete process.env.MEDIA_LIBRARY_HASH_SAMPLE_BYTES;
		} else {
			process.env.MEDIA_LIBRARY_HASH_SAMPLE_BYTES = originalHashBytes;
		}
		clearMediaLibraryScanCache();
		await fs.rm(downloadDir, { recursive: true, force: true });
	});

	it('continues merge using copy/unlink fallback when moveFile throws EXDEV', async () => {
		const artistDir = sanitizeDirName('Art Blakey');
		const artistPath = path.join(downloadDir, artistDir);
		const albumDirA = 'Twin_Album';
		const albumDirB = 'Twin:Album';
		const albumPathA = path.join(artistPath, albumDirA);
		const albumPathB = path.join(artistPath, albumDirB);
		await fs.mkdir(albumPathA, { recursive: true });
		await fs.mkdir(albumPathB, { recursive: true });
		await fs.writeFile(path.join(albumPathA, '01 - First.flac'), Buffer.alloc(1024, 1));
		await fs.writeFile(path.join(albumPathB, '02 - Second.flac'), Buffer.alloc(1024, 2));

		sharedMocks.moveFile.mockImplementationOnce(async () => {
			const error = Object.assign(new Error('cross-device link not permitted'), {
				code: 'EXDEV'
			});
			throw error;
		});

		const result = await deduplicateMediaLibrary({
			dryRun: false,
			forceRescan: true
		});

		expect(result.duplicateAlbumGroups).toBe(1);
		expect(result.albumsMerged).toBe(1);
		expect(result.filesMovedBetweenAlbums).toBeGreaterThanOrEqual(1);
		expect(result.filesMoveErrors).toBe(0);
	});
});
