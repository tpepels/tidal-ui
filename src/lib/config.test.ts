import { afterEach, describe, expect, it, vi } from 'vitest';

type ApiClusterTarget = {
	name: string;
	baseUrl: string;
	weight: number;
	requiresProxy: boolean;
	category: 'auto-only';
};

const defaultTargets: ApiClusterTarget[] = [
	{
		name: 'primary',
		baseUrl: 'https://api.example.com/v1',
		weight: 1,
		requiresProxy: true,
		category: 'auto-only'
	},
	{
		name: 'fallback',
		baseUrl: 'https://fallback.example.com/v1',
		weight: 1,
		requiresProxy: false,
		category: 'auto-only'
	}
];

const buildConfig = (overrides?: Partial<{
	targets: ApiClusterTarget[];
	useProxy: boolean;
	proxyUrl: string;
	baseUrl: string;
}>) => {
	const targets = overrides?.targets ?? defaultTargets;
	return {
		targets,
		browseTargets: targets,
		streamTargets: targets,
		baseUrl: overrides?.baseUrl ?? targets[0]?.baseUrl ?? 'https://api.example.com',
		useProxy: overrides?.useProxy ?? true,
		proxyUrl: overrides?.proxyUrl ?? '/proxy'
	};
};

const ensureBrowserWindow = () => {
	Object.defineProperty(globalThis, 'window', {
		value: { document: {} },
		configurable: true
	});
};

const clearBrowserWindow = () => {
	if ('window' in globalThis) {
		delete (globalThis as { window?: unknown }).window;
	}
};

const setupConfig = async (overrides?: Parameters<typeof buildConfig>[0]) => {
	ensureBrowserWindow();
	vi.resetModules();
	vi.unmock('$lib/config');
	vi.doMock('./config/targets', () => ({
		API_CONFIG: buildConfig(overrides),
		refreshApiTargetsIfStale: vi.fn().mockResolvedValue({
			updated: false,
			count: (overrides?.targets ?? defaultTargets).length,
			source: 'static'
		})
	}));
	vi.doMock('./errors', () => ({
		retryFetch: vi.fn()
	}));
	vi.doMock('./version', () => ({
		APP_VERSION: 'v0.0-test'
	}));

	const config = await vi.importActual<typeof import('./config')>('./config');
	const { retryFetch } = await import('./errors');
	return { config, retryFetch: vi.mocked(retryFetch) };
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	clearBrowserWindow();
});

