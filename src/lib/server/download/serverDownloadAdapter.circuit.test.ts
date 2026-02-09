import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __test } from './serverDownloadAdapter';

const targetUrl = 'https://api.tidal.com/v2/test';

describe('serverDownloadAdapter circuit breaker', () => {
  beforeEach(() => {
    __test.resetCircuitState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips target after 3 consecutive failures and recovers after timeout', async () => {
    // Mock fetch to fail 3 times then succeed after timeout
    const fetchMock = vi.fn()
      // first three attempts -> 500
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      // after reset -> ok
      .mockResolvedValue({ ok: true } as Response);

    // @ts-expect-error override
    globalThis.fetch = fetchMock;

    const fetchFn = await __test.createServerFetch();

    // 3 failures
    await expect(fetchFn(targetUrl)).rejects.toThrow();
    await expect(fetchFn(targetUrl)).rejects.toThrow();
    await expect(fetchFn(targetUrl)).rejects.toThrow();

    // Should have skipped immediately on 4th call because circuit open -> still uses fetch but marks unhealthy
    await expect(fetchFn(targetUrl)).rejects.toThrow();

    // Advance time beyond timeout
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);

    // Next call should be allowed and succeed
    const okResponse = await fetchFn(targetUrl);
    expect(okResponse.ok).toBe(true);
    vi.useRealTimers();
  });
});
