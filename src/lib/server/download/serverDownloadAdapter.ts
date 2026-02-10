/**
 * Server download adapter - wraps core download logic with server-specific fetch handling.
 * This is called DIRECTLY by the worker and returns a buffer + lookup for finalization.
 */

import type { AudioQuality } from '$lib/types';
import type { ApiClient } from '../../core/download/types';
import { downloadTrackWithRetry } from '../../core/download/downloadCore';
import { detectAudioFormat } from '../../utils/audioFormat';
import { 
	API_CONFIG,
	getPrimaryTarget,
	ensureWeightedTargets
} from '$lib/config';
import type { ApiClusterTarget } from '$lib/config';
import { APP_VERSION } from '$lib/version';
import type { TrackLookup } from '$lib/types';
import {
	recordTargetHealthChange,
	recordCircuitBreakerEvent
} from '$lib/observability/downloadMetrics';

/**
 * Server-side fetch that constructs direct upstream URLs with target rotation
 * (losslessAPI.fetch uses fetchWithCORS which creates proxy URLs - unusable server-side)
 */
// Shared circuit breaker state across all server fetches
const targetFailureTimestamps = new Map<string, number>();
const consecutiveFailures = new Map<string, number>();
const TARGET_FAILURE_TTL_MS = 86_400_000; // 1 day
const CIRCUIT_BREAKER_THRESHOLD = 3; // Disable after 3 consecutive failures
const CIRCUIT_BREAKER_TIMEOUT_MS = 60_000; // Re-enable after 60 seconds

function resetCircuitState(): void {
	targetFailureTimestamps.clear();
	consecutiveFailures.clear();
}

