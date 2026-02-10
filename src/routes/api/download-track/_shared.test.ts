import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
	buildServerFilename,
	sanitizePath,
	getServerExtension,
	detectAudioFormatFromBuffer,
	resolveFileConflict,
	generateChecksum
} from './_shared';

describe('download-track/_shared invariants', () => {
	let tempDir: string;
	let originalDownloadDir: string | undefined;

	beforeEach(async () => {
		originalDownloadDir = process.env.DOWNLOAD_DIR;
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tidal-ui-shared-'));
		process.env.DOWNLOAD_DIR = tempDir;
	});

	afterEach(async () => {
		if (originalDownloadDir === undefined) {
			delete process.env.DOWNLOAD_DIR;
		} else {
			process.env.DOWNLOAD_DIR = originalDownloadDir;
		}
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it('buildServerFilename uses sanitized artist/title and multi-volume numbering', () => {
		const filename = buildServerFilename(
			'AC/DC',
			'Song: 1',
			42,
			'flac',
			{
				track: {
					trackNumber: 3,
					volumeNumber: 2,
					album: { numberOfVolumes: 2 }
				}
			}
		);

		expect(filename).toBe('2-3 AC_DC - Song_ 1.flac');
	});

	it('buildServerFilename falls back to track id when title is missing', () => {
		const filename = buildServerFilename('Artist', undefined, 999, 'm4a');
		expect(filename).toBe('track-999.m4a');
	});

	it('sanitizePath removes forbidden characters and trims whitespace', () => {
		const value = sanitizePath('  AC/DC: Greatest..  ');
		expect(value).toBe('AC_DC_ Greatest__');
	});

	it('getServerExtension prefers detected format over quality', () => {
		const detected = { extension: 'm4a' };
		expect(getServerExtension('LOSSLESS', detected)).toBe('m4a');
	});

	it('getServerExtension falls back to quality when no detection is available', () => {
		expect(getServerExtension('LOSSLESS')).toBe('flac');
		expect(getServerExtension('HIGH')).toBe('m4a');
	});

	it('detectAudioFormatFromBuffer detects FLAC magic bytes', () => {
		const buffer = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
		const detected = detectAudioFormatFromBuffer(buffer);
		expect(detected?.extension).toBe('flac');
	});

	it('resolveFileConflict respects skip and overwrite_if_different', async () => {
		const targetDir = path.join(tempDir, 'Artist', 'Album');
		await fs.mkdir(targetDir, { recursive: true });
		const targetPath = path.join(targetDir, 'track.flac');

		const initial = Buffer.from('same-content');
		await fs.writeFile(targetPath, initial);

		const skipResult = await resolveFileConflict(targetPath, 'skip', initial.length);
		expect(skipResult.action).toBe('skip');

		const overwriteResult = await resolveFileConflict(targetPath, 'overwrite_if_different', initial.length + 1);
		expect(overwriteResult.action).toBe('overwrite');

		const checksum = await generateChecksum(initial);
		const sameResult = await resolveFileConflict(targetPath, 'overwrite_if_different', initial.length, checksum);
		expect(sameResult.action).toBe('skip');
	});
});
