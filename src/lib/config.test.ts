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
		API_CONFIG: buildConfig(overrides)
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
});