async function createServerFetch(): Promise<typeof globalThis.fetch> {
	async function readErrorSnippet(response: Response): Promise<string> {
		try {
			const contentType = response.headers.get('content-type') || '';
			if (/json|text|html/i.test(contentType)) {
				const bodyText = await response.text();
				return bodyText.trim().slice(0, 500);
			}

			// Attempt to decode first 1KB for binary responses
			const buffer = new Uint8Array(await response.arrayBuffer());
			const decoder = new TextDecoder('utf-8', { fatal: false });
			return decoder.decode(buffer.slice(0, 1024)).trim();
		} catch (err) {
			return `Unable to read body (${err instanceof Error ? err.message : String(err)})`;
		}
	}

	function isTargetHealthy(targetName: string): boolean {
		const failureAt = targetFailureTimestamps.get(targetName);
		if (!failureAt) return true;
		return Date.now() - failureAt > TARGET_FAILURE_TTL_MS;
	}

	function markTargetUnhealthy(targetName: string): void {
		targetFailureTimestamps.set(targetName, Date.now());
		
		// Increment consecutive failures for circuit breaker
		const failureCount = (consecutiveFailures.get(targetName) || 0) + 1;
		consecutiveFailures.set(targetName, failureCount);
		
		recordTargetHealthChange(targetName, 'unhealthy', {
			reason: 'Request failed',
			consecutiveFailures: failureCount
		});
		
		if (failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
			console.warn(
				`[CircuitBreaker] Target '${targetName}' has ${failureCount} consecutive failures. ` +
				`Will be skipped for ${CIRCUIT_BREAKER_TIMEOUT_MS}ms.`
			);
			recordCircuitBreakerEvent(targetName, 'open', {
				reason: 'Too many consecutive failures',
				consecutiveFailures: failureCount
			});
		}
	}
	
	function resetConsecutiveFailures(targetName: string): void {
		if (consecutiveFailures.has(targetName)) {
			consecutiveFailures.delete(targetName);
			recordTargetHealthChange(targetName, 'healthy', {
				reason: 'Request succeeded',
				consecutiveFailures: 0
			});
		}
	}
	
	function isTargetCircuitClosed(targetName: string): boolean {
		const failureCount = consecutiveFailures.get(targetName) || 0;
		if (failureCount < CIRCUIT_BREAKER_THRESHOLD) {
			return true; // Circuit is open, allow requests
		}
		
		// Circuit is closed, check if timeout has passed
		const failureAt = targetFailureTimestamps.get(targetName);
		if (!failureAt) return true;
		
		const timeSinceFailure = Date.now() - failureAt;
		if (timeSinceFailure > CIRCUIT_BREAKER_TIMEOUT_MS) {
			// Timeout has passed, reset and allow requests again
			consecutiveFailures.delete(targetName);
			recordCircuitBreakerEvent(targetName, 'reset', {
				reason: 'Timeout expired, attempting recovery',
				consecutiveFailures: 0
			});
			console.log(`[CircuitBreaker] Target '${targetName}' circuit reset, attempting recovery...`);
			return true;
		}
		
		return false; // Circuit still broken, skip this target
	}

	function isCustomTarget(target: ApiClusterTarget): boolean {
		return (
			API_CONFIG.targets.some((t) => t.name === target.name) &&
			!target.baseUrl.includes('tidal.com') &&
			!target.baseUrl.includes('api.tidal.com') &&
			!target.baseUrl.includes('monochrome.tf')
		);
	}

	function buildHeaders(
		options: RequestInit | undefined,
		target?: ApiClusterTarget,
		isCDNSegment: boolean = false
	): Headers {
		const headers = new Headers(options?.headers);
		
		if (isCDNSegment) {
			// CDN segments require browser-like headers to avoid 403s
			headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
			headers.set('Referer', 'https://listen.tidal.com/');
			headers.set('Origin', 'https://listen.tidal.com');
			headers.set('Accept', '*/*');
			headers.set('Accept-Language', 'en-US,en;q=0.9');
			headers.set('Sec-Fetch-Dest', 'empty');
			headers.set('Sec-Fetch-Mode', 'cors');
			headers.set('Sec-Fetch-Site', 'cross-site');
		} else if (target && isCustomTarget(target)) {
			headers.set('X-Client', `BiniLossless/${APP_VERSION}`);
		}
		
		return headers;
	}

	function getTargetForOrigin(origin: string): ApiClusterTarget | undefined {
		return API_CONFIG.targets.find((target) => {
			try {
				return new URL(target.baseUrl).origin === origin;
			} catch {
				return false;
			}
		});
	}

	return async (input: RequestInfo | URL, options?: RequestInit) => {
		const initialUrl =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const mergedOptions =
			input instanceof Request
				? {
						method: input.method,
						headers: input.headers,
						body: input.body as BodyInit | null,
						...options
					}
				: options;
		let finalUrl = initialUrl;

		// If it's a proxy-wrapped URL, extract the actual upstream URL
		if (finalUrl.includes('/api/proxy?url=')) {
			try {
				const urlObj = new URL(finalUrl, 'http://localhost');
				const encoded = urlObj.searchParams.get('url');
				if (encoded) {
					finalUrl = decodeURIComponent(encoded);
					console.log(`[ServerFetch] Decoded proxy URL: ${finalUrl.substring(0, 80)}...`);
				}
			} catch {
				console.warn(`[ServerFetch] Failed to decode proxy URL`);
			}
		}

		// If it's a relative path, construct absolute URL from targets
		if (finalUrl.startsWith('/') && !finalUrl.includes('/api/proxy')) {
			const primaryTarget = getPrimaryTarget('v2');
			finalUrl = `${primaryTarget.baseUrl}${finalUrl}`;
		}

		// Check if this is a CDN segment URL (not an API call)
		// CDN segments: sp-*.audio.tidal.com, sp-*.media.tidal.com, etc
		// API calls: include /api/, /v2/, /v1/, /auth paths
		const isCDNSegmentUrl = finalUrl.startsWith('http') && (
			/audio\.tidal\.com|media\.tidal\.com|cdn\.example\.com/.test(finalUrl) ||
			(!/\/api\/|\/v[0-9]+\/|\/auth|\/album|\/artist|\/track|\/search/.test(new URL(finalUrl).pathname))
		);

		// For CDN segment URLs, just try the URL as-is with no target rotation
		// (segment paths are target-specific and can't be swapped across CDNs)
		if (isCDNSegmentUrl) {
			try {
				const response = await globalThis.fetch(finalUrl, {
					...mergedOptions,
					headers: buildHeaders(mergedOptions, undefined, true)
				});
				if (response.ok) {
					return response;
				}
				// If the segment fails, log it but throw with proper error
				// Let higher level (downloadSegmentedDash) handle per-segment failures
				const statusError = `HTTP ${response.status}`;
				const bodySnippet = await readErrorSnippet(response);
				const logSnippet = bodySnippet ? ` Body: ${bodySnippet}` : '';
				console.warn(`[ServerFetch] CDN segment returned ${statusError}: ${finalUrl.substring(0, 80)}...${logSnippet}`);
				throw new Error(`Failed to fetch CDN segment: ${statusError}`);
			} catch (error) {
				throw error instanceof Error ? error : new Error(String(error));
			}
		}

		// Try each target in order (only for API calls)
		const weightedTargets = ensureWeightedTargets('v2');
		const attemptOrder = [getPrimaryTarget('v2'), ...weightedTargets];
		const uniqueTargets = attemptOrder.filter(
			(target, index, array) => 
				array.findIndex(entry => entry.name === target.name) === index
		);

		const healthyTargets = uniqueTargets.filter(target => isTargetHealthy(target.name));
		const circuitClosedTargets = healthyTargets.filter(target => isTargetCircuitClosed(target.name));
		const targetList = circuitClosedTargets.length > 0 
			? circuitClosedTargets 
			: healthyTargets.length > 0 
				? healthyTargets 
				: uniqueTargets;

		let lastError: Error | null = null;

		for (const target of targetList) {
			try {
				// If URL is already absolute, try to rotate between known targets
				if (finalUrl.startsWith('http')) {
					let targetUrl = finalUrl;
					let targetForHeaders: ApiClusterTarget | undefined = target;
					try {
						const parsed = new URL(finalUrl);
						const originTarget = getTargetForOrigin(parsed.origin);
						if (originTarget) {
							const replaced = new URL(target.baseUrl);
							replaced.pathname = parsed.pathname;
							replaced.search = parsed.search;
							replaced.hash = parsed.hash;
							targetUrl = replaced.toString();
							targetForHeaders = target;
						}
					} catch {
						// Fall back to original absolute URL
						targetForHeaders = undefined;
					}

					const response = await globalThis.fetch(targetUrl, {
						...mergedOptions,
						headers: buildHeaders(mergedOptions, targetForHeaders)
					});
					if (response.ok) {
						resetConsecutiveFailures(target.name);
						return response;
					}
					const bodySnippet = await readErrorSnippet(response);
					markTargetUnhealthy(target.name);
					lastError = new Error(
						bodySnippet
							? `HTTP ${response.status} from ${target.name}: ${bodySnippet}`
							: `HTTP ${response.status} from ${target.name}`
					);
					continue;
				}

				// Otherwise, construct URL using targets
				const upstreamUrl = `${target.baseUrl}${finalUrl.startsWith('/') ? finalUrl : `/${finalUrl}`}`;
				console.log(`[ServerFetch] Trying ${target.name}: ${upstreamUrl.substring(0, 80)}...`);
				
				const response = await globalThis.fetch(upstreamUrl, {
					...mergedOptions,
					headers: buildHeaders(mergedOptions, target)
				});
				if (response.ok) {
					resetConsecutiveFailures(target.name);
					return response;
				}
				const bodySnippet = await readErrorSnippet(response);
				markTargetUnhealthy(target.name);
				lastError = new Error(
					bodySnippet
						? `HTTP ${response.status} from ${target.name}: ${bodySnippet}`
						: `HTTP ${response.status} from ${target.name}`
				);
			} catch (error) {
				markTargetUnhealthy(target.name);
				lastError = error instanceof Error ? error : new Error(String(error));
				console.warn(`[ServerFetch] Error with ${target.name}:`, lastError.message);
			}
		}

		throw lastError || new Error('All targets failed');
	};
}

