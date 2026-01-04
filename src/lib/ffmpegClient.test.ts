import { afterEach, describe, expect, it, vi } from 'vitest';

const makeStreamResponse = (contentType: string, bytes: number[]) => {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(bytes));
			controller.close();
		}
	});
	return new Response(stream, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Content-Length': String(bytes.length)
		}
	});
};

let originalCreateObjectURL: typeof URL.createObjectURL | undefined;
let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined;

const setupFfmpeg = async () => {
	vi.resetModules();
	const loadSpy = vi.fn().mockResolvedValue(undefined);
	vi.doMock('@ffmpeg/ffmpeg', () => ({
		FFmpeg: class {
			load = loadSpy;
		}
	}));
	const fetchFileMock = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
	vi.doMock('@ffmpeg/util', () => ({
		fetchFile: fetchFileMock
	}));

	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input.toString();
		if (init?.method === 'HEAD') {
			return new Response(null, {
				status: 200,
				headers: { 'Content-Length': '4' }
			});
		}
		if (url.endsWith('ffmpeg-core.js')) {
			return makeStreamResponse('application/javascript', [1, 2]);
		}
		if (url.endsWith('ffmpeg-core.wasm')) {
			return makeStreamResponse('application/wasm', [3, 4]);
		}
		return new Response(null, { status: 404 });
	});

	vi.stubGlobal('fetch', fetchMock);
	originalCreateObjectURL = URL.createObjectURL;
	originalRevokeObjectURL = URL.revokeObjectURL;
	const createObjectURL = vi.fn(() => 'blob:ffmpeg');
	const revokeObjectURL = vi.fn();
	Object.defineProperty(URL, 'createObjectURL', {
		value: createObjectURL,
		configurable: true,
		writable: true
	});
	Object.defineProperty(URL, 'revokeObjectURL', {
		value: revokeObjectURL,
		configurable: true,
		writable: true
	});

	const module = await vi.importActual<typeof import('./ffmpegClient')>('./ffmpegClient');
	return {
		module,
		loadSpy,
		fetchFileMock,
		fetchMock,
		createObjectURL,
		revokeObjectURL
	};
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	if (originalCreateObjectURL) {
		Object.defineProperty(URL, 'createObjectURL', {
			value: originalCreateObjectURL,
			configurable: true,
			writable: true
		});
	}
	if (originalRevokeObjectURL) {
		Object.defineProperty(URL, 'revokeObjectURL', {
			value: originalRevokeObjectURL,
			configurable: true,
			writable: true
		});
	}
});

describe('ffmpegClient', () => {
	it('estimates download size and memoizes the result', async () => {
		const { module, fetchMock } = await setupFfmpeg();
		const first = await module.estimateFfmpegDownloadSize();
		const second = await module.estimateFfmpegDownloadSize();
		expect(first).toBe(8);
		expect(second).toBe(8);
		const headCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'HEAD');
		expect(headCalls).toHaveLength(2);
	});

	it('loads ffmpeg once and reuses the instance', async () => {
		const { module, loadSpy, revokeObjectURL } = await setupFfmpeg();
		const first = await module.getFFmpeg();
		const second = await module.getFFmpeg();
		expect(first).toBe(second);
		expect(loadSpy).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).toHaveBeenCalledTimes(2);
	});

	it('delegates fetchFile to the ffmpeg util module', async () => {
		const { module, fetchFileMock } = await setupFfmpeg();
		const result = await module.fetchFile('asset.bin');
		expect(fetchFileMock).toHaveBeenCalledWith('asset.bin');
		expect(result).toEqual(new Uint8Array([1, 2, 3]));
	});
});
