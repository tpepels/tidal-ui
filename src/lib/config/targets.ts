// CORS Proxy Configuration
// If you're experiencing CORS issues with the HIFI API, you can set up a proxy

export interface ApiClusterTarget {
	name: string;
	baseUrl: string;
	weight: number;
	requiresProxy: boolean;
	category: 'auto-only';
}

export interface ApiConfig {
	targets: ApiClusterTarget[];
	baseUrl: string;
	useProxy: boolean;
	proxyUrl: string;
}

type UptimeApiEntry = {
	url?: unknown;
	version?: unknown;
};

type UptimeResponse = {
	lastUpdated?: unknown;
	api?: unknown;
	streaming?: unknown;
	down?: unknown;
};

type RefreshOptions = {
	force?: boolean;
	fetchImpl?: typeof fetch;
	ttlMs?: number;
	isTrustedHostname?: (hostname: string) => Promise<boolean>;
};

type RefreshResult = {
	updated: boolean;
	count: number;
	source: 'static' | 'uptime';
	lastUpdated?: string;
	error?: string;
};

const STATIC_V2_API_TARGETS = [
	{
		name: 'squid-api',
		baseUrl: 'https://triton.squid.wtf',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'spotisaver-1',
		baseUrl: 'https://hifi-one.spotisaver.net',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'spotisaver-2',
		baseUrl: 'https://hifi-two.spotisaver.net',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'kinoplus',
		baseUrl: 'https://tidal.kinoplus.online',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'binimum',
		baseUrl: 'https://tidal-api.binimum.org',
		weight: 10,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'hund',
		baseUrl: 'https://hund.qqdl.site',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'katze',
		baseUrl: 'https://katze.qqdl.site',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'maus',
		baseUrl: 'https://maus.qqdl.site',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'vogel',
		baseUrl: 'https://vogel.qqdl.site',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'wolf',
		baseUrl: 'https://wolf.qqdl.site',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'monochrome',
		baseUrl: 'https://arran.monochrome.tf',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'streamex',
		baseUrl: 'https://streamex.sh/api/music',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'pinkhamster',
		baseUrl: 'https://hifi.p1nkhamster.xyz',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	}
] satisfies ApiClusterTarget[];

const DEFAULT_API_TARGETS = STATIC_V2_API_TARGETS.map((target) => ({ ...target }));
const DEFAULT_FALLBACK_BASE_URL = 'https://tidal.401658.xyz';
const DEFAULT_DYNAMIC_WEIGHT = 15;
const DEFAULT_REFRESH_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REFRESH_TIMEOUT_MS = 5000;
const DYNAMIC_HOSTNAME_CACHE_TTL_MS = 10 * 60 * 1000;

const UPTIME_ENDPOINTS = [
	'https://tidal-uptime.jiffy-puffs-1j.workers.dev/',
	'https://tidal-uptime.props-76styles.workers.dev/'
] as const;

const EXCLUDED_STREAMING_HOSTS = new Set(['monochrome-api.samidy.com']);
const hostnameTrustCache = new Map<string, { trusted: boolean; expiresAt: number }>();
const staticWeightByBaseUrl = new Map<string, number>();
for (const target of DEFAULT_API_TARGETS) {
	const normalized = normalizeTargetUrl(target.baseUrl);
	if (normalized) {
		staticWeightByBaseUrl.set(normalized, target.weight);
	}
}

let refreshInFlight: Promise<RefreshResult> | null = null;
let lastSuccessfulRefreshAt = 0;
let lastRefreshSource: 'static' | 'uptime' = 'static';
let lastRefreshError: string | null = null;

export const API_CONFIG: ApiConfig = {
	// Cluster of target endpoints for load distribution and redundancy
	targets: DEFAULT_API_TARGETS.map((target) => ({ ...target })),
	baseUrl: DEFAULT_API_TARGETS[0]?.baseUrl ?? DEFAULT_FALLBACK_BASE_URL,
	// Proxy configuration for endpoints that need it
	useProxy: true,
	proxyUrl: '/api/proxy'
};