// Test helpers
export const __test = { createServerFetch, resetCircuitState };

export interface ServerDownloadParams {
	trackId: number;
	quality: AudioQuality;
	albumTitle?: string;
	artistName?: string;
	trackTitle?: string;
	trackNumber?: number;
	coverUrl?: string;
	conflictResolution?: 'overwrite' | 'skip' | 'overwrite_if_different';
	apiClient: ApiClient; // Pass losslessAPI - it has fetchWithCORS with target rotation
	// Note: No fetch parameter - apiClient handles all fetching with proper rotation
}

export interface ServerDownloadResult {
	success: boolean;
	buffer?: Buffer;
	mimeType?: string;
	detectedFormat?: { extension: string; mimeType?: string };
	trackLookup?: TrackLookup;
	receivedBytes?: number;
	totalBytes?: number;
	error?: string;
}

export async function downloadTrackServerSide(
	params: ServerDownloadParams
): Promise<ServerDownloadResult> {
	const {
		trackId,
		quality,
		apiClient // losslessAPI - we'll use it for getTrack() parsing only
	} = params;

	try {
		// Create server-side fetch with target rotation
		const fetchFn = await createServerFetch();

		// Download audio using core logic (fetch-only)
		const result = await downloadTrackWithRetry({
			trackId,
			quality,
			apiClient,
			fetchFn,
			options: {
				skipMetadataEmbedding: true
			}
		});

		const buffer = Buffer.from(result.buffer);
		const detectedFormat = detectAudioFormat(new Uint8Array(buffer));

		// Fetch track metadata for embedding + naming downstream (only after successful download)
		const trackLookup = await apiClient.getTrack(trackId, quality);

		return {
			success: true,
			buffer,
			mimeType: result.mimeType,
			detectedFormat: detectedFormat ?? undefined,
			trackLookup,
			receivedBytes: result.receivedBytes,
			totalBytes: result.totalBytes
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[ServerDownload] Failed to download track ${trackId}:`, errorMsg);
		return {
			success: false,
			error: errorMsg
		};
	}
}
