import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
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
});
