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

import { clearMediaLibraryScanCache, inspectAlbumIntegrity } from './mediaLibrary';
import { sanitizeDirName } from '../../routes/api/download-track/_shared';

describe('inspectAlbumIntegrity', () => {
	let downloadDir: string;
	let originalDownloadDir: string | undefined;
	let originalHashBytes: string | undefined;

	async function writeTrack(artist: string, album: string, filename: string): Promise<string> {
		const targetDir = path.join(downloadDir, sanitizeDirName(artist), sanitizeDirName(album));
		await fs.mkdir(targetDir, { recursive: true });
		const filePath = path.join(targetDir, filename);
		await fs.writeFile(filePath, Buffer.from([0x49, 0x44, 0x33, 0x00]));
		return filePath;
	}

	beforeEach(async () => {
		downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tidal-ui-media-library-integrity-'));
		originalDownloadDir = process.env.DOWNLOAD_DIR;
		originalHashBytes = process.env.MEDIA_LIBRARY_HASH_SAMPLE_BYTES;
		process.env.DOWNLOAD_DIR = downloadDir;
		process.env.MEDIA_LIBRARY_HASH_SAMPLE_BYTES = '0';
		clearMediaLibraryScanCache();
		integrityMocks.validateAudioFileIntegrity.mockReset();
		integrityMocks.validateAudioFileIntegrity.mockResolvedValue({
			ok: true,
			durationSeconds: 180,
			codecName: 'mp3',
			formatName: 'mp3'
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

	it('reports healthy, corrupt, and missing tracks', async () => {
		await writeTrack('Test Artist', 'Test Album', '01 - Healthy Track.mp3');
		const corruptPath = await writeTrack('Test Artist', 'Test Album', '02 - Corrupt Track.mp3');

		integrityMocks.validateAudioFileIntegrity.mockImplementation(async (input: { filePath: string }) => {
			if (input.filePath === corruptPath) {
				return {
					ok: false,
					error: 'Duration mismatch: expected 180s ± 5s, ffprobe reported 32s'
				};
			}
			return {
				ok: true,
				durationSeconds: 180,
				codecName: 'mp3',
				formatName: 'mp3'
			};
		});

		const report = await inspectAlbumIntegrity({
			artistName: 'Test Artist',
			albumTitle: 'Test Album',
			tracks: [
				{ trackId: 1, trackTitle: 'Healthy Track', trackNumber: 1, expectedDurationSeconds: 180 },
				{ trackId: 2, trackTitle: 'Corrupt Track', trackNumber: 2, expectedDurationSeconds: 180 },
				{ trackId: 3, trackTitle: 'Missing Track', trackNumber: 3, expectedDurationSeconds: 180 }
			]
		});

		expect(report.summary).toEqual({
			expected: 3,
			healthy: 1,
			missing: 1,
			corrupt: 1
		});
		expect(report.tracks.find((track) => track.trackId === 1)?.status).toBe('healthy');
		expect(report.tracks.find((track) => track.trackId === 2)?.status).toBe('corrupt');
		expect(report.tracks.find((track) => track.trackId === 3)?.status).toBe('missing');
	});

	it('fails fast when integrity scanner binaries are unavailable', async () => {
		await writeTrack('No Tools Artist', 'No Tools Album', '01 - Track.mp3');
		integrityMocks.validateAudioFileIntegrity.mockResolvedValue({
			ok: false,
			error: 'ffprobe binary not found'
		});

		await expect(
			inspectAlbumIntegrity({
				artistName: 'No Tools Artist',
				albumTitle: 'No Tools Album',
				tracks: [{ trackId: 99, trackTitle: 'Track', trackNumber: 1, expectedDurationSeconds: 120 }]
			})
		).rejects.toThrow('Integrity scanner unavailable');
	});
});
