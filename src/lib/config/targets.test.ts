import { describe, expect, it } from 'vitest';
import { API_CONFIG, __test } from './targets';

describe('API_CONFIG', () => {
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
});
