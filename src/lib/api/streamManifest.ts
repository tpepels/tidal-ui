import {
	extractUrlsFromDashJsonPayload,
	isDashManifestPayload,
	isJsonContentType,
	isSegmentedDashManifest,
	isXmlContentType,
	parseJsonSafely
} from './manifest';
import type { DashManifestResult } from '../apiClient';

export type MpdSegmentTemplate = {
	initializationUrl: string;
	mediaUrlTemplate: string;
	startNumber: number;
	segmentTimeline: Array<{ duration: number; repeat: number }>;
	baseUrl?: string;
	codec?: string;
	/** Fixed segment duration in timescale units (from SegmentTemplate @duration attribute) */
	segmentDuration?: number;
	/** Timescale for segmentDuration (from SegmentTemplate @timescale attribute) */
	timescale?: number;
	/** Total presentation duration in seconds (from MPD @mediaPresentationDuration) */
	mediaPresentationDuration?: number;
};

function parseISO8601DurationToSeconds(duration: string): number | null {
	const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(duration);
	if (!match) return null;
	const hours = parseFloat(match[1] ?? '0') || 0;
	const minutes = parseFloat(match[2] ?? '0') || 0;
	const seconds = parseFloat(match[3] ?? '0') || 0;
	const total = hours * 3600 + minutes * 60 + seconds;
	return total > 0 ? total : null;
}

