/**
 * Manifest parser - handles DASH XML manifests and extracts stream URLs
 */

import { isSegmentedDashManifest, parseJsonSafely } from '$lib/api/manifest';
import type { ManifestParseResult, SegmentTemplate } from './types';

export function decodeBase64Manifest(manifest: string): string {
	if (typeof manifest !== 'string') return '';
	const trimmed = manifest.trim();
	if (!trimmed) return '';
	try {
		// Support URL-safe base64 and missing padding
		const normalized = (() => {
			let value = trimmed.replace(/-/g, '+').replace(/_/g, '/');
			const pad = value.length % 4;
			if (pad === 2) value += '==';
			if (pad === 3) value += '=';
			return value;
		})();
		const decoded = atob(normalized);
		return decoded || trimmed;
	} catch {
		return trimmed;
	}
}

function isValidMediaUrl(url: string): boolean {
	if (!url || typeof url !== 'string') return false;
	const trimmed = url.trim();
	if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false;
	// Exclude schema URLs
	if (/w3\.org|xmlsoap\.org|schemas\.android\.com/i.test(trimmed)) return false;
	return true;
}

function unescapeXmlEntities(text: string): string {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

export function extractStreamUrlFromManifest(manifest: string): string | null {
	try {
		let decoded = decodeBase64Manifest(manifest);
		const trimmed = decoded.trim();

		// Plain URL
		if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && isValidMediaUrl(decoded)) {
			return unescapeXmlEntities(decoded);
		}

		// JSON format
		const parsed = parseJsonSafely<{ urls?: unknown; url?: unknown; manifest?: unknown }>(decoded);
		if (parsed) {
			if (Array.isArray(parsed.urls) && parsed.urls.length > 0) {
				const candidate = parsed.urls.find((value) => typeof value === 'string');
				if (candidate) return unescapeXmlEntities(candidate);
			}
			if (typeof parsed.url === 'string') {
				return unescapeXmlEntities(parsed.url);
			}
			if (typeof parsed.manifest === 'string') {
				decoded = decodeBase64Manifest(parsed.manifest);
				const nestedTrimmed = decoded.trim();
				if (
					!nestedTrimmed.startsWith('{') &&
					!nestedTrimmed.startsWith('[') &&
					isValidMediaUrl(decoded)
				) {
					return unescapeXmlEntities(decoded);
				}
			}
		}

		// If this is a segmented DASH manifest, don't extract a URL
		if (isSegmentedDashManifest(decoded)) {
			return null;
		}

		// Try to extract BaseURL from DASH XML for single-segment files
		const baseUrlMatch = decoded.match(/<BaseURL>([^<]+)<\/BaseURL>/);
		if (baseUrlMatch) {
			const url = baseUrlMatch[1].trim();
			if (isValidMediaUrl(url)) {
				return unescapeXmlEntities(url);
			}
		}

		// Match all URLs and filter out schema/namespace URLs and segment URLs
		const urlRegex = /https?:\/\/[\w\-.~:?#[\]@!$&'()*+,;=%/]+/g;
		let match: RegExpExecArray | null;
		while ((match = urlRegex.exec(decoded)) !== null) {
			const url = match[0];
			// Skip segment template URLs and initialization segments
			if (url.includes('$Number$')) continue;
			if (/\/\d+\.mp4/.test(url)) continue; // Skip segment files like /0.mp4, /1.mp4, etc.
			if (isValidMediaUrl(url)) {
				return unescapeXmlEntities(url);
			}
		}

		return null;
	} catch (error) {
		console.error('[ManifestParser] Failed to decode manifest:', error);
		return null;
	}
}

export function parseManifest(manifest: string): ManifestParseResult {
	const decoded = decodeBase64Manifest(manifest);
	const trimmed = decoded.trim();

	// Check if segmented DASH
	if (isSegmentedDashManifest(decoded)) {
		const template = parseMpdSegmentTemplate(decoded);
		if (template) {
			const segments = buildMpdSegmentUrls(template);
			if (segments) {
				return {
					type: 'segmented-dash',
					initializationUrl: segments.initializationUrl,
					segmentUrls: segments.segmentUrls,
					baseUrl: template.baseUrl,
					codec: template.codec
				};
			}
		}
		return { type: 'unknown' };
	}

	// Try to extract a single stream URL
	const streamUrl = extractStreamUrlFromManifest(manifest);
	if (streamUrl) {
		return {
			type: 'single-url',
			streamUrl
		};
	}

	return { type: 'unknown' };
}

export function parseMpdSegmentTemplate(manifestText: string): (SegmentTemplate & {
	baseUrl?: string;
	codec?: string;
}) | null {
	const trimmed = manifestText.trim();
	if (!/<SegmentTemplate/i.test(trimmed)) return null;

	const parseWithDom = () => {
		try {
			if (typeof DOMParser === 'undefined') return null;

			const parser = new DOMParser();
			const doc = parser.parseFromString(trimmed, 'application/xml');
			const template = doc.getElementsByTagName('SegmentTemplate')[0];
			if (!template) return null;

			const baseUrlElement = doc.getElementsByTagName('BaseURL')[0];
			const baseUrl = baseUrlElement?.textContent?.trim();

			const representation = doc.getElementsByTagName('Representation')[0];
			const codec = representation?.getAttribute('codecs')?.trim();

			if (!template) return null;

			const initializationUrl = template.getAttribute('initialization')?.trim();
			const mediaUrlTemplate = template.getAttribute('media')?.trim();
			if (!initializationUrl || !mediaUrlTemplate) return null;

			const startNumber = Number.parseInt(template.getAttribute('startNumber') ?? '1', 10);
			const timelineParent = template.getElementsByTagName('SegmentTimeline')[0];
			const segmentTimeline: Array<{ duration: number; repeat: number }> = [];
			if (timelineParent) {
				const segments = timelineParent.getElementsByTagName('S');
				for (const seg of Array.from(segments)) {
					const duration = Number.parseInt(seg.getAttribute('d') ?? '0', 10);
					if (!Number.isFinite(duration) || duration <= 0) continue;
					const repeat = Number.parseInt(seg.getAttribute('r') ?? '0', 10);
					segmentTimeline.push({ duration, repeat: Number.isFinite(repeat) ? repeat : 0 });
				}
			}

			return {
				initializationUrl,
				mediaUrlTemplate,
				startNumber: Number.isFinite(startNumber) && startNumber > 0 ? startNumber : 1,
				segmentTimeline,
				baseUrl,
				codec
			};
		} catch (error) {
			console.debug('[ManifestParser] Failed to parse MPD with DOMParser', error);
			return null;
		}
	};

	const parseWithRegex = () => {
		const initializationUrl = /initialization="([^"]+)"/i.exec(trimmed)?.[1]?.trim();
		const mediaUrlTemplate = /media="([^"]+)"/i.exec(trimmed)?.[1]?.trim();
		if (!initializationUrl || !mediaUrlTemplate) return null;

		const startNumberMatch = /startNumber="(\d+)"/i.exec(trimmed);
		const startNumber = startNumberMatch ? Number.parseInt(startNumberMatch[1]!, 10) : 1;

		const segmentTimeline: Array<{ duration: number; repeat: number }> = [];
		const timelineRegex = /<S[^>]*\sd="(\d+)"(?:[^>]*\sr="(-?\d+)")?[^>]*\/?>/gi;
		let match: RegExpExecArray | null;
		while ((match = timelineRegex.exec(trimmed)) !== null) {
			const duration = Number.parseInt(match[1]!, 10);
			const repeat = match[2] ? Number.parseInt(match[2], 10) : 0;
			if (Number.isFinite(duration) && duration > 0) {
				segmentTimeline.push({ duration, repeat: Number.isFinite(repeat) ? repeat : 0 });
			}
		}

		// Extract BaseURL with regex
		const baseUrlMatch = /<BaseURL>([^<]+)<\/BaseURL>/i.exec(trimmed);
		const baseUrl = baseUrlMatch?.[1]?.trim();

		return {
			initializationUrl,
			mediaUrlTemplate,
			startNumber: Number.isFinite(startNumber) && startNumber > 0 ? startNumber : 1,
			segmentTimeline,
			baseUrl
		};
	};

	return parseWithDom() ?? parseWithRegex();
}

function buildMpdSegmentUrls(
	template: SegmentTemplate & { baseUrl?: string; codec?: string }
): { initializationUrl: string; segmentUrls: string[] } | null {
	const resolveUrl = (url: string): string => {
		if (/^https?:\/\//i.test(url)) return url;
		if (template.baseUrl) {
			try {
				return new URL(url, template.baseUrl).toString();
			} catch {
				return `${template.baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
			}
		}
		return url;
	};

	const initializationUrl = resolveUrl(template.initializationUrl);
	const segmentUrls: string[] = [];
	let segmentNumber = template.startNumber;
	const timeline =
		template.segmentTimeline.length > 0 ? template.segmentTimeline : [{ duration: 0, repeat: 0 }];

	for (const entry of timeline) {
		const repeat = Number.isFinite(entry.repeat) ? entry.repeat : 0;
		const count = Math.max(1, repeat + 1);
		for (let i = 0; i < count; i += 1) {
			const url = template.mediaUrlTemplate.replace('$Number$', `${segmentNumber}`);
			segmentUrls.push(resolveUrl(url));
			segmentNumber += 1;
		}
	}

	return { initializationUrl, segmentUrls };
}