function getEnvValue(name: string): string | undefined {
	if (typeof process === 'undefined' || !process.env) {
		return undefined;
	}
	return process.env[name];
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function getRefreshTtlMs(override?: number): number {
	if (Number.isFinite(override) && (override as number) > 0) {
		return Math.trunc(override as number);
	}
	return parsePositiveInteger(getEnvValue('API_TARGET_REFRESH_TTL_MS'), DEFAULT_REFRESH_TTL_MS);
}

function getRefreshTimeoutMs(): number {
	return parsePositiveInteger(
		getEnvValue('API_TARGET_REFRESH_TIMEOUT_MS'),
		DEFAULT_REFRESH_TIMEOUT_MS
	);
}



function isDynamicRefreshEnabled(force: boolean): boolean {
	// Never call uptime endpoints directly from browser runtime (CORS + trust concerns).
	if (typeof process === 'undefined' || !process.versions?.node) return false;
	if (force) return true;
	if (getEnvValue('DISABLE_DYNAMIC_API_TARGETS') === 'true') return false;
	if (getEnvValue('DYNAMIC_API_TARGETS') === 'false') return false;
	if (getEnvValue('VITEST') === 'true') return false;
	return true;
}

function normalizeTargetUrl(value: string): string | null {
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
			return null;
		}
		const pathname = parsed.pathname.replace(/\/+$/, '');
		const normalizedPath = pathname.length > 0 ? pathname : '';
		return `${parsed.origin}${normalizedPath}`;
	} catch {
		return null;
	}
}

function isIpv4PrivateOrLocal(hostname: string): boolean {
	const parts = hostname.split('.');
	if (parts.length !== 4) return false;
	const octets = parts.map((part) => Number.parseInt(part, 10));
	if (octets.some((octet) => !Number.isFinite(octet) || octet < 0 || octet > 255)) {
		return false;
	}
	const [a, b] = octets;
	if (a === 10 || a === 127 || a === 0) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	return false;
}

function isIpv6PrivateOrLocal(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	if (normalized.startsWith('::ffff:')) {
		return isIpv4PrivateOrLocal(normalized.slice('::ffff:'.length));
	}
	return (
		normalized === '::1' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		normalized.startsWith('fe80:')
	);
}

function isPrivateOrLocalHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	if (
		normalized === 'localhost' ||
		normalized.endsWith('.localhost') ||
		normalized.endsWith('.local')
	) {
		return true;
	}
	if (normalized.includes(':')) {
		return isIpv6PrivateOrLocal(normalized);
	}
	return isIpv4PrivateOrLocal(normalized);
}

async function defaultIsTrustedHostname(hostname: string): Promise<boolean> {
	const normalized = hostname.trim().toLowerCase();
	if (!normalized) return false;
	if (isPrivateOrLocalHostname(normalized)) return false;

	const cached = hostnameTrustCache.get(normalized);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.trusted;
	}

	if (typeof process === 'undefined' || !process.versions?.node) {
		return false;
	}

	try {
		const dns = await loadNodeDnsPromises();
		if (!dns) {
			hostnameTrustCache.set(normalized, {
				trusted: false,
				expiresAt: Date.now() + DYNAMIC_HOSTNAME_CACHE_TTL_MS
			});
			return false;
		}
		const records = await dns.lookup(normalized, { all: true, verbatim: true });
		if (!Array.isArray(records) || records.length === 0) {
			hostnameTrustCache.set(normalized, {
				trusted: false,
				expiresAt: Date.now() + DYNAMIC_HOSTNAME_CACHE_TTL_MS
			});
			return false;
		}
		const trusted = records.every((record) => !isPrivateOrLocalHostname(record.address));
		hostnameTrustCache.set(normalized, {
			trusted,
			expiresAt: Date.now() + DYNAMIC_HOSTNAME_CACHE_TTL_MS
		});
		return trusted;
	} catch {
		hostnameTrustCache.set(normalized, {
			trusted: false,
			expiresAt: Date.now() + DYNAMIC_HOSTNAME_CACHE_TTL_MS
		});
		return false;
	}
}

type NodeDnsPromisesModule = {
	lookup(
		hostname: string,
		options: { all: true; verbatim: true }
	): Promise<Array<{ address: string }>>;
};

async function loadNodeDnsPromises(): Promise<NodeDnsPromisesModule | null> {
	const nodeProcess = process as typeof process & {
		getBuiltinModule?: (id: string) => unknown;
	};
	const builtinModule = nodeProcess.getBuiltinModule?.('node:dns/promises');
	if (builtinModule && typeof builtinModule === 'object') {
		return builtinModule as NodeDnsPromisesModule;
	}

	try {
		const dynamicImport = new Function(
			'return import("node:dns/promises")'
		) as () => Promise<unknown>;
		const loadedModule = await dynamicImport();
		if (loadedModule && typeof loadedModule === 'object') {
			return loadedModule as NodeDnsPromisesModule;
		}
	} catch {
		return null;
	}

	return null;
}

