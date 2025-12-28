// CORS Proxy Configuration
// If you're experiencing CORS issues with the HIFI API, you can set up a proxy

type RegionPreference = 'auto' | 'us' | 'eu';

export interface ApiClusterTarget {
	name: string;
	baseUrl: string;
	weight: number;
	requiresProxy: boolean;
	category: 'auto-only';
}

const V2_API_TARGETS = [
	// NOTE: Most proxy APIs are currently down (returning 404).
	// These need to be updated with working Tidal proxy services.
	// Search for "working tidal api proxies" in Tidal communities.
	{
		name: 'wolf',
		baseUrl: 'https://wolf.qqdl.site',
		weight: 40,
		requiresProxy: true,
		category: 'auto-only'
	},
	{
		name: 'kinoplus',
		baseUrl: 'https://tidal.kinoplus.online',
		weight: 30,
		requiresProxy: true,
		category: 'auto-only'
	},
	{
		name: 'binimum',
		baseUrl: 'https://tidal-api.binimum.org',
		weight: 20,
		requiresProxy: true,
		category: 'auto-only'
	},
	{
		name: 'binimum-2',
		baseUrl: 'https://tidal-api-2.binimum.org',
		weight: 15,
		requiresProxy: true,
		category: 'auto-only'
	},
	{
		name: 'hund',
		baseUrl: 'https://hund.qqdl.site',
		weight: 15,
		requiresProxy: true,
		category: 'auto-only'
	},
	{
		name: 'maus',
		baseUrl: 'https://maus.qqdl.site',
		weight: 10,
		requiresProxy: true,
		category: 'auto-only'
	},
	{
		name: 'squid-api',
		baseUrl: 'https://triton.squid.wtf',
		weight: 5,
		requiresProxy: true,
		category: 'auto-only'
	},
	{
		name: 'katze',
		baseUrl: 'https://katze.qqdl.site',
		weight: 5,
		requiresProxy: true,
		category: 'auto-only'
	},
	{
		name: 'vogel',
		baseUrl: 'https://vogel.qqdl.site',
		weight: 5,
		requiresProxy: true,
		category: 'auto-only'
	}
] satisfies ApiClusterTarget[];

const ALL_API_TARGETS = [...V2_API_TARGETS] satisfies ApiClusterTarget[];
const US_API_TARGETS = [] satisfies ApiClusterTarget[];
const TARGET_COLLECTIONS: Record<RegionPreference, ApiClusterTarget[]> = {
	auto: [...ALL_API_TARGETS],
	eu: [],
	us: [...US_API_TARGETS]
};

const TARGETS = TARGET_COLLECTIONS.auto;

export const API_CONFIG = {
	// Cluster of target endpoints for load distribution and redundancy
	targets: TARGETS,
	baseUrl: TARGETS[0]?.baseUrl ?? 'https://tidal.401658.xyz',
	// Proxy configuration for endpoints that need it
	useProxy: true,
	proxyUrl: '/api/proxy'
};
