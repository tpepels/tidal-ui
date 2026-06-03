import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_CONFIG, __test, refreshApiTargets } from './targets';
import { getQobuzFallbackTargets } from '$lib/api/qobuzFallback';

describe('API_CONFIG', () => {
	afterEach(() => {
		__test.resetTargets();
	});

	it('exports a non-empty target list with a baseUrl', () => {
		expect(API_CONFIG.targets.length).toBeGreaterThan(0);
		expect(API_CONFIG.browseTargets.length).toBeGreaterThan(0);
		expect(API_CONFIG.streamTargets.length).toBeGreaterThan(0);
		expect(API_CONFIG.qobuzTargets.length).toBeGreaterThan(0);
		expect(API_CONFIG.baseUrl).toBe(API_CONFIG.targets[0].baseUrl);
	});

	it('parses dynamic Qobuz instances from uptime payloads', () => {
		const pools = __test.resolveTargetPoolsFromPayload({
			api: [{ url: 'https://api.example.com', version: '2.7' }],
			streaming: [{ url: 'https://stream.example.com', version: '2.7' }],
			qobuz: [{ url: 'https://qobuz.example.com', version: '1.0' }]
		});

		expect(pools.browseTargets).toHaveLength(1);
		expect(pools.streamTargets).toHaveLength(1);
		expect(pools.qobuzTargets).toHaveLength(1);
		expect(pools.qobuzTargets[0].baseUrl).toBe('https://qobuz.example.com');
	});

	it('uses dynamic Qobuz instances from successful uptime refreshes', async () => {
		const dynamicQobuzUrl = 'https://dynamic-qobuz.example.com';
		const fetchImpl = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					lastUpdated: '2026-06-03T12:00:00.000Z',
					api: [{ url: 'https://api.example.com', version: '2.7' }],
					streaming: [{ url: 'https://stream.example.com', version: '2.7' }],
					qobuz: [{ url: dynamicQobuzUrl, version: '1.0' }]
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		});

		await refreshApiTargets({
			force: true,
			fetchImpl,
			isTrustedHostname: async () => true
		});

		const qobuzUrls = API_CONFIG.qobuzTargets.map((target) => target.baseUrl);
		expect(qobuzUrls).toEqual([dynamicQobuzUrl]);
	});

	it('does not use stale default Qobuz instances when uptime reports none', async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					lastUpdated: '2026-06-03T12:00:00.000Z',
					api: [{ url: 'https://api.example.com', version: '2.7' }],
					streaming: [{ url: 'https://stream.example.com', version: '2.7' }],
					qobuz: []
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		});

		await refreshApiTargets({
			force: true,
			fetchImpl,
			isTrustedHostname: async () => true
		});

		expect(API_CONFIG.qobuzTargets).toHaveLength(0);
		expect(getQobuzFallbackTargets()).toEqual([]);
	});
});