async function filterTrustedDynamicTargets(
	targets: ApiClusterTarget[],
	isTrustedHostname: (hostname: string) => Promise<boolean>
): Promise<ApiClusterTarget[]> {
	const trusted: ApiClusterTarget[] = [];
	for (const target of targets) {
		let parsed: URL;
		try {
			parsed = new URL(target.baseUrl);
		} catch {
			continue;
		}
		const hostname = parsed.hostname.toLowerCase();
		if (parsed.protocol !== 'https:') {
			continue;
		}
		if (isPrivateOrLocalHostname(hostname)) {
			continue;
		}
		if (!(await isTrustedHostname(hostname))) {
			continue;
		}
		trusted.push(target);
	}
	return trusted;
}

function normalizeName(value: string): string {
	return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function parseDownUrlSet(raw: unknown): Set<string> {
	const downSet = new Set<string>();
	if (!Array.isArray(raw)) return downSet;
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const record = entry as { url?: unknown };
		if (typeof record.url !== 'string') continue;
		const normalized = normalizeTargetUrl(record.url);
		if (normalized) {
			downSet.add(normalized);
		}
	}
	return downSet;
}

function parseUptimeEntries(raw: unknown): Array<{ url: string; version?: string }> {
	if (!Array.isArray(raw)) return [];
	const parsed: Array<{ url: string; version?: string }> = [];
	for (const entry of raw as UptimeApiEntry[]) {
		if (!entry || typeof entry !== 'object') continue;
		const url = typeof entry.url === 'string' ? entry.url : '';
		const normalized = normalizeTargetUrl(url);
		if (!normalized) continue;
		parsed.push({
			url: normalized,
			version: typeof entry.version === 'string' ? entry.version : undefined
		});
	}
	return parsed;
}

function buildTargetsFromEntries(
	entries: Array<{ url: string; version?: string }>,
	downSet: Set<string>
): ApiClusterTarget[] {
	const result: ApiClusterTarget[] = [];
	const seenUrls = new Set<string>();
	const seenNames = new Set<string>();

	for (const entry of entries) {
		if (seenUrls.has(entry.url)) continue;
		if (downSet.has(entry.url)) continue;

		let parsed: URL;
		try {
			parsed = new URL(entry.url);
		} catch {
			continue;
		}

		if (EXCLUDED_STREAMING_HOSTS.has(parsed.hostname)) {
			continue;
		}

		const weight = staticWeightByBaseUrl.get(entry.url) ?? DEFAULT_DYNAMIC_WEIGHT;
		const hostPart = normalizeName(parsed.hostname);
		const versionPart = entry.version ? normalizeName(entry.version) : '';
		let name = `uptime-${hostPart}${versionPart ? `-${versionPart}` : ''}`;
		if (!name || name === 'uptime-') {
			name = `uptime-target-${result.length + 1}`;
		}
		if (seenNames.has(name)) {
			let counter = 2;
			let candidate = `${name}-${counter}`;
			while (seenNames.has(candidate)) {
				counter += 1;
				candidate = `${name}-${counter}`;
			}
			name = candidate;
		}

		seenUrls.add(entry.url);
		seenNames.add(name);
		result.push({
			name,
			baseUrl: entry.url,
			weight,
			requiresProxy: false,
			category: 'auto-only'
		});
	}

	return result;
}

function applyTargets(targets: ApiClusterTarget[], source: 'static' | 'uptime'): void {
	const nextTargets = targets.length > 0 ? targets : DEFAULT_API_TARGETS;
	API_CONFIG.targets = nextTargets.map((target) => ({ ...target }));
	API_CONFIG.baseUrl = API_CONFIG.targets[0]?.baseUrl ?? DEFAULT_FALLBACK_BASE_URL;
	lastRefreshSource = source;
}

function getActiveFetch(options?: RefreshOptions): typeof fetch | null {
	if (options?.fetchImpl) return options.fetchImpl;
	if (typeof fetch !== 'function') return null;
	return fetch;
}

async function fetchUptimePayload(
	url: string,
	fetchImpl: typeof fetch,
	timeoutMs: number
): Promise<UptimeResponse | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const isNodeRuntime = typeof process !== 'undefined' && Boolean(process.versions?.node);
		const response = await fetchImpl(url, {
			method: 'GET',
			headers: isNodeRuntime
				? {
						Accept: 'application/json',
						'Cache-Control': 'no-cache'
					}
				: {
						Accept: 'application/json'
					},
			cache: 'no-store',
			signal: controller.signal
		});
		if (!response.ok) {
			return null;
		}
		const payload = (await response.json()) as unknown;
		if (!payload || typeof payload !== 'object') {
			return null;
		}
		return payload as UptimeResponse;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function chooseBestPayload(payloads: UptimeResponse[]): UptimeResponse | null {
	if (payloads.length === 0) return null;
	let best: UptimeResponse | null = null;
	let bestTimestamp = -Infinity;
	for (const payload of payloads) {
		if (!payload || typeof payload !== 'object') continue;
		const rawTimestamp = typeof payload.lastUpdated === 'string' ? Date.parse(payload.lastUpdated) : NaN;
		const timestamp = Number.isFinite(rawTimestamp) ? rawTimestamp : -Infinity;
		if (!best || timestamp > bestTimestamp) {
			best = payload;
			bestTimestamp = timestamp;
		}
	}
	return best ?? payloads[0];
}

