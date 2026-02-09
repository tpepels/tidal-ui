/**
 * Core download logic - shared between browser and server
 * This is the single source of truth for track downloading
 */

import type {
	ApiClient,
	DownloadOptions,
	DownloadResult,
	FetchFunction
} from './types';
import type { AudioQuality } from '$lib/types';
import { parseManifest } from './manifestParser';
import { downloadSegmentedDash } from './segmentDownloader';
import { 
	recordDownloadStart,
	recordDownloadSuccess,
	recordDownloadFailure
} from '$lib/observability/downloadMetrics';

const MIN_VALID_AUDIO_SIZE = 1000; // 1KB minimum
const MAX_MANIFEST_RETRIES = 3; // Try manifest from different targets

// Cache for in-flight manifest requests to deduplicate concurrent fetches
// Key: trackId-quality, Value: Promise<TrackLookup>
const inflightManifestRequests = new Map<string, Promise<any>>();

/**
 * Exponential backoff: 1s, 2s, 4s between retries
 * Prevents hammering targets on temporary failures
 */
async function delayBeforeRetry(attemptNumber: number): Promise<void> {
	if (attemptNumber <= 0) return;
	const baseDelayMs = 1000; // 1 second
	const delayMs = baseDelayMs * Math.pow(2, attemptNumber - 1);
	console.log(`[DownloadCore] Waiting ${delayMs}ms before retry attempt ${attemptNumber + 1}...`);
	await new Promise(resolve => setTimeout(resolve, delayMs));
}

/**
 * Classify segment download errors to determine if retry is worthwhile
 * Some errors (permissions, region-lock) are permanent and won't be fixed by retrying
 */
function isRetriableSegmentError(error: Error): boolean {
	const msg = error.message.toLowerCase();
	
	// Permanent failures - don't retry these
	const permanentPatterns = [
		// HTTP errors
		/\b403\b/,           // Forbidden (permission denied, region-locked)
		/\b404\b/,           // Not found (manifest was wrong)
		/\b401\b/,           // Unauthorized (auth token invalid)
		/\b400\b/,           // Bad request (invalid parameters)
		
		// URL/parsing errors
		/\binvalid url\b/,   // Malformed URL
		/\bmalformed\b/,     // Malformed response
		/\binvalid hostname\b/, // Invalid hostname
		
		// CORS and security
		/\bcors\b/,          // CORS policy (won't change per target)
		/\bcertificate\b/,   // SSL/TLS certificate issues (won't fix with retry)
		/\bssl/,             // SSL errors
		/\btls/,             // TLS errors
		
		// Proxy errors
		/\bproxy.*error\b/,  // Proxy-specific errors
		
		// Authentication
		/\bunauthorized\b/,  // Authentication failed
		/\btoken.*invalid\b/, // Invalid token
		/\bauth.*fail\b/,    // Authentication failure
	];
	
	if (permanentPatterns.some(pattern => pattern.test(msg))) {
		return false;
	}
	
	// Retriable failures - network issues, timeouts, temporary server errors
	const retriablePatterns = [
		// Server errors (temporary)
		/\b500\b/, /\b502\b/, /\b503\b/, /\b504\b/,  // Server errors
		/\b429\b/,                                     // Rate limit (might recover soon)
		/\b429.*retry\b/,                              // Rate limit with retry info
		
		// Timeouts
		/\btimeout\b/,                                 // Timeouts
		/\beabrupt.*close\b/,                          // Connection closed unexpectedly
		
		// Connection issues
		/\bconnection\b/,                              // Generic connection issues
		/\bECONNRESET\b/, /\bECONNREFUSED\b/,         // Network errors
		/\bEADDR.*NOTFOUND\b/, /\bENOTFOUND\b/,       // DNS resolution failures
		/\bEGETADDRINFO\b/,                            // Address lookup failures
		/\bno such host\b/,                            // DNS resolution (might recover)
		
		// Incomplete requests
		/\bincomplete\b/,    // Incomplete response
		/\bunexpected.*end\b/, // Unexpected connection end
		/\breset.*peer\b/,   // Connection reset by peer
		
		// Request errors
		/\bfetch.*error\b/,  // Generic fetch errors
		/\bnetwork.*error\b/, // Network errors
	];
	
	return retriablePatterns.some(pattern => pattern.test(msg));
}

