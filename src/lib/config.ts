import { APP_VERSION } from './version';

import { retryFetch } from './errors';

// CORS Proxy Configuration
// If you're experiencing CORS issues with the HIFI API, you can set up a proxy

import { API_CONFIG, refreshApiTargetsIfStale } from './config/targets';
import type { ApiClusterTarget } from './config/targets';

// Re-export for backwards compatibility
export { API_CONFIG };
export type { ApiClusterTarget };

type RegionPreference = 'auto' | 'us' | 'eu';
type TargetPurpose = 'browse' | 'stream';

type WeightedTarget = ApiClusterTarget & { cumulativeWeight: number };

let v1WeightedTargets: WeightedTarget[] | null = null;
let v2WeightedTargets: WeightedTarget[] | null = null;
let v1TargetSignature: string | null = null;
let v2TargetSignature: string | null = null;
const targetFailureTimestamps = new Map<string, number>();
const stickyEndpointPreferredTargets = new Map<string, string>();
const TARGET_FAILURE_TTL_MS = 60_000;

function buildTargetSignature(targets: ApiClusterTarget[]): string {
	return targets
		.map((target) => `${target.name}|${target.baseUrl}|${target.weight}|${target.requiresProxy}`)
		.join('||');
}

function markTargetUnhealthy(targetName: string): void {
	targetFailureTimestamps.set(targetName, Date.now());
}

function isTargetHealthy(targetName: string): boolean {
	const failureAt = targetFailureTimestamps.get(targetName);
	if (!failureAt) return true;
	return Date.now() - failureAt > TARGET_FAILURE_TTL_MS;
}

function buildWeightedTargets(targets: ApiClusterTarget[]): WeightedTarget[] {
	const validTargets = targets.filter((target) => {
		if (!target?.baseUrl || typeof target.baseUrl !== 'string') {
			return false;
		}
		if (target.weight <= 0) {
			return false;
		}
		try {
			new URL(target.baseUrl);
			return true;
		} catch (error) {
			console.error(`Invalid API target URL for ${target.name}:`, error);
			return false;
		}
	});

	if (validTargets.length === 0) {
		throw new Error('No valid API targets configured');
	}

	let cumulative = 0;
	const collected: WeightedTarget[] = [];
	for (const target of validTargets) {
		cumulative += target.weight;
		collected.push({ ...target, cumulativeWeight: cumulative });
	}
	return collected;
}

function ensureWeightedTargets(apiVersion: 'v1' | 'v2' = 'v2'): WeightedTarget[] {
	if (apiVersion === 'v2') {
		const signature = buildTargetSignature(API_CONFIG.targets);
		if (!v2WeightedTargets || v2TargetSignature !== signature) {
			v2WeightedTargets = buildWeightedTargets(API_CONFIG.targets);
			v2TargetSignature = signature;
		}
		return v2WeightedTargets;
	} else {
		const signature = buildTargetSignature(API_CONFIG.targets);
		if (!v1WeightedTargets || v1TargetSignature !== signature) {
			// v1 includes API_CONFIG.targets with fallback weighting
			const fallbackTargets = API_CONFIG.targets.map((t) => ({ ...t, weight: 1 }));
			v1WeightedTargets = buildWeightedTargets([...API_CONFIG.targets, ...fallbackTargets]);
			v1TargetSignature = signature;
		}
		return v1WeightedTargets;
	}
}

// Export for server-side use (e.g., download adapter)
export { ensureWeightedTargets };

export function selectApiTarget(apiVersion: 'v1' | 'v2' = 'v2'): ApiClusterTarget {
	const targets = ensureWeightedTargets(apiVersion);
	return selectFromWeightedTargets(targets);
}

export function getPrimaryTarget(apiVersion: 'v1' | 'v2' = 'v2'): ApiClusterTarget {
	return ensureWeightedTargets(apiVersion)[0];
}

function selectFromWeightedTargets(weighted: WeightedTarget[]): ApiClusterTarget {
	if (weighted.length === 0) {
		throw new Error('No weighted targets available for selection');
	}

	const totalWeight = weighted[weighted.length - 1]?.cumulativeWeight ?? 0;
	if (totalWeight <= 0) {
		return weighted[0];
	}

	const random = Math.random() * totalWeight;
	for (const target of weighted) {
		if (random < target.cumulativeWeight) {
			return target;
		}
	}

	return weighted[0];
}

export function getTargetsForRegion(region: RegionPreference = 'auto'): ApiClusterTarget[] {
	// Currently only 'auto' region is supported
	return region === 'auto' ? API_CONFIG.browseTargets : [];
}

