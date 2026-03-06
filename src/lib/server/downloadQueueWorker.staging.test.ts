import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

describe('downloadQueueWorker album staging cleanup', () => {
	let originalTempDir: string | undefined;
	let tempRoot: string;

	beforeEach(async () => {
		originalTempDir = process.env.TEMP_DIR;
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tidal-ui-worker-stage-'));
		process.env.TEMP_DIR = tempRoot;
		vi.resetModules();
	});

	afterEach(async () => {
		if (originalTempDir === undefined) {
			delete process.env.TEMP_DIR;
		} else {
			process.env.TEMP_DIR = originalTempDir;
		}
		await fs.rm(tempRoot, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it('removes stale album staging directories on startup sweep', async () => {
		const worker = await import('./downloadQueueWorker');
		const stagingRoot = worker.__test.getAlbumStagingRoot();
		await fs.mkdir(path.join(stagingRoot, 'job-a-staging'), { recursive: true });
		await fs.mkdir(path.join(stagingRoot, 'job-b-staging', 'nested'), { recursive: true });
		await fs.writeFile(path.join(stagingRoot, 'job-a-staging', 'track.flac'), 'audio');
		await fs.writeFile(path.join(stagingRoot, 'job-b-staging', 'nested', 'track.flac'), 'audio');

		const cleaned = await worker.__test.cleanupStaleAlbumStagingOnStartup();
		expect(cleaned).toBe(2);

		const entries = await fs.readdir(stagingRoot);
		expect(entries).toHaveLength(0);
	});

	it('returns zero when staging root is already empty', async () => {
		const worker = await import('./downloadQueueWorker');
		const cleaned = await worker.__test.cleanupStaleAlbumStagingOnStartup();
		expect(cleaned).toBe(0);
	});
});
