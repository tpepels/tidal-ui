import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackService } from './playback.service';
import { fetchWithCORS } from '../config';

// Mock fetchWithCORS
vi.mock('../config', () => ({
	fetchWithCORS: vi.fn()
}));

const mockedFetchWithCORS = vi.mocked(fetchWithCORS);

describe('PlaybackService', () => {
	let service: PlaybackService;

	beforeEach(() => {
		service = new PlaybackService('https://test-api.com');
		vi.clearAllMocks();
	});

	it('gets track info with well-known data', async () => {
		const mockData = {
			id: 123,
			title: 'Test Track',
			artists: [{ name: 'Test Artist' }],
			album: { title: 'Test Album' },
			duration: 240,
			audioQuality: 'LOSSLESS'
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.getTrackInfo(123, 'LOSSLESS');

		expect(mockedFetchWithCORS).toHaveBeenCalledWith(
			'https://test-api.com/track/123?quality=LOSSLESS',
			{ apiVersion: 'v2' }
		);
		expect(result).toEqual(mockData);
	});

	it('gets stream data with well-known data', async () => {
		const mockData = {
			trackId: 123,
			url: 'stream-url',
			quality: 'LOSSLESS',
			bitrate: 1411,
			codec: 'FLAC'
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.getStreamData(123, 'LOSSLESS');

		expect(mockedFetchWithCORS).toHaveBeenCalledWith(
			'https://test-api.com/track/123?quality=LOSSLESS',
			{ apiVersion: 'v2' }
		);
		expect(result).toEqual(mockData);
	});

	it('gets DASH manifest with well-known data', async () => {
		const mockData = {
			trackId: 123,
			manifest: '<?xml version="1.0"?><MPD>...</MPD>',
			quality: 'HI_RES_LOSSLESS'
		};
		const mockResponse = new Response(JSON.stringify(mockData), { status: 200 });

		mockedFetchWithCORS.mockResolvedValue(mockResponse);

		const result = await service.getDashManifest(123, 'HI_RES_LOSSLESS');

		expect(mockedFetchWithCORS).toHaveBeenCalledWith(
			'https://test-api.com/track/123/stream?quality=LOSSLESS',
			{ apiVersion: 'v2' }
		);
		expect(result).toEqual(mockData);
	});

	it('gets cover URL', () => {
		const result = service.getCoverUrl('test-cover-id', '640');
		expect(result).toBe('https://test-api.com/covers/test-cover-id?size=640');
	});

	it('gets cover URL with default size', () => {
		const result = service.getCoverUrl('test-cover-id');
		expect(result).toBe('https://test-api.com/covers/test-cover-id?size=640');
	});

	it('gets artist picture URL', () => {
		const result = service.getArtistPictureUrl('test-picture-id', '750');
		expect(result).toBe('https://test-api.com/artists/test-picture-id/picture?size=750');
	});

	it('gets artist picture URL with default size', () => {
		const result = service.getArtistPictureUrl('test-picture-id');
		expect(result).toBe('https://test-api.com/artists/test-picture-id/picture?size=750');
	});

	it('gets cover URL', () => {
		const result = service.getCoverUrl('test-cover-id', '640');
		expect(result).toBe('https://test-api.com/covers/test-cover-id?size=640');
	});

	it('gets cover URL with default size', () => {
		const result = service.getCoverUrl('test-cover-id');
		expect(result).toBe('https://test-api.com/covers/test-cover-id?size=640');
	});

	it('gets artist picture URL', () => {
		const result = service.getArtistPictureUrl('test-picture-id', '750');
		expect(result).toBe('https://test-api.com/artists/test-picture-id/picture?size=750');
	});

	it('gets artist picture URL with default size', () => {
		const result = service.getArtistPictureUrl('test-picture-id');
		expect(result).toBe('https://test-api.com/artists/test-picture-id/picture?size=750');
	});

	it('formats duration for seconds', () => {
		expect(service.formatDuration(0)).toBe('0:00');
		expect(service.formatDuration(59)).toBe('0:59');
		expect(service.formatDuration(60)).toBe('1:00');
		expect(service.formatDuration(3599)).toBe('59:59');
		expect(service.formatDuration(3600)).toBe('1:00:00');
		expect(service.formatDuration(7265)).toBe('2:01:05');
	});

	it('formats duration for invalid input', () => {
		expect(service.formatDuration(-1)).toBe('0:00');
		expect(service.formatDuration(NaN)).toBe('0:00');
		expect(service.formatDuration(Infinity)).toBe('0:00');
	});

	it('handles different quality levels', async () => {
		const qualities = ['LOSSLESS', 'HIGH', 'LOW'] as const;

		for (const quality of qualities) {
			mockedFetchWithCORS.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

			await service.getTrackInfo(123, quality);

			expect(mockedFetchWithCORS).toHaveBeenCalledWith(
				`https://test-api.com/track/123?quality=${quality}`,
				{ apiVersion: 'v2' }
			);

			vi.clearAllMocks();
		}
	});

	it('handles API errors gracefully', async () => {
		mockedFetchWithCORS.mockResolvedValue(new Response('Not found', { status: 404 }));

		await expect(service.getTrackInfo(123, 'LOSSLESS')).rejects.toThrow();
	});
});