export function selectApiTargetForRegion(region: RegionPreference): ApiClusterTarget {
	if (region === 'auto') {
		return selectApiTarget();
	}

	const targets = getTargetsForRegion(region);
	if (targets.length === 0) {
		return selectApiTarget();
	}

	const weighted = buildWeightedTargets(targets);
	return selectFromWeightedTargets(weighted);
}

export function hasRegionTargets(region: RegionPreference): boolean {
	if (region === 'auto') {
		return API_CONFIG.targets.length > 0;
	}

	return getTargetsForRegion(region).length > 0;
}

function parseTargetBase(target: ApiClusterTarget): URL | null {
	try {
		return new URL(target.baseUrl);
	} catch (error) {
		console.error(`Invalid API target base URL for ${target.name}:`, error);
		return null;
	}
}

function getBaseApiUrl(target?: ApiClusterTarget): URL | null {
	const chosen = target ?? getPrimaryTarget();
	return parseTargetBase(chosen);
}

function stripTrailingSlash(path: string): string {
	if (path === '/') return path;
	return path.replace(/\/+$/, '') || '/';
}

function combinePaths(basePath: string, relativePath: string): string {
	const trimmedBase = stripTrailingSlash(basePath || '/');
	const normalizedRelative = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
	if (trimmedBase === '/' || trimmedBase === '') {
		return normalizedRelative;
	}
	if (normalizedRelative === '/') {
		return `${trimmedBase}/`;
	}
	return `${trimmedBase}${normalizedRelative}`;
}

function getRelativePath(url: URL, targetBase: URL): string {
	const basePath = stripTrailingSlash(targetBase.pathname || '/');
	const currentPath = url.pathname || '/';
	if (basePath === '/' || basePath === '') {
		return currentPath.startsWith('/') ? currentPath : `/${currentPath}`;
	}
	if (!currentPath.startsWith(basePath)) {
		return currentPath;
	}
	const relative = currentPath.slice(basePath.length);
	if (!relative) {
		return '/';
	}
	return relative.startsWith('/') ? relative : `/${relative}`;
}

function matchesTarget(url: URL, target: ApiClusterTarget): boolean {
	const base = parseTargetBase(target);
	if (!base) {
		return false;
	}

	if (url.origin !== base.origin) {
		return false;
	}

	const basePath = stripTrailingSlash(base.pathname || '/');
	if (basePath === '/' || basePath === '') {
		return true;
	}

	const targetPath = stripTrailingSlash(url.pathname || '/');
	return targetPath === basePath || targetPath.startsWith(`${basePath}/`);
}

function findTargetForUrl(url: URL): ApiClusterTarget | null {
	for (const target of API_CONFIG.targets) {
		if (matchesTarget(url, target)) {
			return target;
		}
	}
	return null;
}

export function isProxyTarget(url: URL): boolean {
	const target = findTargetForUrl(url);
	return target?.requiresProxy === true;
}

function shouldPreferPrimaryTarget(url: URL): boolean {
	const path = url.pathname.toLowerCase();

	// Prefer the proxied primary target for endpoints that still require the legacy domain.
	// Revisit once legacy endpoints are retired.
	if (path.includes('/album/') || path.includes('/artist/') || path.includes('/playlist/')) {
		return true;
	}

	if (path.includes('/search/')) {
		const params = url.searchParams;
		if (params.has('a') || params.has('al') || params.has('p')) {
			return true;
		}
	}

	return false;
}

function resolveUrl(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		const baseApiUrl = getBaseApiUrl();
		if (!baseApiUrl) {
			return null;
		}

		try {
			return new URL(url, baseApiUrl);
		} catch {
			return null;
		}
	}
}

/**
 * Create a proxied URL if needed
 */
export function getProxiedUrl(url: string): string {
	const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
	if (!isBrowser) {
		return url;
	}

	if (!API_CONFIG.useProxy || !API_CONFIG.proxyUrl) {
		return url;
	}

	const targetUrl = resolveUrl(url);
	if (!targetUrl) {
		return url;
	}

	if (!isProxyTarget(targetUrl)) {
		return url;
	}

	return `${API_CONFIG.proxyUrl}?url=${encodeURIComponent(targetUrl.toString())}`;
}

