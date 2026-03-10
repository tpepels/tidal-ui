import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const integrityMocks = vi.hoisted(() => ({
	validateAudioFileIntegrity: vi.fn()
}));

vi.mock('./download/audioIntegrity', () => ({
	validateAudioFileIntegrity: integrityMocks.validateAudioFileIntegrity
}));

import {
	batchAlbumLibraryStatus,
	checkAlbumInLibrary,
	checkTrackInLibrary,
	clearMediaLibraryScanCache,
	deduplicateMediaLibrary,
	sweepTransientAlbumArtifacts
} from './mediaLibrary';
import { sanitizeDirName } from '../../routes/api/download-track/_shared';

describe('mediaLibrary', () => {
	let downloadDir: string;
	let originalDownloadDir: string | undefined;
	let originalHashBytes: string | undefined;

	async function writeTrack(
		artist: string,
		album: string,
		filename = '01 - Example Track.mp3'
	): Promise<void> {
		const targetDir = path.join(downloadDir, sanitizeDirName(artist), sanitizeDirName(album));
		await fs.mkdir(targetDir, { recursive: true });
		await fs.writeFile(path.join(targetDir, filename), Buffer.from([0x49, 0x44, 0x33, 0x00]));
	}

	beforeEach(async () => {
		downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tidal-ui-media-library-'));
		originalDownloadDir = process.env.DOWNLOAD_DIR;
		originalHashBytes = process.env.MEDIA_LIBRARY_HASH_SAMPLE_BYTES;
		process.env.DOWNLOAD_DIR = downloadDir;
		process.env.MEDIA_LIBRARY_HASH_SAMPLE_BYTES = '0';
		clearMediaLibraryScanCache();
		integrityMocks.validateAudioFileIntegrity.mockReset();
		integrityMocks.validateAudioFileIntegrity.mockResolvedValue({
			ok: true,
			durationSeconds: 180,
			codecName: 'flac',
			formatName: 'flac'
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

	it('finds albums using artist/album directory structure', async () => {
		await writeTrack('Pink Floyd', 'The Wall', '101 - In the Flesh.mp3');
		await writeTrack('Pink Floyd', 'The Wall', '102 - The Thin Ice.mp3');

		const status = await checkAlbumInLibrary({
			artistName: 'Pink Floyd',
			albumTitle: 'The Wall',
			expectedTrackCount: 2
		});

		expect(status.exists).toBe(true);
		expect(status.matchedTracks).toBe(2);
	});

	it('treats Various Artists compilations as valid album matches', async () => {
		await writeTrack(
			'Various Artists',
			'Guardians Of The Galaxy - Awesome Mix Vol. 1',
			'01 - Hooked On A Feeling.mp3'
		);

		const status = await checkAlbumInLibrary({
			artistName: 'Blue Swede',
			albumTitle: 'Guardians Of The Galaxy - Awesome Mix Vol. 1'
		});

		expect(status.exists).toBe(true);
		expect(status.matchedTracks).toBe(1);
	});

	it('reports compilation presence in batch album status calls', async () => {
		await writeTrack(
			'Various Artists',
			'The Crow - Original Motion Picture Soundtrack',
			'01 - Burn.mp3'
		);

		const statuses = await batchAlbumLibraryStatus([
			{
				id: 101,
				artistName: 'The Cure',
				albumTitle: 'The Crow - Original Motion Picture Soundtrack',
				expectedTrackCount: 1
			}
		]);

		expect(statuses[101]).toEqual({
			exists: true,
			matchedTracks: 1
		});
	});

	it('avoids false positives when only loose fallback candidates exist', async () => {
		await writeTrack('Different Artist', 'Different Album', '01 - Shared Title.mp3');

		const status = await checkTrackInLibrary({
			artistName: 'Target Artist',
			albumTitle: 'Target Album',
			trackTitle: 'Shared Title'
		});

		expect(status.exists).toBe(false);
		expect(status.matches).toEqual([]);
	});

	it('ignores transient publishing/backup album directories during library scans', async () => {
		const artistDir = sanitizeDirName('José James');
		const transientAlbumDir = '.Lean On Me.publishing-job-1772838939212-sjwnkubtc-xsipu9am';
		const transientPath = path.join(downloadDir, artistDir, transientAlbumDir);
		await fs.mkdir(transientPath, { recursive: true });
		await fs.writeFile(path.join(transientPath, '06 - Use Me.flac'), Buffer.alloc(4096, 1));

		const status = await checkTrackInLibrary({
			artistName: 'José James',
			albumTitle: 'Lean On Me',
			trackTitle: 'Use Me'
		});

		expect(status.exists).toBe(false);
		expect(status.matches).toEqual([]);
	});

	it('sweeps transient publishing/backup album directories from the library root', async () => {
		const artistDir = sanitizeDirName('José James');
		const artistPath = path.join(downloadDir, artistDir);
		await fs.mkdir(artistPath, { recursive: true });

		const publishingDir = path.join(
			artistPath,
			'.Lean On Me.publishing-job-1772838939212-sjwnkubtc-xsipu9am'
		);
		const backupDir = path.join(
			artistPath,
			'.Lean On Me.backup-job-1772838939212-sjwnkubtc-xsipu9am'
		);
		const regularAlbumDir = path.join(artistPath, sanitizeDirName('Lean On Me'));
		await fs.mkdir(publishingDir, { recursive: true });
		await fs.mkdir(backupDir, { recursive: true });
		await fs.mkdir(regularAlbumDir, { recursive: true });
		await fs.writeFile(path.join(publishingDir, '06 - Use Me.flac'), Buffer.alloc(2048, 1));
		await fs.writeFile(path.join(backupDir, '11 - The Same Love That Made Me Laugh.flac'), Buffer.alloc(2048, 1));
		await fs.writeFile(path.join(regularAlbumDir, '01 - Ain\'t No Sunshine.flac'), Buffer.alloc(2048, 1));

		const summary = await sweepTransientAlbumArtifacts({ dryRun: false, minAgeMs: 0 });

		expect(summary.artifactDirsFound).toBe(2);
		expect(summary.artifactDirsRemoved).toBe(2);
		expect(summary.skippedTooFresh).toBe(0);
		expect(summary.skippedActive).toBe(0);

		await expect(fs.stat(publishingDir)).rejects.toThrow();
		await expect(fs.stat(backupDir)).rejects.toThrow();
		await expect(fs.stat(regularAlbumDir)).resolves.toBeDefined();
	});

	it('skips transient artifacts that are too fresh', async () => {
		const artistDir = sanitizeDirName('Arooj Aftab');
		const artistPath = path.join(downloadDir, artistDir);
		await fs.mkdir(artistPath, { recursive: true });

		const publishingDir = path.join(
			artistPath,
			'.Night Reign.publishing-job-1772838939212-sjwnkubtc-xsipu9am'
		);
		await fs.mkdir(publishingDir, { recursive: true });
		await fs.writeFile(path.join(publishingDir, '01 - Aey Nehin.flac'), Buffer.alloc(2048, 1));

		const summary = await sweepTransientAlbumArtifacts({
			dryRun: false,
			minAgeMs: 60_000,
			nowMs: Date.now()
		});

		expect(summary.artifactDirsFound).toBe(1);
		expect(summary.artifactDirsRemoved).toBe(0);
		expect(summary.skippedTooFresh).toBe(1);
		await expect(fs.stat(publishingDir)).resolves.toBeDefined();
	});

	it('skips transient artifacts that belong to active queue jobs', async () => {
		const artistDir = sanitizeDirName('José James');
		const artistPath = path.join(downloadDir, artistDir);
		await fs.mkdir(artistPath, { recursive: true });

		const publishingDir = path.join(
			artistPath,
			'.Lean On Me.publishing-job-1772838939212-sjwnkubtc-xsipu9am'
		);
		await fs.mkdir(publishingDir, { recursive: true });
		await fs.writeFile(path.join(publishingDir, '06 - Use Me.flac'), Buffer.alloc(2048, 1));

		const summary = await sweepTransientAlbumArtifacts({
			dryRun: false,
			minAgeMs: 0,
			activeJobIds: ['job-1772838939212-sjwnkubtc']
		});

		expect(summary.artifactDirsFound).toBe(1);
		expect(summary.artifactDirsRemoved).toBe(0);
		expect(summary.skippedActive).toBe(1);
		await expect(fs.stat(publishingDir)).resolves.toBeDefined();
	});

	it('keeps the healthy complete duplicate and backs up the weaker one', async () => {
		const artistDir = sanitizeDirName('Sonido Gallo Negro');
		const albumDir = sanitizeDirName('Example Album');
		const targetDir = path.join(downloadDir, artistDir, albumDir);
		await fs.mkdir(targetDir, { recursive: true });

		const shortPath = path.join(targetDir, '08 - Planet Claire.flac');
		const fullPath = path.join(targetDir, '08 - Planet Claire (Remastered).flac');
		await fs.writeFile(shortPath, Buffer.alloc(4000, 1));
		await fs.writeFile(fullPath, Buffer.alloc(8000, 2));

		integrityMocks.validateAudioFileIntegrity.mockImplementation(async (input: { filePath: string }) => {
			if (input.filePath === shortPath) {
				return {
					ok: false,
					error: 'Duration mismatch: expected 211s ± 5s, ffprobe reported 29s',
					durationSeconds: 29
				};
			}
			return {
				ok: true,
				durationSeconds: 211,
				codecName: 'flac',
				formatName: 'flac'
			};
		});

		const result = await deduplicateMediaLibrary({
			dryRun: false,
			forceRescan: true
		});

		const finalFiles = await fs.readdir(targetDir);
		expect(finalFiles).toContain('08 - Planet Claire (Remastered).flac');
		expect(finalFiles).not.toContain('08 - Planet Claire.flac');
		expect(result.duplicateFilesBackedUp).toBe(1);
		expect(result.backupRoot).toBeTruthy();
	});
});
