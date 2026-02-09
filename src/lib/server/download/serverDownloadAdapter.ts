/**
 * Server download adapter - wraps core download logic with server-specific filesystem operations
 * This is called DIRECTLY by the worker - no HTTP involved
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import type { AudioQuality } from '$lib/types';
import type { ApiClient } from '../../core/download/types';
import { downloadTrackCore } from '../../core/download/downloadCore';
import { detectAudioFormat } from '../../utils/audioFormat';
import { 
	API_CONFIG,
	getPrimaryTarget,
	ensureWeightedTargets
} from '$lib/config';
import type { ApiClusterTarget } from '$lib/config';
import { APP_VERSION } from '$lib/version';
import { 
	getDownloadDir, 
	sanitizePath, 
	ensureDir,
	resolveFileConflict,
	buildServerFilename,
	getServerExtension,
	downloadCoverToDir
} from '../../../routes/api/download-track/_shared';
import {
	recordTargetHealthChange,
	recordCircuitBreakerEvent
} from '$lib/observability/downloadMetrics';

async function writeBasicMetadata(
	filePath: string,
	fields: { title?: string; artist?: string; album?: string; trackNumber?: number; coverPath?: string }
): Promise<void> {
	const hasFields = fields.title || fields.artist || fields.album || fields.trackNumber;
	if (!hasFields) return;

	const tmpPath = `${filePath}.tmp`;
	const args = ['-y', '-i', filePath, '-map', '0:a'];

	let hasCover = false;
	if (fields.coverPath) {
		try {
			await fs.access(fields.coverPath);
			hasCover = true;
			args.push('-i', fields.coverPath);
		} catch {
			hasCover = false;
		}
	}

	args.push('-c', 'copy');

	if (hasCover) {
		args.push('-map', '1', '-disposition:v', 'attached_pic', '-metadata:s:v', 'title=Cover', '-metadata:s:v', 'comment=Cover');
	}

	if (fields.title) args.push('-metadata', `title=${fields.title}`);
	if (fields.artist) args.push('-metadata', `artist=${fields.artist}`);
	if (fields.album) args.push('-metadata', `album=${fields.album}`);
	if (fields.trackNumber) args.push('-metadata', `track=${fields.trackNumber}`);

	args.push(tmpPath);

	await new Promise<void>((resolve, reject) => {
		const child = spawn('ffmpeg', args, { stdio: 'ignore' });
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ffmpeg exited with code ${code}`));
			}
		});
	});

	await fs.rename(tmpPath, filePath);
}

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

	return async (url: string, options?: RequestInit) => {
		let finalUrl = url;

		// If it's a proxy-wrapped URL, extract the actual upstream URL
		if (finalUrl.includes('/api/proxy?url=')) {
			try {
				const urlObj = new URL(finalUrl, 'http://localhost');
				const encoded = urlObj.searchParams.get('url');
				if (encoded) {
					finalUrl = decodeURIComponent(encoded);
					console.log(`[ServerFetch] Decoded proxy URL: ${finalUrl.substring(0, 80)}...`);
				}
			} catch (e) {
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
					...options,
					headers: buildHeaders(options, undefined, true)
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
					let targetForHeaders = target;
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
						...options,
						headers: buildHeaders(options, targetForHeaders)
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
					...options,
					headers: buildHeaders(options, target)
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
	filepath?: string;
	filename?: string;
	action?: 'overwrite' | 'skip' | 'rename';
	error?: string;
	coverDownloaded?: boolean;
}

export async function downloadTrackServerSide(
	params: ServerDownloadParams
): Promise<ServerDownloadResult> {
	const {
		trackId,
		quality,
		albumTitle,
		artistName,
		trackTitle,
		trackNumber,
		coverUrl,
		conflictResolution = 'overwrite',
		apiClient // losslessAPI - we'll use it for getTrack() parsing only
	} = params;

	try {
		// Fetch track metadata first so we can reuse tags without double-fetching later
		const trackLookup = await apiClient.getTrack(trackId, quality);
		const lookupTrackNumber = Number(trackLookup.track.trackNumber) || undefined;
		const lookupAlbumTitle = trackLookup.track.album?.title;
		const lookupArtistName = trackLookup.track.artist?.name;
		const lookupCoverId = trackLookup.track.album?.cover;
		const effectiveAlbumTitle = albumTitle || lookupAlbumTitle;
		const effectiveArtistName = artistName || lookupArtistName;
		let effectiveCoverUrl = coverUrl;
		if (!effectiveCoverUrl && lookupCoverId) {
			effectiveCoverUrl = `https://resources.tidal.com/images/${lookupCoverId.replace(/-/g, '/')}/1280x1280.jpg`;
		}

		// Create server-side fetch with target rotation
		// This replaces losslessAPI.fetch which constructs proxy URLs
		const fetchFn = await createServerFetch();
		
		// Download audio using core logic
		const result = await downloadTrackCore({
			trackId,
			quality,
			apiClient, // Uses apiClient.getTrack() for response parsing (properly tested)
			fetchFn,   // Uses our server fetch that constructs direct upstream URLs with target rotation
			options: {
				skipMetadataEmbedding: true // Server-side doesn't embed metadata yet
			}
		});

		console.log(`[ServerDownload] Downloaded ${result.receivedBytes} bytes for track ${trackId}`);

		// Convert to Buffer
		const buffer = Buffer.from(result.buffer);

		// Detect format and determine extension
		const detectedFormat = detectAudioFormat(new Uint8Array(buffer));
		const ext = getServerExtension(quality, detectedFormat);

		// Build filename with track number for ordering
		const filename = buildServerFilename(
			effectiveArtistName,
			trackTitle,
			trackId,
			ext,
			trackLookup,
			trackNumber ?? lookupTrackNumber
		);

		// Determine directory structure
		const baseDir = getDownloadDir();		const artistDir = sanitizePath(effectiveArtistName || 'Unknown Artist');
		const albumDir = sanitizePath(effectiveAlbumTitle || 'Unknown Album');
		const targetDir = path.join(baseDir, artistDir, albumDir);
		await ensureDir(targetDir);

		const initialFilepath = path.join(targetDir, filename);

		// Handle file conflicts
		const { finalPath, action } = await resolveFileConflict(
			initialFilepath,
			conflictResolution,
			buffer.length,
			undefined // No checksum validation for now
		);

		if (action === 'skip') {
			const finalFilename = path.basename(finalPath);
			return {
				success: true,
				filepath: finalPath,
				filename: finalFilename,
				action,
				coverDownloaded: false
			};
		}

		// Write file to disk
		await fs.writeFile(finalPath, buffer);

		// Download cover art if requested (before metadata so we can embed it)
		let coverDownloaded = false;
		let embeddedCoverPath: string | undefined;
		if (effectiveCoverUrl) {
			try {
				coverDownloaded = await downloadCoverToDir(effectiveCoverUrl, targetDir);
				if (coverDownloaded) {
					embeddedCoverPath = path.join(targetDir, 'cover.jpg');
					console.log(`[ServerDownload] Cover art downloaded`);
				}
			} catch (coverErr) {
				console.warn(`[ServerDownload] Cover download failed:`, coverErr);
			}
		}

		// Embed basic metadata (best-effort)
		try {
			await writeBasicMetadata(finalPath, {
				title: trackTitle,
				artist: effectiveArtistName,
				album: effectiveAlbumTitle,
				trackNumber: trackNumber ?? lookupTrackNumber,
				coverPath: embeddedCoverPath
			});
		} catch (metaErr) {
			console.warn('[ServerDownload] Metadata write skipped:', metaErr);
		}
		console.log(`[ServerDownload] Saved to: ${finalPath}`);

		const finalFilename = path.basename(finalPath);
		return {
			success: true,
			filepath: finalPath,
			filename: finalFilename,
			action,
			coverDownloaded
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