describe('config target selection', () => {
	it('selects a weighted API target deterministically with Math.random', async () => {
		const { config } = await setupConfig();
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const selected = config.selectApiTarget();
		expect(selected.name).toBe('primary');
	});

	it('proxies URLs only for proxy-required targets', async () => {
		const { config } = await setupConfig();
		const url = 'https://api.example.com/v1/tracks/1';
		const proxied = config.getProxiedUrl(url);
		expect(proxied).toBe(`/proxy?url=${encodeURIComponent(url)}`);
	});

	it('skips proxy wrapping outside the browser', async () => {
		const { config } = await setupConfig();
		delete (globalThis as { window?: unknown }).window;
		const url = 'https://api.example.com/v1/tracks/1';
		const proxied = config.getProxiedUrl(url);
		expect(proxied).toBe(url);
	});

	it('rewrites quality and sets headers for custom targets', async () => {
		const { config, retryFetch } = await setupConfig();
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const response = new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
		retryFetch.mockResolvedValue(response);

		const result = await config.fetchWithCORS(
			'https://api.example.com/v1/tracks/1?quality=LOW',
			{ preferredQuality: 'HI_RES' }
		);

		expect(result).toBe(response);
		expect(retryFetch).toHaveBeenCalledTimes(1);
		const [calledUrl, options] = retryFetch.mock.calls[0] as [string, RequestInit];
		expect(calledUrl).toBe(
			`/proxy?url=${encodeURIComponent('https://api.example.com/v1/tracks/1?quality=HI_RES')}`
		);
		const headers = new Headers(options.headers);
		expect(headers.get('X-Client')).toBe('BiniLossless/v0.0-test');
	});

	it('tries fallback targets for sticky endpoints in local mode after a 404', async () => {
		vi.stubEnv('LOCAL_MODE', 'true');
		const { config, retryFetch } = await setupConfig();
		vi.spyOn(Math, 'random').mockReturnValue(0);
		retryFetch
			.mockResolvedValueOnce(new Response('not found', { status: 404 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

		const result = await config.fetchWithCORS('https://api.example.com/v1/album/?id=123');

		expect(result.status).toBe(200);
		expect(retryFetch).toHaveBeenCalledTimes(2);
	});

	it('reuses the last successful sticky target first in local mode', async () => {
		vi.stubEnv('LOCAL_MODE', 'true');
		const { config, retryFetch } = await setupConfig();
		vi.spyOn(Math, 'random').mockReturnValue(0);
		retryFetch
			.mockResolvedValueOnce(new Response('not found', { status: 404 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

		const first = await config.fetchWithCORS('https://api.example.com/v1/album/?id=123');
		const second = await config.fetchWithCORS('https://api.example.com/v1/album/?id=456');

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(retryFetch).toHaveBeenCalledTimes(3);
	});

	it('still short-circuits sticky endpoint retries on 404 outside local mode', async () => {
		vi.stubEnv('LOCAL_MODE', 'false');
		const { config, retryFetch } = await setupConfig();
		vi.spyOn(Math, 'random').mockReturnValue(0);
		retryFetch.mockResolvedValue(new Response('not found', { status: 404 }));

		const result = await config.fetchWithCORS('https://api.example.com/v1/album/?id=123');

		expect(result.status).toBe(404);
		expect(retryFetch).toHaveBeenCalledTimes(1);
	});

	it('does not retry within a search target before rotating targets', async () => {
		const { config, retryFetch } = await setupConfig({
			targets: [
				{
					name: 'primary',
					baseUrl: 'https://primary.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				},
				{
					name: 'fallback',
					baseUrl: 'https://fallback.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				}
			]
		});
		vi.spyOn(Math, 'random').mockReturnValue(0);
		retryFetch
			.mockRejectedValueOnce(new Error('Failed to fetch'))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			);

		const result = await config.fetchWithCORS('https://primary.example.com/search/?s=test');

		expect(result.status).toBe(200);
		expect(retryFetch).toHaveBeenCalledTimes(2);
		for (const call of retryFetch.mock.calls) {
			const [, options] = call as [string, RequestInit & { maxRetries?: number }];
			expect(options.maxRetries).toBe(0);
		}
	});

	it('rewrites stale API origins to current target pool when origin is no longer configured', async () => {
		const { config, retryFetch } = await setupConfig({
			targets: [
				{
					name: 'new-primary',
					baseUrl: 'https://new-primary.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				},
				{
					name: 'new-fallback',
					baseUrl: 'https://new-fallback.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				}
			]
		});
		vi.spyOn(Math, 'random').mockReturnValue(0);
		retryFetch.mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		await config.fetchWithCORS('https://stale-origin.example.com/track/?id=123&quality=LOSSLESS');

		expect(retryFetch).toHaveBeenCalledTimes(1);
		const [calledUrl] = retryFetch.mock.calls[0] as [string, RequestInit];
		expect(calledUrl).toBe('https://new-primary.example.com/track/?id=123&quality=LOSSLESS');
	});

	it('does not rewrite TIDAL manifest CDN URLs onto API targets', async () => {
		const { config, retryFetch } = await setupConfig({
			targets: [
				{
					name: 'primary',
					baseUrl: 'https://primary.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				}
			]
		});
		retryFetch.mockResolvedValue(
			new Response('<MPD></MPD>', {
				status: 200,
				headers: { 'content-type': 'application/dash+xml' }
			})
		);

		await config.fetchWithCORS('https://im-fa.manifest.tidal.com/1/manifests/test.mpd');

		expect(retryFetch).toHaveBeenCalledTimes(1);
		const [calledUrl] = retryFetch.mock.calls[0] as [string, RequestInit];
		expect(calledUrl).toBe('https://im-fa.manifest.tidal.com/1/manifests/test.mpd');
	});

	it('tries fallback targets when a track lookup returns preview playback info', async () => {
		const { config, retryFetch } = await setupConfig({
			targets: [
				{
					name: 'primary',
					baseUrl: 'https://primary.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				},
				{
					name: 'fallback',
					baseUrl: 'https://fallback.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				}
			]
		});
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const previewResponse = new Response(
			JSON.stringify({
				data: {
					trackId: 123,
					manifest: 'preview-manifest',
					assetPresentation: 'PREVIEW'
				}
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		);
		const fullResponse = new Response(
			JSON.stringify({
				data: {
					trackId: 123,
					manifest: 'full-manifest',
					assetPresentation: 'FULL'
				}
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		);
		retryFetch.mockResolvedValueOnce(previewResponse).mockResolvedValueOnce(fullResponse);

		const result = await config.fetchWithCORS(
			'https://primary.example.com/track/?id=123&quality=LOSSLESS'
		);

		expect(result).toBe(fullResponse);
		expect(retryFetch).toHaveBeenCalledTimes(2);
		const calledUrls = retryFetch.mock.calls.map((call) => call[0] as string);
		expect(calledUrls[0]).toBe('https://primary.example.com/track/?id=123&quality=LOSSLESS');
		expect(calledUrls[1]).toBe('https://fallback.example.com/track/?id=123&quality=LOSSLESS');
		expect(warnSpy).toHaveBeenCalledWith(
			'[API Targets] Target returned preview playback info; trying next target',
			expect.objectContaining({
				target: 'primary',
				trackId: '123',
				quality: 'LOSSLESS'
			})
		);
		warnSpy.mockRestore();
	});

	it('tries fallback targets when a trackManifests lookup returns preview presentation', async () => {
		const { config, retryFetch } = await setupConfig({
			targets: [
				{
					name: 'primary',
					baseUrl: 'https://primary.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				},
				{
					name: 'fallback',
					baseUrl: 'https://fallback.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				}
			]
		});
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const previewResponse = new Response(
			JSON.stringify({
				version: '2.10',
				data: {
					data: {
						id: '123',
						type: 'trackManifests',
						attributes: {
							trackPresentation: 'PREVIEW',
							previewReason: 'FULL_REQUIRES_SUBSCRIPTION',
							formats: ['FLAC_HIRES']
						}
					}
				}
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		);
		const fullResponse = new Response(
			JSON.stringify({
				version: '2.10',
				data: {
					data: {
						id: '123',
						type: 'trackManifests',
						attributes: {
							trackPresentation: 'FULL',
							formats: ['FLAC_HIRES']
						}
					}
				}
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		);
		retryFetch.mockResolvedValueOnce(previewResponse).mockResolvedValueOnce(fullResponse);

		const result = await config.fetchWithCORS(
			'https://primary.example.com/trackManifests/?id=123&formats=FLAC_HIRES'
		);

		expect(result).toBe(fullResponse);
		expect(retryFetch).toHaveBeenCalledTimes(2);
		const calledUrls = retryFetch.mock.calls.map((call) => call[0] as string);
		expect(calledUrls[0]).toBe('https://primary.example.com/trackManifests/?id=123&formats=FLAC_HIRES');
		expect(calledUrls[1]).toBe('https://fallback.example.com/trackManifests/?id=123&formats=FLAC_HIRES');
		expect(warnSpy).toHaveBeenCalledWith(
			'[API Targets] Target returned preview playback info; trying next target',
			expect.objectContaining({
				target: 'primary',
				trackId: '123'
			})
		);
		warnSpy.mockRestore();
	});

	it('does not retry the same target repeatedly when only one target is available', async () => {
		const { config, retryFetch } = await setupConfig({
			targets: [
				{
					name: 'single',
					baseUrl: 'https://single.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				}
			]
		});

		retryFetch.mockRejectedValue(new Error('Failed to fetch'));

		await expect(
			config.fetchWithCORS('https://single.example.com/track/?id=123')
		).rejects.toThrow('after 1 target(s)');
		expect(retryFetch).toHaveBeenCalledTimes(1);
	});

	it('keeps fallback targets in play when only one target is currently healthy', async () => {
		const { config, retryFetch } = await setupConfig({
			targets: [
				{
					name: 'primary',
					baseUrl: 'https://primary.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				},
				{
					name: 'fallback',
					baseUrl: 'https://fallback.example.com',
					weight: 1,
					requiresProxy: false,
					category: 'auto-only'
				}
			]
		});
		vi.spyOn(Math, 'random').mockReturnValue(0);

		// First request: primary fails (marked unhealthy), fallback succeeds.
		retryFetch
			.mockRejectedValueOnce(new Error('Failed to fetch'))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			);

		const first = await config.fetchWithCORS('https://primary.example.com/track/?id=1');
		expect(first.status).toBe(200);

		// Second request should still probe both targets, not just the single healthy one.
		retryFetch.mockRejectedValue(new Error('Failed to fetch'));
		await expect(
			config.fetchWithCORS('https://primary.example.com/track/?id=2')
		).rejects.toThrow('after 2 target(s)');

		expect(retryFetch).toHaveBeenCalledTimes(4);
		const secondRequestCalls = retryFetch.mock.calls.slice(2).map((call) => call[0] as string);
		expect(secondRequestCalls.some((url) => url.includes('primary.example.com'))).toBe(true);
		expect(secondRequestCalls.some((url) => url.includes('fallback.example.com'))).toBe(true);
	});
});