function isLikelyProxyErrorEntry(entry: unknown): boolean {
	if (!entry || typeof entry !== 'object') {
		return false;
	}

	const record = entry as Record<string, unknown>;
	const status = typeof record.status === 'number' ? record.status : undefined;
	const subStatus = typeof record.subStatus === 'number' ? record.subStatus : undefined;
	const userMessage = typeof record.userMessage === 'string' ? record.userMessage : undefined;
	const detail = typeof record.detail === 'string' ? record.detail : undefined;

	if (typeof status === 'number' && status >= 400) {
		return true;
	}

	if (typeof subStatus === 'number' && subStatus >= 400) {
		return true;
	}

	const tokenPattern = /(token|invalid|unauthorized)/i;
	if (userMessage && tokenPattern.test(userMessage)) {
		return true;
	}

	if (detail && tokenPattern.test(detail)) {
		return true;
	}

	return false;
}

function isLikelyProxyErrorPayload(payload: unknown): boolean {
	if (Array.isArray(payload)) {
		return payload.some((entry) => isLikelyProxyErrorEntry(entry));
	}

	if (payload && typeof payload === 'object') {
		return isLikelyProxyErrorEntry(payload);
	}

	return false;
}

function hasPreviewAssetPresentation(payload: unknown): boolean {
	const queue: unknown[] = [payload];
	let inspected = 0;

	while (queue.length > 0 && inspected < 100) {
		inspected += 1;
		const candidate = queue.shift();
		if (!candidate || typeof candidate !== 'object') {
			continue;
		}

		if (Array.isArray(candidate)) {
			queue.push(...candidate);
			continue;
		}

		const record = candidate as Record<string, unknown>;
		const assetPresentation = record.assetPresentation;
		if (
			typeof assetPresentation === 'string' &&
			assetPresentation.trim().toUpperCase() === 'PREVIEW'
		) {
			return true;
		}

		for (const value of Object.values(record)) {
			if (value && (typeof value === 'object' || Array.isArray(value))) {
				queue.push(value);
			}
		}
	}

	return false;
}

function isTrackPlaybackLookupUrl(url: URL): boolean {
	const path = url.pathname.toLowerCase();
	return path === '/track' || path === '/track/' || path.endsWith('/track/');
}

// NOTE: This function consumes the provided response body.
// Callers should pass in a cloned response if they need to keep the original readable.
async function getUnexpectedOkResponseReason(
	response: Response,
	options?: { rejectPreviewPlayback?: boolean }
): Promise<string | null> {
	if (!response.ok) {
		return null;
	}

	if (!response.headers || typeof response.headers.get !== 'function') {
		return null;
	}
	const contentType = response.headers.get('content-type');
	if (!contentType || !contentType.toLowerCase().includes('application/json')) {
		return null;
	}

	try {
		const payload = await response.json();
		if (isLikelyProxyErrorPayload(payload)) {
			return 'proxy error payload';
		}
		if (options?.rejectPreviewPlayback && hasPreviewAssetPresentation(payload)) {
			return 'preview playback asset';
		}
		return null;
	} catch {
		return null;
	}
}

function isV2Target(target: ApiClusterTarget): boolean {
	return API_CONFIG.targets.some((t) => t.name === target.name);
}

function getDefaultTimeoutForUrl(url: URL): number {
	const path = url.pathname.toLowerCase();
	if (path.includes('/artist/') || path.includes('/album/') || path.includes('/playlist/')) {
		return 10000;
	}
	return 3000;
}

function getDefaultMaxRetriesForUrl(url: URL): number {
	const path = url.pathname.toLowerCase();
	if (
		path.includes('/artist/') ||
		path.includes('/album/') ||
		path.includes('/playlist/') ||
		path.includes('/search/')
	) {
		// Don't retry within the same target — fetchWithTargetFallback already tries the next
		// target on failure, so per-target retries only slow down the fallback chain.
		return 0;
	}
	return 3;
}

function shouldStickToSingleTarget(url: URL): boolean {
	const path = url.pathname.toLowerCase();
	return path.includes('/artist/') || path.includes('/album/') || path.includes('/playlist/');
}

function shouldShortCircuitOnNotFound(url: URL): boolean {
	const path = url.pathname.toLowerCase();
	return path.includes('/artist/') || path.includes('/album/') || path.includes('/playlist/');
}