export function decodeBase64Manifest(manifest: string): string {
	if (typeof manifest !== 'string') return '';
	const trimmed = manifest.trim();
	if (!trimmed) return '';
	try {
		// Support URL-safe base64 and missing padding.
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

export function isValidMediaUrl(url: string): boolean {
	if (!url) return false;
	const normalized = url.toLowerCase();
	if (normalized.includes('.m3u8') || normalized.includes('.m3u')) return false;
	if (normalized.includes('w3.org')) return false;
	if (normalized.includes('xmlschema')) return false;
	if (normalized.includes('xmlns')) return false;
	if (
		normalized.includes('.flac') ||
		normalized.includes('.mp4') ||
		normalized.includes('.m4a') ||
		normalized.includes('.aac') ||
		normalized.includes('token=') ||
		normalized.includes('/audio/')
	) {
		return true;
	}
	if (/\/[^/]+\.[a-z0-9]{2,5}(\?|$)/i.test(url)) return true;
	if (/^[a-z0-9_-]+\//i.test(url)) return true;
	if (/\/[a-z0-9_-]+$/i.test(url)) return true;
	return false;
}

export function parseFlacUrlFromMpd(manifestText: string): string | null {
	const trimmed = manifestText.trim();
	if (!trimmed) return null;

	const scoreUrl = (url: string | undefined | null): number => {
		if (!url) return -1;
		const normalized = url.toLowerCase();
		let score = 0;
		if (normalized.includes('flac')) score += 3;
		if (normalized.includes('hires')) score += 1;
		if (normalized.endsWith('.flac')) score += 4;
		if (normalized.includes('token=')) score += 1;
		return score;
	};

	const pickBest = (urls: Array<string | undefined | null>): string | null => {
		const candidates = urls
			.map((url) => (typeof url === 'string' ? url.trim() : ''))
			.filter((url) => url.length > 0 && isValidMediaUrl(url));
		if (candidates.length === 0) return null;
		return candidates.sort((a, b) => scoreUrl(b) - scoreUrl(a))[0] ?? null;
	};

	if (typeof DOMParser !== 'undefined') {
		try {
			const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
			const baseUrls = Array.from(doc.getElementsByTagName('BaseURL')).map(
				(node) => node.textContent?.trim() ?? ''
			);
			if (baseUrls.length > 0) {
				const best = pickBest(baseUrls);
				if (best) return best;
			}

			const representations = Array.from(doc.getElementsByTagName('Representation'));
			for (const representation of representations) {
				const codecs = representation.getAttribute('codecs')?.toLowerCase() ?? '';
				const base = Array.from(representation.getElementsByTagName('BaseURL')).map(
					(node) => node.textContent?.trim() ?? ''
				);
				if (base.length > 0 && codecs.includes('flac')) {
					const best = pickBest(base);
					if (best) return best;
				}
			}
		} catch (error) {
			console.debug('Failed to parse MPD manifest via DOMParser', error);
		}
	}

	const baseUrlMatch = trimmed.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i);
	if (baseUrlMatch?.[1]) {
		const candidate = baseUrlMatch[1].trim();
		if (isValidMediaUrl(candidate)) {
			return candidate;
		}
	}

	return null;
}

export function parseMpdSegmentTemplate(manifestText: string): MpdSegmentTemplate | null {
	const trimmed = manifestText.trim();
	if (!trimmed) return null;

	const parseWithDom = () => {
		if (typeof DOMParser === 'undefined') return null;
		try {
			const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
			const rawBaseUrl = doc.getElementsByTagName('BaseURL')[0]?.textContent?.trim();
			const baseUrl = rawBaseUrl && isValidMediaUrl(rawBaseUrl) ? rawBaseUrl : undefined;

			let template: Element | null = null;
			let codec: string | undefined;

			const representations = Array.from(doc.getElementsByTagName('Representation'));
			for (const representation of representations) {
				const candidateTemplate = representation.getElementsByTagName('SegmentTemplate')[0];
				if (!candidateTemplate) continue;
				const codecsAttr = representation.getAttribute('codecs')?.toLowerCase() ?? '';
				if (!template || codecsAttr.includes('flac')) {
					template = candidateTemplate;
					codec = codecsAttr || undefined;
					if (codecsAttr.includes('flac')) break;
				}
			}

			if (!template) {
				template = doc.getElementsByTagName('SegmentTemplate')[0] ?? null;
			}
			if (!template) return null;

			const initializationUrl = template.getAttribute('initialization')?.trim();
			const mediaUrlTemplate = template.getAttribute('media')?.trim();
			if (!initializationUrl || !mediaUrlTemplate) return null;

			const startNumber = Number.parseInt(template.getAttribute('startNumber') ?? '1', 10);
			const timelineParent = template.getElementsByTagName('SegmentTimeline')[0];
			const segmentTimeline: Array<{ duration: number; repeat: number }> = [];
			if (timelineParent) {
				const segments = timelineParent.getElementsByTagName('S');
				for (const segment of Array.from(segments)) {
					const duration = Number.parseInt(segment.getAttribute('d') ?? '0', 10);
					if (!Number.isFinite(duration) || duration <= 0) continue;
					const repeat = Number.parseInt(segment.getAttribute('r') ?? '0', 10);
					segmentTimeline.push({ duration, repeat: Number.isFinite(repeat) ? repeat : 0 });
				}
			}

			const rawSegmentDuration = template.getAttribute('duration');
			const rawTimescale = template.getAttribute('timescale');
			const segmentDuration = rawSegmentDuration ? Number.parseInt(rawSegmentDuration, 10) : undefined;
			const timescale = rawTimescale ? Number.parseInt(rawTimescale, 10) : undefined;
			const mpdDurationStr = doc.documentElement?.getAttribute('mediaPresentationDuration');
			const mediaPresentationDuration = mpdDurationStr
				? (parseISO8601DurationToSeconds(mpdDurationStr) ?? undefined)
				: undefined;

			return {
				initializationUrl,
				mediaUrlTemplate,
				startNumber: Number.isFinite(startNumber) && startNumber > 0 ? startNumber : 1,
				segmentTimeline,
				segmentDuration,
				timescale,
				mediaPresentationDuration,
				baseUrl,
				codec
			};
		} catch (error) {
			console.debug('Failed to parse MPD manifest with DOMParser', error);
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

		return {
			initializationUrl,
			mediaUrlTemplate,
			startNumber: Number.isFinite(startNumber) && startNumber > 0 ? startNumber : 1,
			segmentTimeline,
			segmentDuration: (() => {
				const templateAttrMatch = /<SegmentTemplate([^>]*)(?:\/|>)/i.exec(trimmed);
				const templateAttrs = templateAttrMatch?.[1] ?? '';
				const m = /\bduration="(\d+)"/i.exec(templateAttrs);
				return m ? Number.parseInt(m[1]!, 10) : undefined;
			})(),
			timescale: (() => {
				const templateAttrMatch = /<SegmentTemplate([^>]*)(?:\/|>)/i.exec(trimmed);
				const templateAttrs = templateAttrMatch?.[1] ?? '';
				const m = /\btimescale="(\d+)"/i.exec(templateAttrs);
				return m ? Number.parseInt(m[1]!, 10) : undefined;
			})(),
			mediaPresentationDuration: (() => {
				const m = /\bmediaPresentationDuration="([^"]+)"/i.exec(trimmed);
				return m ? (parseISO8601DurationToSeconds(m[1]!) ?? undefined) : undefined;
			})()
		};
	};

	return parseWithDom() ?? parseWithRegex();
}

export function buildMpdSegmentUrls(
	template: MpdSegmentTemplate | null
): { initializationUrl: string; segmentUrls: string[] } | null {
	if (!template) return null;

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

	if (template.segmentTimeline.length > 0) {
		for (const entry of template.segmentTimeline) {
			const repeat = Number.isFinite(entry.repeat) ? entry.repeat : 0;
			const count = Math.max(1, repeat + 1);
			for (let i = 0; i < count; i += 1) {
				const url = template.mediaUrlTemplate.replace('$Number$', `${segmentNumber}`);
				segmentUrls.push(resolveUrl(url));
				segmentNumber += 1;
			}
		}
	} else if (template.segmentDuration && template.timescale && template.mediaPresentationDuration) {
		const numSegments = Math.ceil(
			(template.mediaPresentationDuration * template.timescale) / template.segmentDuration
		);
		for (let i = 0; i < numSegments; i += 1) {
			const url = template.mediaUrlTemplate.replace('$Number$', `${segmentNumber}`);
			segmentUrls.push(resolveUrl(url));
			segmentNumber += 1;
		}
	} else {
		// Fallback: generate at least one segment
		const url = template.mediaUrlTemplate.replace('$Number$', `${segmentNumber}`);
		segmentUrls.push(resolveUrl(url));
	}

	return { initializationUrl, segmentUrls };
}

export function extractStreamUrlFromManifest(manifest: string): string | null {
	try {
		let decoded = decodeBase64Manifest(manifest);
		const trimmed = decoded.trim();
		if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && isValidMediaUrl(decoded)) {
			return decoded;
		}
		const parsed = parseJsonSafely<{ urls?: unknown; url?: unknown; manifest?: unknown }>(decoded);
		if (parsed) {
			if (Array.isArray(parsed.urls) && parsed.urls.length > 0) {
				const candidate = parsed.urls.find((value) => typeof value === 'string');
				if (candidate) return candidate;
			}
			if (typeof parsed.url === 'string') {
				return parsed.url;
			}
			if (typeof parsed.manifest === 'string') {
				decoded = decodeBase64Manifest(parsed.manifest);
				const nestedTrimmed = decoded.trim();
				if (!nestedTrimmed.startsWith('{') && !nestedTrimmed.startsWith('[') && isValidMediaUrl(decoded)) {
					return decoded;
				}
			}
		}

		if (isSegmentedDashManifest(decoded)) {
			return null;
		}

		const mpdUrl = parseFlacUrlFromMpd(decoded);
		if (mpdUrl) {
			return mpdUrl;
		}

		const urlRegex = /https?:\/\/[\w\-.~:?#[\]@!$&'()*+,;=%/]+/g;
		let match: RegExpExecArray | null;
		while ((match = urlRegex.exec(decoded)) !== null) {
			const url = match[0];
			if (url.includes('$Number$')) continue;
			if (/\/\d+\.mp4/.test(url)) continue;
			if (isValidMediaUrl(url)) {
				return url;
			}
		}
		return null;
	} catch (error) {
		console.error('Failed to decode manifest:', error);
		return null;
	}
}

export function buildDashManifestResult(params: {
	payload: string;
	contentType: string | null;
	createDashUnavailableError: (message: string) => Error;
}): DashManifestResult {
	const { payload, contentType, createDashUnavailableError } = params;
	const manifestText = decodeBase64Manifest(payload);

	if (isXmlContentType(contentType) || isDashManifestPayload(manifestText, contentType)) {
		return { kind: 'dash', manifest: manifestText, contentType };
	}

	const trimmed = manifestText.trim();
	if (isJsonContentType(contentType) || trimmed.startsWith('{') || trimmed.startsWith('[')) {
		const parsed = parseJsonSafely<{ detail?: unknown; urls?: unknown }>(manifestText);
		if (
			parsed &&
			typeof parsed === 'object' &&
			parsed.detail &&
			typeof parsed.detail === 'string' &&
			parsed.detail.toLowerCase() === 'not found'
		) {
			throw createDashUnavailableError('Dash manifest not found for track');
		}
		const urls = extractUrlsFromDashJsonPayload(parsed);
		if (urls.length > 0) {
			return { kind: 'flac', manifestText, urls, contentType };
		}
	}

	if (isDashManifestPayload(manifestText, contentType)) {
		return { kind: 'dash', manifest: manifestText, contentType };
	}

	if (isValidMediaUrl(trimmed)) {
		return { kind: 'flac', manifestText, urls: [trimmed], contentType };
	}

	const parsed = parseJsonSafely(manifestText);
	const urls = extractUrlsFromDashJsonPayload(parsed);
	if (urls.length > 0) {
		return { kind: 'flac', manifestText, urls, contentType };
	}

	throw createDashUnavailableError('Received unexpected payload from dash endpoint.');
}
