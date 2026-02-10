import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadTrackCore, setDownloadDebugLogging } from './downloadCore';
import type { ApiClient, DownloadOptions, FetchFunction } from './types';
import type { AudioQuality, Track, TrackInfo, TrackLookup } from '$lib/types';
import type { Mock } from 'vitest';

const baseTrack = (trackId: number, quality: AudioQuality): Track => ({
	id: trackId,
	title: 'Test Track',
	duration: 180,
	version: null,
	popularity: 0,
	editable: false,
	explicit: false,
	trackNumber: 1,
	volumeNumber: 1,
	url: 'https://example.com',
	audioQuality: quality,
	audioModes: ['STEREO'],
	allowStreaming: true,
	streamReady: true,
	premiumStreamingOnly: false,
	artist: { id: 1, name: 'Test Artist', type: 'MAIN' },
	artists: [{ id: 1, name: 'Test Artist', type: 'MAIN' }],
	album: { id: 1, title: 'Test Album', cover: '', videoCover: null }
});

const baseInfo = (trackId: number, quality: AudioQuality, manifest: string): TrackInfo => ({
	trackId,
	audioQuality: quality,
	audioMode: 'STEREO',
	manifest,
	manifestMimeType: 'audio/flac',
	assetPresentation: 'FULL'
});

const buildLookup = (params: {
	trackId: number;
	quality: AudioQuality;
	manifest: string;
	originalTrackUrl?: string | null;
}): TrackLookup => ({
	track: baseTrack(params.trackId, params.quality),
	info: baseInfo(params.trackId, params.quality, params.manifest),
	...(params.originalTrackUrl ? { originalTrackUrl: params.originalTrackUrl } : {})
});

// Mock response helper
function createMockResponse(data: Buffer, ok: boolean = true): Response {
	const mockHeaders = new Map([
		['content-type', 'audio/flac'],
		['content-length', data.length.toString()]
	]);
	
	let sent = false;
	const mockBody = {
		getReader: () => ({
			read: async () => {
				if (!sent) {
					sent = true;
					return { done: false, value: new Uint8Array(data) };
				}
				return { done: true, value: undefined };
			}
		})
	};

	return {
		ok,
		status: ok ? 200 : 400,
		statusText: ok ? 'OK' : 'Bad Request',
		headers: {
			get: (name: string) => mockHeaders.get(name.toLowerCase()) ?? null,
			has: (name: string) => mockHeaders.has(name.toLowerCase())
		} as Headers,
		body: mockBody as any,
		arrayBuffer: async () => new ArrayBuffer(data.length),
		text: async () => '',
		json: async () => ({}),
		blob: async () => new Blob(),
		clone: () => createMockResponse(data, ok),
		type: 'basic' as ResponseType,
		url: '',
		redirected: false
	} as unknown as Response;
}

describe('downloadTrackCore', () => {
	let mockApiClient: ApiClient;
	let fetchFn: Mock<Parameters<FetchFunction>, ReturnType<FetchFunction>>;
	let audioBuffer: Buffer;

	beforeEach(() => {
		audioBuffer = Buffer.alloc(2_000_000, 'audio data'); // 2MB
		
		fetchFn = vi.fn<Parameters<FetchFunction>, ReturnType<FetchFunction>>(
			async () => createMockResponse(audioBuffer)
		);
		
		mockApiClient = {
			getTrack: vi.fn(async (trackId: number, quality: AudioQuality) =>
				buildLookup({
					trackId,
					quality,
					originalTrackUrl: null,
					manifest: btoa('https://example.com/audio.flac')
				})
			)
		};
	});

	it('should download track from single URL manifest', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		setDownloadDebugLogging(false);

		const result = await downloadTrackCore({
			trackId: 1,
			quality: 'LOSSLESS',
			apiClient: mockApiClient,
			fetchFn
		});

		expect(logSpy).not.toHaveBeenCalled();
		logSpy.mockRestore();

		expect(result).toBeDefined();
		expect(result.buffer).toBeDefined();
		expect(result.receivedBytes).toBeGreaterThan(1000);
		expect(fetchFn).toHaveBeenCalled();
	});

	it('should use originalTrackUrl if available', async () => {
		mockApiClient.getTrack = vi.fn(async () =>
			buildLookup({
				trackId: 1,
				quality: 'LOSSLESS',
				originalTrackUrl: 'https://example.com/original.flac',
				manifest: btoa('https://example.com/fallback.flac')
			})
		);

		await downloadTrackCore({
			trackId: 1,
			quality: 'LOSSLESS',
			apiClient: mockApiClient,
			fetchFn
		});

		// Should fetch originalTrackUrl
		expect(fetchFn).toHaveBeenCalledWith(
			expect.stringContaining('original.flac'),
			expect.any(Object)
		);
	});

	it('should fall back to manifest if originalTrackUrl fails', async () => {
		mockApiClient.getTrack = vi.fn(async () =>
			buildLookup({
				trackId: 1,
				quality: 'LOSSLESS',
				originalTrackUrl: 'https://example.com/original.flac',
				manifest: btoa('https://example.com/fallback.flac')
			})
		);

		// First call fails, second succeeds
		fetchFn = vi.fn<Parameters<FetchFunction>, ReturnType<FetchFunction>>()
			.mockRejectedValueOnce(new Error('Network error'))
			.mockResolvedValueOnce(createMockResponse(audioBuffer));

		const result = await downloadTrackCore({
			trackId: 1,
			quality: 'LOSSLESS',
			apiClient: mockApiClient,
			fetchFn
		});

		expect(result).toBeDefined();
		expect(result.buffer).toBeDefined();
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('should handle proxy-wrapped manifest URL', async () => {
		const upstreamUrl = 'https://example.com/audio.flac';
		const proxyUrl = '/api/proxy?url=' + encodeURIComponent(upstreamUrl);
		
		mockApiClient.getTrack = vi.fn(async () =>
			buildLookup({
				trackId: 1,
				quality: 'LOSSLESS',
				originalTrackUrl: null,
				manifest: proxyUrl
			})
		);

		const result = await downloadTrackCore({
			trackId: 1,
			quality: 'LOSSLESS',
			apiClient: mockApiClient,
			fetchFn
		});

		expect(result).toBeDefined();
		expect(result.buffer).toBeDefined();
		expect(fetchFn).toHaveBeenCalledWith(
			upstreamUrl,
			expect.any(Object)
		);
	});

	it('should reject files smaller than 1KB minimum', async () => {
		const smallBuffer = Buffer.alloc(500, 'small');
		fetchFn = vi.fn<Parameters<FetchFunction>, ReturnType<FetchFunction>>(
			async () => createMockResponse(smallBuffer)
		);

		const promise = downloadTrackCore({
			trackId: 1,
			quality: 'LOSSLESS',
			apiClient: mockApiClient,
			fetchFn
		});

		await expect(promise).rejects.toThrow('suspiciously small');
	});

	it('should throw error if manifest type is unknown', async () => {
		mockApiClient.getTrack = vi.fn(async () =>
			buildLookup({
				trackId: 1,
				quality: 'LOSSLESS',
				originalTrackUrl: null,
				manifest: 'invalid-garbage-data'
			})
		);

		const promise = downloadTrackCore({
			trackId: 1,
			quality: 'LOSSLESS',
			apiClient: mockApiClient,
			fetchFn
		});

		await expect(promise).rejects.toThrow('Could not extract download URL');
	});
});