function isLikelyApiClusterUrl(url: URL): boolean {
	const host = url.hostname.toLowerCase();
	if (
		host.endsWith('.monochrome.tf') ||
		host.endsWith('.squid.wtf') ||
		host.endsWith('.spotisaver.net') ||
		host.endsWith('.p1nkhamster.xyz') ||
		host.endsWith('.qqdl.site') ||
		(host === 'streamex.sh' || host.endsWith('.streamex.sh')) ||
		host.endsWith('.kinoplus.online') ||
		host.endsWith('.binimum.org') ||
		host.endsWith('.401658.xyz')
	) {
		return true;
	}

	const path = url.pathname.toLowerCase();
	return (
		path.includes('/track/') ||
		path.includes('/trackmanifests/') ||
		path.includes('/album/') ||
		path.includes('/artist/') ||
		path.includes('/playlist/') ||
		path.includes('/search/') ||
		path.includes('/song/') ||
		path.includes('/lyrics/') ||
		path.includes('/cover/') ||
		path.includes('/info/') ||
		path.includes('/manifest/')
	);
}

function getStickyEndpointKey(url: URL): string | null {
	const path = url.pathname.toLowerCase();
	if (path.includes('/album/')) return 'album';
	if (path.includes('/artist/')) return 'artist';
	if (path.includes('/playlist/')) return 'playlist';
	return null;
}

function isLocalModeRuntime(): boolean {
	if (typeof window !== 'undefined' && typeof window.location?.hostname === 'string') {
		const hostname = window.location.hostname;
		return (
			hostname === 'localhost' ||
			hostname === '127.0.0.1' ||
			/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
			/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
			/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)
		);
	}
	if (typeof process !== 'undefined' && process.env) {
		return process.env.LOCAL_MODE !== 'false';
	}
	return false;
}

/**
 * Detect if a URL is a media download/stream URL that needs longer timeout
 */
function isDownloadUrl(url: string | URL): boolean {
	const urlStr = typeof url === 'string' ? url : url.toString();
	// Check for content delivery, streaming, or media URLs
	const downloadPatterns = [
		/content\.tidal\.com/i,
		/\.(flac|mp3|m4a|aac|ogg|wav)(\?|$)/i,
		/audio|stream|media|download/i
	];
	return downloadPatterns.some(pattern => pattern.test(urlStr));
}

function inferTargetPurpose(
	resolvedUrl: URL,
	operationType?: 'download' | 'upload' | 'default',
	override?: TargetPurpose
): TargetPurpose {
	if (override) {
		return override;
	}

	if (operationType === 'download') {
		return 'stream';
	}

	const path = resolvedUrl.pathname.toLowerCase();
	if (
		path.includes('/track/') ||
		path.includes('/trackmanifests/') ||
		path.includes('/manifest/') ||
		path.includes('/song/')
	) {
		return 'stream';
	}

	return 'browse';
}

function getTargetsForPurpose(purpose: TargetPurpose): ApiClusterTarget[] {
	const configured = purpose === 'stream' ? API_CONFIG.streamTargets : API_CONFIG.browseTargets;
	if (configured.length > 0) {
		return configured;
	}
	if (API_CONFIG.targets.length > 0) {
		return API_CONFIG.targets;
	}
	return [];
}

function getPrimaryTargetForPurpose(purpose: TargetPurpose): ApiClusterTarget {
	const configured = getTargetsForPurpose(purpose);
	if (configured.length > 0) {
		return configured[0];
	}
	return getPrimaryTarget();
}

function selectApiTargetForPurpose(
	purpose: TargetPurpose,
	apiVersion: 'v1' | 'v2' = 'v2'
): ApiClusterTarget {
	const configured = getTargetsForPurpose(purpose);
	if (configured.length === 0) {
		return selectApiTarget(apiVersion);
	}
	const weighted = buildWeightedTargets(configured);
	return selectFromWeightedTargets(weighted);
}

/**
 * Fetch with CORS handling
 */
