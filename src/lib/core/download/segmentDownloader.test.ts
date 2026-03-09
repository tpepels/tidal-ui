import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadSegmentedDash } from './segmentDownloader';
import type { FetchFunction } from './types';
import type { Mock } from 'vitest';

describe('downloadSegmentedDash header propagation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through headers to fetchFn for all segments', async () => {
    const headers = { Authorization: 'Bearer abc', Cookie: 'sid=1' };
    const fetchMock: Mock<Parameters<FetchFunction>, ReturnType<FetchFunction>> = vi.fn<
      Parameters<FetchFunction>,
      ReturnType<FetchFunction>
    >(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) } as Response));

    await downloadSegmentedDash('https://cdn.example/init', ['https://cdn.example/seg1'], fetchMock, { headers });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mock.calls.forEach(([, opts]) => {
      const h = new Headers(opts?.headers);
      expect(h.get('Authorization')).toBe('Bearer abc');
      expect(h.get('Cookie')).toBe('sid=1');
    });
  });

  it('times out when a segment fetch hangs', async () => {
    vi.useFakeTimers();
    const fetchMock: Mock<Parameters<FetchFunction>, ReturnType<FetchFunction>> = vi.fn(
      (url: string, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options?.signal as AbortSignal | undefined;
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true }
          );
        })
    );

    const promise = downloadSegmentedDash(
      'https://cdn.example/init',
      ['https://cdn.example/seg1'],
      fetchMock,
      { segmentTimeoutMs: 1000 }
    );

    const assertion = expect(promise).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

	it('fails when a segment body does not match Content-Length', async () => {
		const fetchMock: Mock<Parameters<FetchFunction>, ReturnType<FetchFunction>> = vi
			.fn<Parameters<FetchFunction>, ReturnType<FetchFunction>>()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: {
					get: (name: string) =>
						name.toLowerCase() === 'content-length' ? '4' : null
				} as Headers,
				arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
			} as Response)
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: {
					get: (name: string) =>
						name.toLowerCase() === 'content-length' ? '10' : null
				} as Headers,
				arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer
			} as Response);

		await expect(
			downloadSegmentedDash('https://cdn.example/init', ['https://cdn.example/seg1'], fetchMock)
		).rejects.toThrow(/length mismatch/i);
	});

	it('fails when a segment returns an incomplete 206 range', async () => {
		const fetchMock: Mock<Parameters<FetchFunction>, ReturnType<FetchFunction>> = vi
			.fn<Parameters<FetchFunction>, ReturnType<FetchFunction>>()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: {
					get: (name: string) =>
						name.toLowerCase() === 'content-length' ? '4' : null
				} as Headers,
				arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
			} as Response)
			.mockResolvedValueOnce({
				ok: true,
				status: 206,
				headers: {
					get: (name: string) => {
						const key = name.toLowerCase();
						if (key === 'content-length') return '5';
						if (key === 'content-range') return 'bytes 0-4/100';
						return null;
					}
				} as Headers,
				arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer
			} as Response);

		await expect(
			downloadSegmentedDash('https://cdn.example/init', ['https://cdn.example/seg1'], fetchMock)
		).rejects.toThrow(/incomplete/i);
	});
});
