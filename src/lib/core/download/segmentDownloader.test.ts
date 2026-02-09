import { describe, it, expect, vi } from 'vitest';
import { downloadSegmentedDash } from './segmentDownloader';

describe('downloadSegmentedDash header propagation', () => {
  it('passes through headers to fetchFn for all segments', async () => {
    const headers = { Authorization: 'Bearer abc', Cookie: 'sid=1' };
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) } as Response));

    await downloadSegmentedDash('https://cdn.example/init', ['https://cdn.example/seg1'], fetchMock, { headers });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mock.calls.forEach(([, opts]) => {
      const h = opts?.headers as Headers;
      expect(h.get('Authorization')).toBe('Bearer abc');
      expect(h.get('Cookie')).toBe('sid=1');
    });
  });
});