export async function downloadTrackCore(params: {
	trackId: number;
	quality: AudioQuality;
	apiClient: ApiClient;
	fetchFn: FetchFunction;
	options?: DownloadOptions;
	skipTarget?: string;
}): Promise<DownloadResult> {
	const { trackId, quality, apiClient, fetchFn, options, skipTarget } = params;

	// Get track metadata from API (with deduplication for concurrent requests)
	const cacheKey = `${trackId}-${quality}-${skipTarget || 'none'}`;
	let trackLookupPromise = inflightManifestRequests.get(cacheKey);
	
	if (!trackLookupPromise) {
		// No in-flight request for this trackId/quality combo - create one
		trackLookupPromise = apiClient.getTrack(trackId, quality, { skipTarget });
		inflightManifestRequests.set(cacheKey, trackLookupPromise);
		
		// Clean up cache after request completes
		trackLookupPromise.finally(() => {
			inflightManifestRequests.delete(cacheKey);
		});
	} else {
		console.log('[DownloadCore] Using cached manifest request for track', trackId);
	}
	
	const trackLookup = await trackLookupPromise;

	let result: DownloadResult | null = null;

	// Try originalTrackUrl first (pre-signed URL)
	if (trackLookup.originalTrackUrl) {
		try {
			const response = await fetchFn(trackLookup.originalTrackUrl, { signal: options?.signal });
			if (response.ok) {
				result = await downloadFromResponse(response, options);
			} else {
				console.warn('[DownloadCore] OriginalTrackUrl failed, falling back to manifest', {
					status: response.status
				});
			}
		} catch (error) {
			console.warn('[DownloadCore] OriginalTrackUrl fetch error, falling back:', error);
		}
	}

	// Fallback to manifest parsing (with retries for segment failures)
	if (!result) {
		let manifestRetries = 0;
		let lastSegmentError: Error | null = null;

		while (manifestRetries < MAX_MANIFEST_RETRIES && !result) {
			try {
				const manifest = trackLookup.info.manifest;
				const parsed = parseManifest(manifest);

				if (parsed.type === 'segmented-dash' && parsed.initializationUrl && parsed.segmentUrls) {
					// Multi-segment DASH download
					console.log('[DownloadCore] Downloading segmented DASH:', {
						segments: parsed.segmentUrls.length + 1,
						codec: parsed.codec,
						attempt: manifestRetries + 1
					});
					result = await downloadSegmentedDash(
						parsed.initializationUrl,
						parsed.segmentUrls,
						fetchFn,
						options
					);
				} else if (parsed.type === 'single-url' && parsed.streamUrl) {
					// Single URL download
					console.log('[DownloadCore] Downloading from single URL');
					const response = await fetchFn(parsed.streamUrl, { signal: options?.signal });
					if (!response.ok) {
						throw new Error(`Failed to fetch audio stream (status ${response.status})`);
					}
					result = await downloadFromResponse(response, options);
				} else {
					throw new Error(
						`Could not extract download URL from manifest (type: ${parsed.type})`
					);
				}
			} catch (error) {
				lastSegmentError = error instanceof Error ? error : new Error(String(error));
				manifestRetries++;
				
				// Don't retry permanent failures (403, 404, CORS, etc)
				const isRetriable = isRetriableSegmentError(lastSegmentError);
				
				if (isRetriable && manifestRetries < MAX_MANIFEST_RETRIES) {
					console.log('[DownloadCore] Segment download failed (retriable), retrying with fresh manifest...', {
						error: lastSegmentError.message,
						attempt: manifestRetries + 1
					});
					// Wait before retrying to avoid hammering targets
					await delayBeforeRetry(manifestRetries);
					
					// Refetch manifest to potentially get URLs from different target
					try {
						const freshLookup = await apiClient.getTrack(trackId, quality, { skipTarget: 'previous' });
						trackLookup.info.manifest = freshLookup.info.manifest;
					} catch (refetchErr) {
						console.warn('[DownloadCore] Failed to refetch manifest:', refetchErr);
						// Continue anyway with same manifest
					}
				} else if (!isRetriable) {
					console.warn('[DownloadCore] Segment download failed (permanent error), not retrying:', lastSegmentError.message);
				}
			}
		}

		if (!result && lastSegmentError) {
			throw lastSegmentError;
		}
	}

	// Validate size
	if (result && result.receivedBytes < MIN_VALID_AUDIO_SIZE) {
		throw new Error(
			`Downloaded file suspiciously small (${result.receivedBytes} bytes). ` +
			`This likely indicates a DASH initialization segment instead of the full audio file.`
		);
	}

	return result || { buffer: new ArrayBuffer(0), receivedBytes: 0 };
}

