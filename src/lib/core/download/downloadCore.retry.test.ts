import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadTrackCore } from './downloadCore';
import type { ApiClient } from './types';

// Helper manifest for segmented dash
const manifest = btoa(JSON.stringify({
  mimeType: 'audio/mp4',
  codecs: 'mp4a.40.2',
  initialization: 'https://cdnA/init',
  segments: ['https://cdnA/s1', 'https://cdnA/s2']
}));

describe('manifest retry rotation', () => {
  let apiClient: ApiClient;
  let fetchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    let manifestCall = 0;
    apiClient = {
      getTrack: vi.fn(async () => {
        // alternate base url per retry via manifest contents to simulate different CDN
        manifestCall++;
        const base = manifestCall === 1 ? 'https://cdnA' : 'https://cdnB';
        const m = btoa(JSON.stringify({
          mimeType: 'audio/mp4',
          codecs: 'mp4a.40.2',
          initialization: `${base}/init`,
          segments: [`${base}/s1`, `${base}/s2`]
        }));
        return {
          trackId: 1,
          quality: 'LOSSLESS',
          originalTrackUrl: null,
          info: {
            manifest: m,
            albumId: 1,
            albumTitle: 'A',
            artistId: 1,
            artistName: 'A',
            trackTitle: 'T',
            duration: 10,
            explicit: false,
            copyright: 'c'
          }
        } as any;
      })
    };

    // fail first CDN init, succeed subsequent calls (init+segments) on second CDN
    fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) } as Response)
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) } as Response);
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
    expect(calls.some(u => (u as string).includes('cdnA'))).toBe(true);
    expect(calls.some(u => (u as string).includes('cdnB'))).toBe(true);
  });
});
