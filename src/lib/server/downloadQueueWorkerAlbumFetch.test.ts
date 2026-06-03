import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Album, Track } from '$lib/types';

const album: Album = {
	id: 232653022,
	title: 'Money For Nothing (2022 Remaster)',
	cover: 'cover-id',
	videoCover: null,
	numberOfTracks: 1,
	artist: { id: 1, name: 'Dire Straits', type: 'MAIN' },
	artists: [{ id: 1, name: 'Dire Straits', type: 'MAIN' }]
};

const track: Track = {
	id: 232653023,
	title: 'Sultans Of Swing',
	duration: 300,
	replayGain: 0,
	peak: 1,
	allowStreaming: true,
	streamReady: true,
	premiumStreamingOnly: false,
	trackNumber: 1,
	volumeNumber: 1,
	version: null,
	popularity: 0,
	url: '',
	editable: false,
	explicit: false,
	audioQuality: 'LOSSLESS',
	audioModes: ['STEREO'],
	artist: { id: 1, name: 'Dire Straits', type: 'MAIN' },
	artists: [{ id: 1, name: 'Dire Straits', type: 'MAIN' }],
	album
};

function mockWorkerControl() {
	vi.doMock('./downloadQueueWorkerControl', () => ({
		shouldStopJob: vi.fn(async () => null)
	}));
}

function mockTargetRefresh() {
	vi.doMock('$lib/config/targets', () => ({
		refreshApiTargetsIfStale: vi.fn(async () => ({
			updated: false,
			count: 0,
			source: 'static'
		}))
	}));
}

describe('fetchAlbumWithTargetRotation', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it('uses native TIDAL album metadata before hifi-api album targets', async () => {
		const nativeGetAlbum = vi.fn(async () => ({ album, tracks: [track] }));
		vi.doMock('$lib/api/tidalNativeClient', () => ({
			isNativeTidalApiEnabled: () => true,
			nativeGetAlbum
		}));
		mockWorkerControl();
		mockTargetRefresh();
		const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
		vi.stubGlobal('fetch', fetchMock);

		const { fetchAlbumWithTargetRotation } = await import('./downloadQueueWorkerAlbumFetch');
		const result = await fetchAlbumWithTargetRotation('job-1', album.id);

		expect(nativeGetAlbum).toHaveBeenCalledWith(
			album.id,
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
		expect(fetchMock).not.toHaveBeenCalled();
		expect('stopState' in result).toBe(false);
		if (!('stopState' in result)) {
			expect(result.album.id).toBe(album.id);
			expect(result.tracks.map((item) => item.id)).toEqual([track.id]);
		}
	});

	it('tries every hifi-api album target before giving up on metadata lookup', async () => {
		vi.doMock('$lib/api/tidalNativeClient', () => ({
			isNativeTidalApiEnabled: () => false,
			nativeGetAlbum: vi.fn()
		}));
		mockWorkerControl();
		mockTargetRefresh();

		const { API_CONFIG } = await import('$lib/config');
		API_CONFIG.targets = [
			{ name: 'target-1', baseUrl: 'https://target-1.example.com', weight: 1 },
			{ name: 'target-2', baseUrl: 'https://target-2.example.com', weight: 1 },
			{ name: 'target-3', baseUrl: 'https://target-3.example.com', weight: 1 },
			{ name: 'target-4', baseUrl: 'https://target-4.example.com', weight: 1 }
		] as typeof API_CONFIG.targets;
		API_CONFIG.baseUrl = API_CONFIG.targets[0].baseUrl;

		const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(async (url) => {
			const textUrl = String(url);
			if (textUrl.startsWith('https://target-4.example.com/album/')) {
				return new Response(JSON.stringify([album, { items: [{ item: track }] }]), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			return new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' });
		});
		vi.stubGlobal('fetch', fetchMock);

		const { fetchAlbumWithTargetRotation } = await import('./downloadQueueWorkerAlbumFetch');
		const result = await fetchAlbumWithTargetRotation('job-2', album.id);

		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).origin)).toEqual([
			'https://target-1.example.com',
			'https://target-2.example.com',
			'https://target-3.example.com',
			'https://target-4.example.com'
		]);
		expect('stopState' in result).toBe(false);
		if (!('stopState' in result)) {
			expect(result.tracks.map((item) => item.id)).toEqual([track.id]);
		}
	});
});
