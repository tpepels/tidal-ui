import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __test as adapterTest } from './serverDownloadAdapter';

describe('serverDownloadAdapter header propagation', () => {
  const cdnUrl = 'https://sp-ad-cf.audio.tidal.com/mediatracks/example/segment.m4s';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true } as Response));
    // @ts-expect-error override for test
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds browser headers and preserves caller headers for CDN segment requests', async () => {
    const fetchFn = await adapterTest.createServerFetch();

    await fetchFn(cdnUrl, {
      headers: {
        Authorization: 'Bearer token',
        'X-Custom': 'custom'
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0];
    const headers = opts?.headers as Headers;
    expect(headers.get('User-Agent')).toMatch(/Mozilla/);
    expect(headers.get('Referer')).toBe('https://listen.tidal.com/');
    expect(headers.get('Origin')).toBe('https://listen.tidal.com');
    expect(headers.get('Authorization')).toBe('Bearer token');
    expect(headers.get('X-Custom')).toBe('custom');
  });
});