async function downloadFromResponse(
	response: Response,
	options?: DownloadOptions
): Promise<DownloadResult> {
	const totalHeader = Number(response.headers.get('Content-Length') ?? '0');
	const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined;
	const contentType = response.headers.get('Content-Type');

	// Stream download with progress
	if (response.body && typeof response.body.getReader === 'function') {
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let receivedBytes = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				receivedBytes += value.byteLength;
				chunks.push(value);
				options?.onProgress?.({
					stage: 'downloading',
					receivedBytes,
					totalBytes
				});
			}
		}

		// Merge chunks
		const totalSize = chunks.reduce((total, current) => total + current.byteLength, 0);
		const merged = new Uint8Array(totalSize);
		let offset = 0;
		for (const chunk of chunks) {
			merged.set(chunk, offset);
			offset += chunk.byteLength;
		}

		return {
			buffer: merged.buffer,
			mimeType: contentType ?? undefined,
			receivedBytes,
			totalBytes
		};
	}

	// Fallback: download as single chunk
	const buffer = await response.arrayBuffer();
	const receivedBytes = buffer.byteLength;

	options?.onProgress?.({
		stage: 'downloading',
		receivedBytes,
		totalBytes: receivedBytes
	});

	return {
		buffer,
		mimeType: contentType ?? undefined,
		receivedBytes,
		totalBytes: receivedBytes
	};
}

/**
 * Wrapper for downloadTrackCore with retry logic
 * Provides track-level resilience (complements manifest-level retries)
 * Matches main branch pattern for consistency
 */
export async function downloadTrackWithRetry(
	params: Parameters<typeof downloadTrackCore>[0],
	maxAttempts: number = 3
): Promise<DownloadResult> {
	let lastError: Error | null = null;
	
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			// Record download start on first attempt
			if (attempt === 1) {
				const targetName = params.skipTarget ? `(skipping: ${params.skipTarget})` : 'auto';
				recordDownloadStart(params.trackId, params.quality, targetName, attempt);
			}
			
			console.log(`[DownloadTrack] Attempt ${attempt}/${maxAttempts} for track ${params.trackId}`);
			const startTime = Date.now();
			const result = await downloadTrackCore(params);
			const durationMs = Date.now() - startTime;
			
			// Record success
			const targetName = params.skipTarget ? `(skipping: ${params.skipTarget})` : 'auto';
			recordDownloadSuccess(params.trackId, params.quality, targetName, durationMs, result.receivedBytes, attempt);
			
			return result;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			
			// Check if the error is worth retrying
			const errorMsg = lastError.message.toLowerCase();
			const isRetriable = !errorMsg.includes('forbidden') && 
				!errorMsg.includes('unauthorized') &&
				!errorMsg.includes('not found') &&
				!errorMsg.includes('unavailable');
			
			// Record failure attempt
			const targetName = params.skipTarget ? `(skipping: ${params.skipTarget})` : 'auto';
			recordDownloadFailure(
				params.trackId,
				params.quality,
				lastError.message,
				{
					target: targetName,
					attemptNumber: attempt,
					isRetriable,
					errorType: error instanceof Error 
						? error.constructor.name 
						: typeof error
				}
			);
			
			if (attempt < maxAttempts && isRetriable) {
				console.warn(`[DownloadTrack] Attempt ${attempt} failed, retrying...`, lastError.message);
				await delayBeforeRetry(attempt);
				continue;
			}
			
			throw lastError;
		}
	}
	
	throw lastError || new Error('Track download failed after all retries');
}
