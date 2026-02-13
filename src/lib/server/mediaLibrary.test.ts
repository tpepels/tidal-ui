import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	batchAlbumLibraryStatus,
	checkAlbumInLibrary,
	checkTrackInLibrary,
	clearMediaLibraryScanCache
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
});
