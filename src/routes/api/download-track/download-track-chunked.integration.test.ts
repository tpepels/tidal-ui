import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

const CHECKSUM_SAMPLE_BYTES = 1024 * 1024;

const createMockRequestEvent = (
	request: Request,
	url: string,
	params: Record<string, string> = {}
) =>
	({
		request,
		params,
		url: new URL(url),
		cookies: {
			get: vi.fn(),
			getAll: vi.fn(() => []),
			set: vi.fn(),
			delete: vi.fn(),
			serialize: vi.fn(() => '')
		},
		fetch: global.fetch,
		getClientAddress: vi.fn(() => '127.0.0.1'),
		locals: {},
		platform: undefined,
		route: { id: null },
		setHeaders: vi.fn(),
		isDataRequest: false,
		isSubRequest: false,
		tracing: { enabled: false, root: null, current: null },
		isRemoteRequest: false
	}) as any;

const checksumForBuffer = (buffer: Buffer): string =>
	createHash('sha256')
		.update(buffer.subarray(0, Math.min(buffer.length, CHECKSUM_SAMPLE_BYTES)))
		.digest('hex');

describe('Download Track API (chunked + cover)', () => {
	const originalFetch = global.fetch;
	const coverBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x02]);
	let downloadDir = '';
	let tempDir = '';

	beforeAll(async () => {
		const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		downloadDir = `/tmp/tidal-ui-tests/downloads-${unique}`;
		tempDir = `/tmp/tidal-ui-tests/temp-${unique}`;

		vi.stubEnv('DOWNLOAD_DIR', downloadDir);
		vi.stubEnv('TEMP_DIR', tempDir);
		vi.stubEnv('REDIS_DISABLED', 'true');

		await fs.mkdir(downloadDir, { recursive: true });
		await fs.mkdir(tempDir, { recursive: true });

		global.fetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
			if (url.startsWith('https://resources.tidal.com/')) {
				return new Response(coverBytes, {
					status: 200,
					headers: {
						'Content-Type': 'image/jpeg',
						'Content-Length': coverBytes.length.toString()
					}
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
	});

	afterAll(async () => {
		global.fetch = originalFetch;
		vi.unstubAllEnvs();
		await fs.rm(downloadDir, { recursive: true, force: true });
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it('uploads chunks and downloads cover end-to-end', async () => {
		const { POST: startUpload } = await import('./+server');
		const { POST: uploadChunk } = await import('./[uploadId]/chunk/+server');
		const { sanitizePath, pendingUploads, chunkUploads } = await import('./_shared');

		const payload = Buffer.from('abcdefghijklmnopqrstuvwxyz');
		const checksum = checksumForBuffer(payload);
		const chunkSize = 5;
		const coverUrl = 'https://resources.tidal.com/images/test-cover/1280x1280.jpg';

		const metadataRequest = new Request('http://localhost/api/download-track', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				trackId: 101,
				quality: 'LOSSLESS',
				albumTitle: 'Test Album',
				artistName: 'Test Artist',
				trackTitle: 'Test Track',
				blobSize: payload.length,
				useChunks: true,
				chunkSize,
				checksum,
				conflictResolution: 'overwrite',
				downloadCoverSeperately: true,
				coverUrl
			})
		});

		const metaResponse = await startUpload(createMockRequestEvent(metadataRequest, metadataRequest.url));
		expect(metaResponse.status).toBe(201);
		const metaData = await metaResponse.json();
		expect(metaData.chunked).toBe(true);
		expect(metaData.uploadId).toBeTruthy();
		expect(metaData.totalChunks).toBe(Math.ceil(payload.length / chunkSize));

		const uploadId = metaData.uploadId as string;
		const totalChunks = metaData.totalChunks as number;

		for (let i = 0; i < totalChunks; i += 1) {
			const start = i * chunkSize;
			const end = Math.min(start + chunkSize, payload.length);
			const chunk = payload.subarray(start, end);

			const chunkRequest = new Request(`http://localhost/api/download-track/${uploadId}/chunk`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/octet-stream',
					'x-chunk-index': i.toString(),
					'x-total-chunks': totalChunks.toString()
				},
				body: chunk
			});

			const chunkResponse = await uploadChunk(
				createMockRequestEvent(chunkRequest, chunkRequest.url, { uploadId })
			);
			expect([200, 201]).toContain(chunkResponse.status);

			if (i === totalChunks - 1) {
				const finalData = await chunkResponse.json();
				expect(finalData.success).toBe(true);
				expect(finalData.coverDownloaded).toBe(true);
			}
		}

		const artistDir = sanitizePath('Test Artist');
		const albumDir = sanitizePath('Test Album');
		const title = sanitizePath('Test Track');
		const filename = `${sanitizePath('Test Artist')} - ${title}.flac`;
		const finalPath = path.join(downloadDir, artistDir, albumDir, filename);
		const coverPath = path.join(downloadDir, artistDir, albumDir, 'cover.jpg');

		const saved = await fs.readFile(finalPath);
		expect(saved.equals(payload)).toBe(true);
		const coverSaved = await fs.readFile(coverPath);
		expect(coverSaved.equals(coverBytes)).toBe(true);

		expect(pendingUploads.has(uploadId)).toBe(false);
		expect(chunkUploads.has(uploadId)).toBe(false);
	});

	it('skips overwrite when conflictResolution is skip', async () => {
		const { POST: startUpload } = await import('./+server');
		const { POST: uploadChunk } = await import('./[uploadId]/chunk/+server');
		const { sanitizePath, pendingUploads, chunkUploads } = await import('./_shared');

		const existingPayload = Buffer.from('existing-data');
		const payload = Buffer.from('new-data-will-be-skipped');
		const checksum = checksumForBuffer(payload);
		const chunkSize = 4;

		const artistName = 'Skip Artist';
		const albumTitle = 'Skip Album';
		const trackTitle = 'Skip Track';

		const artistDir = sanitizePath(artistName);
		const albumDir = sanitizePath(albumTitle);
		const title = sanitizePath(trackTitle);
		const filename = `${sanitizePath(artistName)} - ${title}.flac`;
		const targetDir = path.join(downloadDir, artistDir, albumDir);
		const finalPath = path.join(targetDir, filename);

		await fs.mkdir(targetDir, { recursive: true });
		await fs.writeFile(finalPath, existingPayload);

		const metadataRequest = new Request('http://localhost/api/download-track', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				trackId: 202,
				quality: 'LOSSLESS',
				albumTitle,
				artistName,
				trackTitle,
				blobSize: payload.length,
				useChunks: true,
				chunkSize,
				checksum,
				conflictResolution: 'skip'
			})
		});

		const metaResponse = await startUpload(createMockRequestEvent(metadataRequest, metadataRequest.url));
		expect(metaResponse.status).toBe(201);
		const metaData = await metaResponse.json();
		expect(metaData.chunked).toBe(true);
		expect(metaData.uploadId).toBeTruthy();

		const uploadId = metaData.uploadId as string;
		const totalChunks = metaData.totalChunks as number;

		for (let i = 0; i < totalChunks; i += 1) {
			const start = i * chunkSize;
			const end = Math.min(start + chunkSize, payload.length);
			const chunk = payload.subarray(start, end);

			const chunkRequest = new Request(`http://localhost/api/download-track/${uploadId}/chunk`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/octet-stream',
					'x-chunk-index': i.toString(),
					'x-total-chunks': totalChunks.toString()
				},
				body: chunk
			});

			const chunkResponse = await uploadChunk(
				createMockRequestEvent(chunkRequest, chunkRequest.url, { uploadId })
			);
			expect([200, 201]).toContain(chunkResponse.status);

			if (i === totalChunks - 1) {
				const finalData = await chunkResponse.json();
				expect(finalData.success).toBe(true);
				expect(finalData.action).toBe('skip');
			}
		}

		const saved = await fs.readFile(finalPath);
		expect(saved.equals(existingPayload)).toBe(true);

		expect(pendingUploads.has(uploadId)).toBe(false);
		expect(chunkUploads.has(uploadId)).toBe(false);
	});
});
