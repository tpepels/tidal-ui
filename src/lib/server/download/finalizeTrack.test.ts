import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const metadataEmbedderMocks = vi.hoisted(() => ({
	embedMetadataToFile: vi.fn(async (filePath: string) => filePath)
}));

vi.mock('$lib/server/metadataEmbedder', () => ({
	embedMetadataToFile: metadataEmbedderMocks.embedMetadataToFile
}));

vi.mock('$lib/server/download/audioIntegrity', () => ({
	validateAudioFileIntegrity: vi.fn(async () => ({
		ok: true,
		durationSeconds: 1,
		codecName: 'flac',
		formatName: 'flac'
	}))
}));
import { finalizeTrack } from './finalizeTrack';

describe('finalizeTrack', () => {
	let downloadDir: string;
	let tempDir: string;
	let originalDownloadDir: string | undefined;
	let originalTempDir: string | undefined;

	beforeEach(async () => {
		originalDownloadDir = process.env.DOWNLOAD_DIR;
		originalTempDir = process.env.TEMP_DIR;
		downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tidal-ui-download-'));
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tidal-ui-temp-'));
		process.env.DOWNLOAD_DIR = downloadDir;
		process.env.TEMP_DIR = tempDir;
		metadataEmbedderMocks.embedMetadataToFile.mockReset();
		metadataEmbedderMocks.embedMetadataToFile.mockImplementation(async (filePath: string) => filePath);
	});

	afterEach(async () => {
		if (originalDownloadDir === undefined) {
			delete process.env.DOWNLOAD_DIR;
		} else {
			process.env.DOWNLOAD_DIR = originalDownloadDir;
		}
		if (originalTempDir === undefined) {
			delete process.env.TEMP_DIR;
		} else {
			process.env.TEMP_DIR = originalTempDir;
		}
		await fs.rm(downloadDir, { recursive: true, force: true });
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it('writes buffer to final path using canonical naming', async () => {
		const result = await finalizeTrack({
			trackId: 101,
			quality: 'LOSSLESS',
			albumTitle: 'Test Album',
			artistName: 'Test Artist',
			trackTitle: 'Test Track',
			trackNumber: 1,
			buffer: Buffer.from('audio-data'),
			downloadCoverSeperately: false
		});

		expect(result.success).toBe(true);
		if (!result.success) return;

		const expectedPath = path.join(downloadDir, 'Test Artist', 'Test Album', result.filename);
		const stat = await fs.stat(expectedPath);
		expect(stat.size).toBeGreaterThan(0);

		const tempFiles = await fs.readdir(tempDir);
		const finalizeTemps = tempFiles.filter((name) => name.startsWith('finalize-'));
		expect(finalizeTemps.length).toBe(0);
	});

	it('skips when conflictResolution is skip and file exists', async () => {
		const initial = await finalizeTrack({
			trackId: 202,
			quality: 'HIGH',
			albumTitle: 'Album',
			artistName: 'Artist',
			trackTitle: 'Track',
			trackNumber: 2,
			buffer: Buffer.from('data'),
			downloadCoverSeperately: false
		});

		expect(initial.success).toBe(true);
		if (!initial.success) return;

		const second = await finalizeTrack({
			trackId: 202,
			quality: 'HIGH',
			albumTitle: 'Album',
			artistName: 'Artist',
			trackTitle: 'Track',
			trackNumber: 2,
			buffer: Buffer.from('data'),
			conflictResolution: 'skip',
			downloadCoverSeperately: false
		});

		expect(second.success).toBe(true);
		if (second.success) {
			expect(second.action).toBe('skip');
		}
	});

	it('supports writing to a custom output base directory', async () => {
		const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tidal-ui-stage-'));
		try {
			const result = await finalizeTrack({
				trackId: 303,
				quality: 'LOSSLESS',
				albumTitle: 'Staged Album',
				artistName: 'Staged Artist',
				trackTitle: 'Staged Track',
				trackNumber: 3,
				buffer: Buffer.from('staged-audio-data'),
				downloadCoverSeperately: false,
				outputBaseDir: stagingRoot
			});

			expect(result.success).toBe(true);
			if (!result.success) return;

			const stagedPath = path.join(stagingRoot, 'Staged Artist', 'Staged Album', result.filename);
			await expect(fs.stat(stagedPath)).resolves.toBeDefined();

			const defaultPath = path.join(downloadDir, 'Staged Artist', 'Staged Album', result.filename);
			await expect(fs.stat(defaultPath)).rejects.toThrow();
		} finally {
			await fs.rm(stagingRoot, { recursive: true, force: true });
		}
	});

	it('respects explicit target directory overrides', async () => {
		const result = await finalizeTrack({
			trackId: 350,
			quality: 'LOSSLESS',
			artistName: 'Art Blakey',
			albumTitle: "Buhaina's Delight (Rudy Van Gelder Edition: Remastered)",
			targetArtistDir: 'Art Blakey',
			targetAlbumDir: "Buhaina's Delight (Rudy Van Gelder Edition Remastered)",
			trackTitle: 'Backstage Sally',
			trackNumber: 1,
			buffer: Buffer.from('legacy-dir-test'),
			downloadCoverSeperately: false
		});

		expect(result.success).toBe(true);
		if (!result.success) return;

		const overridePath = path.join(
			downloadDir,
			'Art Blakey',
			"Buhaina's Delight (Rudy Van Gelder Edition Remastered)",
			result.filename
		);
		await expect(fs.stat(overridePath)).resolves.toBeDefined();

		const sanitizedPath = path.join(
			downloadDir,
			'Art Blakey',
			"Buhaina's Delight (Rudy Van Gelder Edition_ Remastered)",
			result.filename
		);
		await expect(fs.stat(sanitizedPath)).rejects.toThrow();
	});

	it('reuses existing Picard-style filenames when overwriting', async () => {
		const targetDir = path.join(downloadDir, 'Sade', 'Love Deluxe');
		await fs.mkdir(targetDir, { recursive: true });
		const existingFilename = '1. No Ordinary Love.flac';
		const existingPath = path.join(targetDir, existingFilename);
		await fs.writeFile(existingPath, Buffer.from('old-audio-bytes'));

		const payload = Buffer.from('new-audio-bytes');
		const result = await finalizeTrack({
			trackId: 360,
			quality: 'LOSSLESS',
			artistName: 'Sade',
			albumTitle: 'Love Deluxe',
			trackTitle: 'No Ordinary Love',
			trackNumber: 1,
			buffer: payload,
			downloadCoverSeperately: false
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.filename).toBe(existingFilename);
		expect(result.filepath).toBe(existingPath);
		await expect(fs.readFile(existingPath)).resolves.toEqual(payload);
		await expect(fs.stat(path.join(targetDir, '01 - No Ordinary Love.flac'))).rejects.toThrow();
	});

	it('fails repair-mode finalization when target directory does not exist', async () => {
		const result = await finalizeTrack({
			trackId: 351,
			quality: 'LOSSLESS',
			artistName: 'Missing Artist',
			albumTitle: 'Missing Album',
			targetArtistDir: 'Missing Artist',
			targetAlbumDir: 'Missing Album',
			requireExistingTargetDir: true,
			trackTitle: 'Track',
			trackNumber: 1,
			buffer: Buffer.from('repair-target-missing'),
			downloadCoverSeperately: false
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.message).toContain('Repair target directory does not exist');
	});

	it('fails repair-mode finalization when target filename hint is missing', async () => {
		const targetDir = path.join(downloadDir, 'Existing Artist', 'Existing Album');
		await fs.mkdir(targetDir, { recursive: true });

		const result = await finalizeTrack({
			trackId: 352,
			quality: 'LOSSLESS',
			artistName: 'Existing Artist',
			albumTitle: 'Existing Album',
			targetArtistDir: 'Existing Artist',
			targetAlbumDir: 'Existing Album',
			requireExistingTargetDir: true,
			trackTitle: 'Track',
			trackNumber: 1,
			buffer: Buffer.from('repair-target-missing-hint'),
			downloadCoverSeperately: false
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.message).toContain('filename hint');
	});

	it('overwrites the hinted existing file in repair mode', async () => {
		const targetDir = path.join(downloadDir, 'Repair Artist', 'Repair Album');
		await fs.mkdir(targetDir, { recursive: true });
		const hintedFilename = '01 - Legacy Name.flac';
		const hintedPath = path.join(targetDir, hintedFilename);
		await fs.writeFile(hintedPath, Buffer.from('old-corrupt-bytes'));

		const payload = Buffer.from('new-healthy-bytes');
		const result = await finalizeTrack({
			trackId: 353,
			quality: 'LOSSLESS',
			artistName: 'Repair Artist',
			albumTitle: 'Repair Album',
			targetArtistDir: 'Repair Artist',
			targetAlbumDir: 'Repair Album',
			targetFilenameHint: hintedFilename,
			requireExistingTargetDir: true,
			trackTitle: 'Different Canonical Name',
			trackNumber: 1,
			buffer: payload,
			downloadCoverSeperately: false
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.filepath).toBe(hintedPath);
		expect(result.filename).toBe(hintedFilename);

		const updated = await fs.readFile(hintedPath);
		expect(updated.equals(payload)).toBe(true);

		const files = await fs.readdir(targetDir);
		expect(files).toEqual([hintedFilename]);
	});

	it('allows finalized size changes when metadata is embedded in-place', async () => {
		const payload = Buffer.from('raw-audio-data');
		metadataEmbedderMocks.embedMetadataToFile.mockImplementation(async (filePath: string) => {
			await fs.appendFile(filePath, Buffer.from('metadata-bytes'));
			return filePath;
		});

		const result = await finalizeTrack({
			trackId: 404,
			quality: 'LOSSLESS',
			albumTitle: 'Meta Album',
			artistName: 'Meta Artist',
			trackTitle: 'Meta Track',
			trackNumber: 1,
			buffer: payload,
			downloadCoverSeperately: false,
			trackLookup: {
				track: {
					duration: 120,
					trackNumber: 1,
					volumeNumber: 1,
					album: {
						title: 'Meta Album',
						artist: { name: 'Meta Artist' },
						artists: [{ name: 'Meta Artist' }]
					}
				},
				info: {}
			} as any
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.metadataEmbedded).toBe(true);

		const writtenPath = path.join(downloadDir, 'Meta Artist', 'Meta Album', result.filename);
		const stat = await fs.stat(writtenPath);
		expect(stat.size).toBeGreaterThan(payload.length);
	});
});