function resolveTargetsFromPayload(payload: UptimeResponse): ApiClusterTarget[] {
	const downSet = parseDownUrlSet(payload.down);
	const streamingEntries = parseUptimeEntries(payload.streaming);
	const apiEntries = parseUptimeEntries(payload.api);
	const preferredEntries = streamingEntries.length > 0 ? streamingEntries : apiEntries;
	return buildTargetsFromEntries(preferredEntries, downSet);
}

export async function refreshApiTargets(options?: RefreshOptions): Promise<RefreshResult> {
	const force = options?.force === true;
	if (!isDynamicRefreshEnabled(force)) {
		return {
			updated: false,
			count: API_CONFIG.targets.length,
			source: lastRefreshSource,
			error: lastRefreshError ?? undefined
		};
	}

	const ttlMs = getRefreshTtlMs(options?.ttlMs);
	const now = Date.now();
	if (!force && lastSuccessfulRefreshAt > 0 && now - lastSuccessfulRefreshAt < ttlMs) {
		return {
			updated: false,
			count: API_CONFIG.targets.length,
			source: lastRefreshSource,
			error: lastRefreshError ?? undefined
		};
	}

	if (refreshInFlight) {
		return refreshInFlight;
	}

	const fetchImpl = getActiveFetch(options);
	if (!fetchImpl) {
		return {
			updated: false,
			count: API_CONFIG.targets.length,
			source: lastRefreshSource,
			error: lastRefreshError ?? undefined
		};
	}

	refreshInFlight = (async () => {
		const timeoutMs = getRefreshTimeoutMs();
		try {
			const responses = await Promise.all(
				UPTIME_ENDPOINTS.map((endpoint) => fetchUptimePayload(endpoint, fetchImpl, timeoutMs))
			);
			const validPayloads = responses.filter(
				(payload): payload is UptimeResponse => payload !== null
			);
			const chosen = chooseBestPayload(validPayloads);
			if (!chosen) {
				const errorMessage = 'No valid uptime payload was returned';
				lastRefreshError = errorMessage;
				return {
					updated: false,
					count: API_CONFIG.targets.length,
					source: lastRefreshSource,
					error: errorMessage
				};
			}

			const resolvedTargets = resolveTargetsFromPayload(chosen);
			const trustedTargets = await filterTrustedDynamicTargets(
				resolvedTargets,
				options?.isTrustedHostname ?? defaultIsTrustedHostname
			);
			if (trustedTargets.length === 0) {
				const errorMessage = 'Uptime payload had no trusted streaming targets';
				lastRefreshError = errorMessage;
				return {
					updated: false,
					count: API_CONFIG.targets.length,
					source: lastRefreshSource,
					error: errorMessage,
					lastUpdated:
						typeof chosen.lastUpdated === 'string' ? chosen.lastUpdated : undefined
				};
			}

			applyTargets(trustedTargets, 'uptime');
			lastRefreshError = null;
			lastSuccessfulRefreshAt = Date.now();
			return {
				updated: true,
				count: API_CONFIG.targets.length,
				source: 'uptime',
				lastUpdated: typeof chosen.lastUpdated === 'string' ? chosen.lastUpdated : undefined
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			lastRefreshError = message;
			return {
				updated: false,
				count: API_CONFIG.targets.length,
				source: lastRefreshSource,
				error: message
			};
		} finally {
			refreshInFlight = null;
		}
	})();

	return refreshInFlight;
}

export async function refreshApiTargetsIfStale(
	options?: Omit<RefreshOptions, 'force'>
): Promise<RefreshResult> {
	return refreshApiTargets({ ...options, force: false });
}

export function getApiTargetRefreshState(): {
	lastSuccessfulRefreshAt: number;
	source: 'static' | 'uptime';
	error?: string;
	targetCount: number;
} {
	return {
		lastSuccessfulRefreshAt,
		source: lastRefreshSource,
		error: lastRefreshError ?? undefined,
		targetCount: API_CONFIG.targets.length
	};
}

export const __test = {
	resetTargets(): void {
		applyTargets(DEFAULT_API_TARGETS, 'static');
		lastSuccessfulRefreshAt = 0;
		lastRefreshError = null;
		refreshInFlight = null;
		hostnameTrustCache.clear();
	},
	resolveTargetsFromPayload
};
