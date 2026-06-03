import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadTrackCore } from './downloadCore';
import type { ApiClient, FetchFunction } from './types';
import type { AudioQuality, Track, TrackInfo, TrackLookup } from '$lib/types';
import type { Mock } from 'vitest';

const baseTrack = (trackId: number, quality: AudioQuality): Track => ({
	id: trackId,
	title: 'Test Track',
	duration: 10,
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
	manifestMimeType: 'audio/mp4',
	assetPresentation: 'FULL'
});

const buildLookup = (params: {
	trackId: number;
	quality: AudioQuality;
	manifest: string;
	originalTrackUrl?: string | null;
	assetPresentation?: string;
}): TrackLookup => ({
	track: baseTrack(params.trackId, params.quality),
	info: {
		...baseInfo(params.trackId, params.quality, params.manifest),
		assetPresentation: params.assetPresentation ?? 'FULL'
	},
	...(params.originalTrackUrl ? { originalTrackUrl: params.originalTrackUrl } : {})
});

describe('manifest retry rotation', () => {
  let apiClient: ApiClient;
  let fetchFn: Mock<Parameters<FetchFunction>, ReturnType<FetchFunction>>;

  beforeEach(() => {
    let manifestCall = 0;
    apiClient = {
      getTrack: vi.fn(async () => {
        // alternate base url per retry via manifest contents to simulate different CDN
        manifestCall++;
        const base = manifestCall === 1 ? 'https://cdnA' : 'https://cdnB';
        const m = `<MPD><BaseURL>${base}/</BaseURL><SegmentTemplate initialization="init.mp4" media="s$Number$.m4s" startNumber="1"><SegmentTimeline><S d="2" r="1" /></SegmentTimeline></SegmentTemplate></MPD>`;
        return buildLookup({
          trackId: 1,
          quality: 'LOSSLESS',
          originalTrackUrl: null,
          manifest: m
        });
      })
    };

    // fail first CDN init, succeed subsequent calls (init+segments) on second CDN
    fetchFn = vi.fn<Parameters<FetchFunction>, ReturnType<FetchFunction>>()
      .mockResolvedValueOnce({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) } as Response)
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1024) } as Response);
  });

  it('retries with rotated targets when segment 403 occurs', async () => {
    const result = await downloadTrackCore({
      trackId: 1,
      quality: 'LOSSLESS',
      apiClient,
      fetchFn
    });

    expect(result.receivedBytes).toBeGreaterThan(0);
    expect(fetchFn).toHaveBeenCalled();
    const calls = fetchFn.mock.calls.map(call => call[0] as string);
    expect(calls.some(u => u.toLowerCase().includes('cdna'))).toBe(true);
    expect(calls.some(u => u.toLowerCase().includes('cdnb'))).toBe(true);
  });

  it('stops retrying when a rotated manifest is a preview clip', async () => {
    const fullManifest = `<MPD><BaseURL>https://cdnA/</BaseURL><SegmentTemplate initialization="init.mp4" media="s$Number$.m4s" startNumber="1"><SegmentTimeline><S d="2" r="1" /></SegmentTimeline></SegmentTemplate></MPD>`;
    const previewManifest = btoa(JSON.stringify({ urls: ['https://cdnB/preview.flac'] }));

    apiClient = {
      getTrack: vi
        .fn()
        .mockResolvedValueOnce(
          buildLookup({
            trackId: 1,
            quality: 'LOSSLESS',
            originalTrackUrl: null,
            manifest: fullManifest
          })
        )
        .mockResolvedValueOnce(
          buildLookup({
            trackId: 1,
            quality: 'LOSSLESS',
            originalTrackUrl: null,
            manifest: previewManifest,
            assetPresentation: 'PREVIEW'
          })
        )
    };
    fetchFn = vi
      .fn<Parameters<FetchFunction>, ReturnType<FetchFunction>>()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        arrayBuffer: async () => new ArrayBuffer(0)
      } as Response);

    await expect(
      downloadTrackCore({
        trackId: 1,
        quality: 'LOSSLESS',
        apiClient,
        fetchFn
      })
    ).rejects.toThrow('preview clip');

    expect(apiClient.getTrack).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries when a single-url stream is terminated mid-download', async () => {
    apiClient = {
      getTrack: vi
        .fn()
        .mockResolvedValueOnce(
          buildLookup({
            trackId: 1,
            quality: 'LOSSLESS',
            originalTrackUrl: null,
            manifest: 'https://cdnA/audio.flac'
          })
        )
        .mockResolvedValueOnce(
          buildLookup({
            trackId: 1,
            quality: 'LOSSLESS',
            originalTrackUrl: null,
            manifest: 'https://cdnB/audio.flac'
          })
        )
    };
    fetchFn = vi
      .fn<Parameters<FetchFunction>, ReturnType<FetchFunction>>()
      .mockRejectedValueOnce(new TypeError('terminated'))
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '2048', 'content-type': 'audio/flac' }),
        arrayBuffer: async () => new ArrayBuffer(2048)
      } as Response);

    const result = await downloadTrackCore({
      trackId: 1,
      quality: 'LOSSLESS',
      apiClient,
      fetchFn
    });

    expect(result.receivedBytes).toBe(2048);
    expect(apiClient.getTrack).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][0]).toBe('https://cdnA/audio.flac');
    expect(fetchFn.mock.calls[1][0]).toBe('https://cdnB/audio.flac');
  });
});
