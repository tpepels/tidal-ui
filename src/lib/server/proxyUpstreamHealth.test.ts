import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUpstreamHealthy, logUpstreamSuppressed, markUpstreamUnhealthy } from './proxyUpstreamHealth';

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('proxyUpstreamHealth', () => {
	it('marks upstream unhealthy until backoff expires', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		const origin = 'https://upstream.example.com';
		markUpstreamUnhealthy(origin);
		expect(isUpstreamHealthy(origin)).toBe(false);
		vi.advanceTimersByTime(5000);
		expect(isUpstreamHealthy(origin)).toBe(true);
	});

	it('throttles suppression logs', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const origin = 'https://upstream.example.com';
		markUpstreamUnhealthy(origin);
		logUpstreamSuppressed(origin);
		logUpstreamSuppressed(origin);
		expect(warn).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(10000);
		logUpstreamSuppressed(origin);
		expect(warn).toHaveBeenCalledTimes(2);
	});
});
