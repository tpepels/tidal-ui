import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_CONFIG, __test, refreshApiTargets } from './targets';

describe('dynamic API target refresh', () => {
	beforeEach(() => {
		__test.resetTargets();
	});

	it('prefers streaming targets and excludes blocked/down hosts', async () => {
		const payload = {
			lastUpdated: '2026-03-06T22:40:49.638Z',
			api: [
				{ url: 'https://triton.squid.wtf', version: '2.4' },
				{ url: 'https://monochrome-api.samidy.com', version: '2.3' },
				{ url: 'https://arran.monochrome.tf', version: '2.5' }
			],
			streaming: [
				{ url: 'https://api.monochrome.tf', version: '2.5' },
				{ url: 'https://hifi-one.spotisaver.net', version: '2.4' },
				{ url: 'https://monochrome-api.samidy.com', version: '2.3' }
			],
			down: [{ url: 'https://arran.monochrome.tf', status: 401 }]
		};

		const fetchMock = vi.fn(async () => {
			return new Response(JSON.stringify(payload), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});

		const result = await refreshApiTargets({
			force: true,
			fetchImpl: fetchMock as unknown as typeof fetch,
			ttlMs: 0,
			isTrustedHostname: async () => true
		});

		expect(result.updated).toBe(true);
		expect(API_CONFIG.targets.length).toBe(2);
		expect(API_CONFIG.targets.map((target) => target.baseUrl)).toEqual([
			'https://api.monochrome.tf',
			'https://hifi-one.spotisaver.net'
		]);
		expect(API_CONFIG.targets.some((target) => target.baseUrl.includes('samidy.com'))).toBe(false);
		expect(API_CONFIG.targets.some((target) => target.baseUrl.includes('arran.monochrome.tf'))).toBe(
			false
		);
		expect(API_CONFIG.targets.some((target) => target.baseUrl.includes('triton.squid.wtf'))).toBe(
			false
		);
		expect(API_CONFIG.baseUrl).toBe('https://api.monochrome.tf');
	});

	it('falls back to api list when streaming list is empty', async () => {
		const payload = {
			lastUpdated: '2026-03-06T22:40:49.638Z',
			api: [
				{ url: 'https://triton.squid.wtf', version: '2.4' },
				{ url: 'https://hifi-two.spotisaver.net', version: '2.4' },
				{ url: 'https://monochrome-api.samidy.com', version: '2.3' }
			],
			streaming: [],
			down: []
		};

		const fetchMock = vi.fn(async () => {
			return new Response(JSON.stringify(payload), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});

		const result = await refreshApiTargets({
			force: true,
			fetchImpl: fetchMock as unknown as typeof fetch,
			ttlMs: 0,
			isTrustedHostname: async () => true
		});

		expect(result.updated).toBe(true);
		expect(API_CONFIG.targets.map((target) => target.baseUrl)).toEqual([
			'https://triton.squid.wtf',
			'https://hifi-two.spotisaver.net'
		]);
		expect(API_CONFIG.targets.some((target) => target.baseUrl.includes('samidy.com'))).toBe(false);
	});

	it('keeps only trusted allowlisted HTTPS hosts', async () => {
		const payload = {
			lastUpdated: '2026-03-06T22:40:49.638Z',
			streaming: [
				{ url: 'https://api.monochrome.tf', version: '2.5' },
				{ url: 'https://evil.example.com', version: '9.9' },
				{ url: 'http://hifi-one.spotisaver.net', version: '2.4' },
				{ url: 'https://127.0.0.1', version: '9.9' }
			],
			down: []
		};

		const fetchMock = vi.fn(async () => {
			return new Response(JSON.stringify(payload), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});

		const result = await refreshApiTargets({
			force: true,
			fetchImpl: fetchMock as unknown as typeof fetch,
			ttlMs: 0,
			isTrustedHostname: async (hostname: string) => hostname === 'api.monochrome.tf'
		});

		expect(result.updated).toBe(true);
		expect(API_CONFIG.targets.map((target) => target.baseUrl)).toEqual([
			'https://api.monochrome.tf'
		]);
	});
});