export async function fetchWithCORS(
	url: string,
	options?: RequestInit & {
		apiVersion?: 'v1' | 'v2';
		preferredQuality?: string;
		timeout?: number;
		maxRetries?: number;
		operationType?: 'download' | 'upload' | 'default';
		targetPurpose?: TargetPurpose;
		skipTarget?: string; // Skip a previously-failed target on retry
	}
): Promise<Response> {
	try {
		await refreshApiTargetsIfStale();
	} catch (error) {
		console.warn('[API Targets] Refresh failed, using current target list:', error);
	}

	const resolvedUrl = resolveUrl(url);
	if (!resolvedUrl) {
		throw new Error(`Unable to resolve URL: ${url}`);
	}

	const apiVersion = options?.apiVersion ?? 'v2';
	const targetPurpose = inferTargetPurpose(
		resolvedUrl,
		options?.operationType,
		options?.targetPurpose
	);
	const originTarget = findTargetForUrl(resolvedUrl);
	const shouldRouteThroughApiCluster = !originTarget && isLikelyApiClusterUrl(resolvedUrl);
	if (!originTarget && !shouldRouteThroughApiCluster) {
		return retryFetch(getProxiedUrl(resolvedUrl.toString()), {
			...options
		});
	}

	const purposeTargets = getTargetsForPurpose(targetPurpose);
	const weightedTargets =
		purposeTargets.length > 0 ? buildWeightedTargets(purposeTargets) : ensureWeightedTargets(apiVersion);
	const attemptOrder: ApiClusterTarget[] = [];
	if (shouldPreferPrimaryTarget(resolvedUrl)) {
		const primary = getPrimaryTargetForPurpose(targetPurpose);
		if (!attemptOrder.some((candidate) => candidate.name === primary.name)) {
			attemptOrder.push(primary);
		}
	}

	const selected = selectApiTargetForPurpose(targetPurpose, apiVersion);
	if (!attemptOrder.some((candidate) => candidate.name === selected.name)) {
		attemptOrder.push(selected);
	}

	for (const target of weightedTargets) {
		if (!attemptOrder.some((candidate) => candidate.name === target.name)) {
			attemptOrder.push(target);
		}
	}

	let uniqueTargets = attemptOrder.filter(
		(target, index, array) => array.findIndex((entry) => entry.name === target.name) === index
	);

	// Filter out if skipTarget is provided - ensures we try different target on retry
	if (options?.skipTarget) {
		// Handle 'retry-N' format: rotate to different targets on each retry
		const retryMatch = options.skipTarget.match(/^retry-(\d+)$/);
		if (retryMatch) {
			const retryNum = parseInt(retryMatch[1], 10);
			// Rotate the target list by moving first N targets to the end
			const rotateCount = retryNum % uniqueTargets.length;
			uniqueTargets = [...uniqueTargets.slice(rotateCount), ...uniqueTargets.slice(0, rotateCount)];
		} else {
			// Standard skipTarget: filter out the named target
			const filtered = uniqueTargets.filter(target => target.name !== options.skipTarget);
			// Only use filtered list if it has targets; otherwise keep original (fallback)
			if (filtered.length > 0) {
				uniqueTargets = filtered;
			}
		}
	}

	const candidateTargets = uniqueTargets;
	const healthyTargets = candidateTargets.filter((target) => isTargetHealthy(target.name));
	if (healthyTargets.length === 0) {
		uniqueTargets = candidateTargets;
	} else if (candidateTargets.length <= 1 || healthyTargets.length >= 2) {
		// Use only healthy targets when we still have redundancy.
		uniqueTargets = healthyTargets;
	} else {
		// Avoid collapsing to a single healthy target and retrying it repeatedly.
		// Keep the full candidate pool so one request cycle can still probe fallbacks.
		uniqueTargets = candidateTargets;
	}

	if (uniqueTargets.length === 0) {
		uniqueTargets = [getPrimaryTargetForPurpose(targetPurpose)];
	}

	const originBase = originTarget ? parseTargetBase(originTarget) : new URL(resolvedUrl.origin);
	if (!originBase) {
		throw new Error('Invalid origin target configuration.');
	}

	const stickyTarget = shouldStickToSingleTarget(resolvedUrl);
	const localModeRuntime = isLocalModeRuntime();
	const stickyEndpointKey = stickyTarget ? getStickyEndpointKey(resolvedUrl) : null;
	if (localModeRuntime && stickyEndpointKey) {
		const preferredTargetName = stickyEndpointPreferredTargets.get(stickyEndpointKey);
		if (preferredTargetName) {
			const preferredIndex = uniqueTargets.findIndex((target) => target.name === preferredTargetName);
			if (preferredIndex > 0) {
				const preferredTarget = uniqueTargets[preferredIndex];
				uniqueTargets = [
					preferredTarget,
					...uniqueTargets.slice(0, preferredIndex),
					...uniqueTargets.slice(preferredIndex + 1)
				];
			}
		}
	}
	const shortCircuitNotFound = shouldShortCircuitOnNotFound(resolvedUrl) && !localModeRuntime;
	// Try each target at most once per request cycle.
	// retryFetch already handles transient retries per target.
	const totalAttempts = uniqueTargets.length;
	let lastError: unknown = null;
	let lastResponse: Response | null = null;
	let lastUnexpectedResponse: Response | null = null;
	const defaultTimeout = getDefaultTimeoutForUrl(resolvedUrl);
	const timeout = options?.timeout ?? defaultTimeout;
	const maxRetries = options?.maxRetries ?? getDefaultMaxRetriesForUrl(resolvedUrl);
	
	// Auto-detect download operations and use longer timeout
	const operationType = options?.operationType ?? (isDownloadUrl(resolvedUrl) ? 'download' : 'default');
	
	// Track attempts for better error reporting
	const attemptDetails: { target: string; error?: string; status?: number }[] = [];

	for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
		const target = uniqueTargets[attempt];
		const targetBase = parseTargetBase(target);
		if (!targetBase) {
			continue;
		}

		const relativePath = getRelativePath(resolvedUrl, originBase);
		const rewrittenPath = combinePaths(targetBase.pathname || '/', relativePath);
		const rewrittenUrl = new URL(
			rewrittenPath + resolvedUrl.search + resolvedUrl.hash,
			targetBase.origin
		);

		// If we are falling back to a v2 target and have a preferred quality (e.g. HI_RES_LOSSLESS),
		// upgrade the quality parameter in the URL.
		if (
			isV2Target(target) &&
			options?.preferredQuality &&
			rewrittenUrl.searchParams.has('quality')
		) {
			rewrittenUrl.searchParams.set('quality', options.preferredQuality);
		}

		const finalUrl = getProxiedUrl(rewrittenUrl.toString());

		const headers = new Headers(options?.headers);
		const isCustom =
			API_CONFIG.targets.some((t) => t.name === target.name) &&
			!target.baseUrl.includes('tidal.com') &&
			!target.baseUrl.includes('api.tidal.com') &&
			!target.baseUrl.includes('monochrome.tf');

		if (isCustom) {
			headers.set('X-Client', `BiniLossless/${APP_VERSION}`);
		}

		try {
			const response = await retryFetch(finalUrl, {
				...options,
				headers,
				timeout,
				maxRetries,
				operationType
			});
			if (response.ok) {
				const unexpectedReason = await getUnexpectedOkResponseReason(response.clone(), {
					rejectPreviewPlayback:
						targetPurpose === 'stream' && isTrackPlaybackLookupUrl(rewrittenUrl)
				});
				if (!unexpectedReason) {
					if (stickyEndpointKey) {
						stickyEndpointPreferredTargets.set(stickyEndpointKey, target.name);
					}
					return response;
				}
				if (unexpectedReason === 'preview playback asset') {
					console.warn('[API Targets] Target returned preview playback info; trying next target', {
						target: target.name,
						trackId: rewrittenUrl.searchParams.get('id'),
						quality: rewrittenUrl.searchParams.get('quality')
					});
				}
				lastUnexpectedResponse = response;
				attemptDetails.push({ target: target.name, error: unexpectedReason });
				continue;
			}

			lastResponse = response;
			attemptDetails.push({ target: target.name, status: response.status });
			if (response.status >= 500) {
				markTargetUnhealthy(target.name);
			}
			if (response.status === 404 && shortCircuitNotFound) {
				return response;
			}
		} catch (error) {
			lastError = error;
			markTargetUnhealthy(target.name);
			const errorMsg = error instanceof Error ? error.message : String(error);
			attemptDetails.push({ target: target.name, error: errorMsg });
			if (error instanceof TypeError && error.message.includes('CORS')) {
				continue;
			}
		}
	}

	if (lastUnexpectedResponse) {
		return lastUnexpectedResponse;
	}

	if (lastResponse) {
		return lastResponse;
	}

	// Build detailed error message with attempt information
	const attemptSummary = attemptDetails
		.map((d) => {
			if (d.error) {
				return `[${d.target}] Error: ${d.error.substring(0, 50)}`;
			}
			return `[${d.target}] HTTP ${d.status}`;
		})
		.join('; ');

	if (lastError) {
		if (
			lastError instanceof TypeError &&
			typeof lastError.message === 'string' &&
			lastError.message.includes('CORS')
		) {
			throw new Error(
				`CORS error detected (${attemptSummary}). Please configure a proxy in src/lib/config.ts or enable CORS on your backend.`
			);
		}
		const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
		throw new Error(
			`API request failed after ${attemptDetails.length} target(s): ${errorMsg}. ` +
			`Attempts: ${attemptSummary}`
		);
	}

	throw new Error(
		`All API targets failed [${attemptSummary}] without response. ` +
		`Check network connectivity and target availability.`
	);
}
