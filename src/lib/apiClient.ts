// API service for HIFI API
import { detectAudioFormat } from './utils/audioFormat';
import { API_CONFIG, fetchWithCORS, selectApiTargetForRegion } from '$lib/config';
import type { RegionOption } from '$lib/stores/region';
import { parseTidalUrl } from './utils/urlParser';
import { buildStandardMetadataEntries, type StandardMetadataKey } from './utils/metadataStandard';
import { z } from 'zod';
import { prepareAlbum, prepareArtist, prepareTrack } from './api/normalizers';
import {
	getAlbum,
	getArtist,
	getArtistRecommendations,
	getCover,
	getLyrics,
	getPlaylist
} from './api/catalog';
import { searchAlbums, searchArtists, searchPlaylists, searchTracks } from './api/search';
import {
	extractUrlsFromDashJsonPayload,
	isDashManifestPayload,
	isJsonContentType,
	isSegmentedDashManifest,
	isXmlContentType,
	parseJsonSafely
} from './api/manifest';
import {
	downloadCoverSeparately,
} from './api/coverDownload';
import { runMetadataEmbeddingPipeline } from './api/metadataEmbedding';
import { fetchTrackBlobPayload } from './api/trackBlob';
import { TrackInfoSchema, StreamDataSchema, safeValidateApiResponse } from './utils/schemas';
import type {
	Track,
	Artist,
	Album,
	Playlist,
	SearchResponse,
	AudioQuality,
	StreamData,
	CoverImage,
	Lyrics,
	TrackInfo,
	TrackLookup,
	ArtistDetails,
	ArtistRecommendations
} from './types';

const API_BASE = API_CONFIG.baseUrl;
const RATE_LIMIT_ERROR_MESSAGE = 'Too Many Requests. Please wait a moment and try again.';
export const DASH_MANIFEST_UNAVAILABLE_CODE = 'DASH_MANIFEST_UNAVAILABLE';

type CodedError = Error & { code?: string };

export type TrackDownloadProgress =
	| { stage: 'downloading'; receivedBytes: number; totalBytes?: number }
	| { stage: 'embedding'; progress: number };

export type DashManifestResult =
	| {
			kind: 'dash';
			manifest: string;
			contentType: string | null;
	  }
	| {
			kind: 'flac';
			manifestText: string;
			urls: string[];
			contentType: string | null;
	  };

export interface DashManifestWithMetadata {
	result: DashManifestResult;
	trackInfo: {
		sampleRate: number | null;
		bitDepth: number | null;
		replayGain: number | null;
	};
}

export interface DownloadTrackOptions {
	signal?: AbortSignal;
	onProgress?: (progress: TrackDownloadProgress) => void;
	onFfmpegCountdown?: (options: { totalBytes?: number; autoTriggered: boolean }) => void;
	onFfmpegStart?: () => void;
	onFfmpegProgress?: (progress: number) => void;
	onFfmpegComplete?: () => void;
	onFfmpegError?: (error: unknown) => void;
	ffmpegAutoTriggered?: boolean;
	convertAacToMp3?: boolean;
	downloadCoverSeperately?: boolean;
	enableExperimentalMusicBrainz?: boolean;
	strictMusicBrainzMatching?: boolean;
	musicBrainzReleaseId?: string;
	skipMetadataEmbedding?: boolean;
}

class LosslessAPI {
	public baseUrl: string;
	private metadataQueue: Promise<void> = Promise.resolve();
	private musicBrainzTagCache = new Map<string, Record<string, string> | null>();

	constructor(baseUrl: string = API_BASE) {
		this.baseUrl = baseUrl;
	}

	private resolveRegionalBase(region: RegionOption = 'auto'): string {
		try {
			const target = selectApiTargetForRegion(region);
			if (target?.baseUrl) {
				return target.baseUrl;
			}
		} catch (error) {
			console.warn('Falling back to default API base URL for region selection', { region, error });
		}
		return this.baseUrl;
	}

	private buildRegionalUrl(path: string, region: RegionOption = 'auto'): string {
		const base = this.resolveRegionalBase(region).replace(/\/+$/, '');
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;
		return `${base}${normalizedPath}`;
	}

	private getSearchContext() {
		return {
			buildRegionalUrl: this.buildRegionalUrl.bind(this),
			fetch: (url: string, options?: RequestInit) => this.fetch(url, options),
			ensureNotRateLimited: this.ensureNotRateLimited.bind(this)
		};
	}

	private getCatalogContext() {
		return {
			baseUrl: this.baseUrl,
			fetch: (url: string, options?: RequestInit) => this.fetch(url, options),
			ensureNotRateLimited: this.ensureNotRateLimited.bind(this)
		};
	}

	private ensureNotRateLimited(response: Response): void {
		if (response.status === 429) {
			throw new Error(RATE_LIMIT_ERROR_MESSAGE);
		}
	}

	private async delay(ms: number): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, ms));
	}

	private parseTrackLookup(data: unknown): TrackLookup {
		const entries = Array.isArray(data) ? data : [data];
		let track: Track | undefined;
		let info: TrackInfo | undefined;
		let originalTrackUrl: string | undefined;

		for (const entry of entries) {
			if (!entry || typeof entry !== 'object') continue;
			if (!track && 'album' in entry && 'artist' in entry && 'duration' in entry) {
				track = entry as Track;
				continue;
			}
			if (!info && 'manifest' in entry) {
				const parsed = TrackInfoSchema.safeParse(entry);
				if (parsed.success) {
					info = parsed.data;
				}
				continue;
			}
			if (!originalTrackUrl && 'OriginalTrackUrl' in entry) {
				const candidate = (entry as { OriginalTrackUrl?: unknown }).OriginalTrackUrl;
				if (typeof candidate === 'string') {
					originalTrackUrl = candidate;
				}
			}
		}

		if (!track || !info) {
			throw new Error('Malformed track response');
		}

		return { track, info, originalTrackUrl };
	}

	private extractStreamUrlFromManifest(manifest: string): string | null {
		try {
			let decoded = this.decodeBase64Manifest(manifest);
			const trimmed = decoded.trim();
			if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && this.isValidMediaUrl(decoded)) {
				return decoded;
			}
			const parsed = parseJsonSafely<{ urls?: unknown; url?: unknown; manifest?: unknown }>(
				decoded
			);
			if (parsed) {
				if (Array.isArray(parsed.urls) && parsed.urls.length > 0) {
					const candidate = parsed.urls.find((value) => typeof value === 'string');
					if (candidate) return candidate;
				}
				if (typeof parsed.url === 'string') {
					return parsed.url;
				}
				if (typeof parsed.manifest === 'string') {
					decoded = this.decodeBase64Manifest(parsed.manifest);
					const nestedTrimmed = decoded.trim();
					if (
						!nestedTrimmed.startsWith('{') &&
						!nestedTrimmed.startsWith('[') &&
						this.isValidMediaUrl(decoded)
					) {
						return decoded;
					}
				}
			}

			// If this is a segmented DASH manifest, don't extract a URL - let it fall through to segment download
			if (isSegmentedDashManifest(decoded)) {
				return null;
			}

			const mpdUrl = this.parseFlacUrlFromMpd(decoded);
			if (mpdUrl) {
				return mpdUrl;
			}

			// Match all URLs and filter out schema/namespace URLs and segment URLs
			const urlRegex = /https?:\/\/[\w\-.~:?#[\]@!$&'()*+,;=%/]+/g;
			let match: RegExpExecArray | null;
			while ((match = urlRegex.exec(decoded)) !== null) {
				const url = match[0];
				// Skip segment template URLs and initialization segments
				if (url.includes('$Number$')) continue;
				if (/\/\d+\.mp4/.test(url)) continue; // Skip segment files like /0.mp4, /1.mp4, etc.
				if (this.isValidMediaUrl(url)) {
					return url;
				}
			}
			return null;
		} catch (error) {
			console.error('Failed to decode manifest:', error);
			return null;
		}
	}

	private createDashUnavailableError(message: string): CodedError {
		const error = new Error(message) as CodedError;
		error.code = DASH_MANIFEST_UNAVAILABLE_CODE;
		return error;
	}

	private isHiResQuality(quality: AudioQuality | string): boolean {
		return String(quality).toUpperCase() === 'HI_RES_LOSSLESS';
	}

	private isV2ApiContainer(payload: unknown): payload is { version?: unknown; data?: unknown } {
		if (!payload || typeof payload !== 'object') return false;
		if (!('version' in (payload as Record<string, unknown>))) return false;
		const version = (payload as { version?: unknown }).version;
		if (typeof version === 'number') {
			return version >= 2 && version < 3;
		}
		if (typeof version === 'string') {
			return version.startsWith('2');
		}
		return false;
	}

	private decodeBase64Manifest(manifest: string): string {
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

	private extractTrackFromPayload(payload: unknown): Track | undefined {
		const candidates: unknown[] = [];
		if (!payload) return undefined;
		if (Array.isArray(payload)) {
			candidates.push(...payload);
		} else if (typeof payload === 'object') {
			candidates.push(payload);
			for (const value of Object.values(payload as Record<string, unknown>)) {
				if (value && (typeof value === 'object' || Array.isArray(value))) {
					candidates.push(value);
				}
			}
		}

		const isTrackLike = (entry: unknown): entry is Track => {
			if (!entry || typeof entry !== 'object') return false;
			const candidate = entry as Record<string, unknown>;
			return (
				typeof candidate.id === 'number' &&
				typeof candidate.title === 'string' &&
				typeof candidate.duration === 'number'
			);
		};

		for (const candidate of candidates) {
			if (isTrackLike(candidate)) {
				return candidate as Track;
			}
		}
		return undefined;
	}

	private async fetchTrackMetadata(
		trackId: number,
		apiVersion: 'v1' | 'v2' = 'v2'
	): Promise<Track> {
		const response = await this.fetch(`${this.baseUrl}/info/?id=${trackId}`, { apiVersion });
		this.ensureNotRateLimited(response);
		if (!response.ok) {
			throw new Error('Failed to fetch track metadata');
		}
		const payload = await response.json();
		const data = this.isV2ApiContainer(payload) ? payload.data : payload;
		const track = this.extractTrackFromPayload(data);
		if (!track) {
			throw new Error('Track metadata not found');
		}
		return prepareTrack(track);
	}

	private buildTrackInfoFromV2(data: Record<string, unknown>, fallbackTrackId: number): TrackInfo {
		const manifestMimeType =
			typeof data.manifestMimeType === 'string' && data.manifestMimeType.trim().length > 0
				? data.manifestMimeType
				: 'application/dash+xml';

		return {
			trackId: typeof data.trackId === 'number' ? data.trackId : fallbackTrackId,
			audioMode: typeof data.audioMode === 'string' ? data.audioMode : 'STEREO',
			audioQuality: typeof data.audioQuality === 'string' ? data.audioQuality : 'LOSSLESS',
			manifest: typeof data.manifest === 'string' ? data.manifest : '',
			manifestMimeType,
			manifestHash: typeof data.manifestHash === 'string' ? data.manifestHash : undefined,
			assetPresentation:
				typeof data.assetPresentation === 'string' ? data.assetPresentation : 'FULL',
			albumReplayGain: typeof data.albumReplayGain === 'number' ? data.albumReplayGain : undefined,
			albumPeakAmplitude:
				typeof data.albumPeakAmplitude === 'number' ? data.albumPeakAmplitude : undefined,
			trackReplayGain: typeof data.trackReplayGain === 'number' ? data.trackReplayGain : undefined,
			trackPeakAmplitude:
				typeof data.trackPeakAmplitude === 'number' ? data.trackPeakAmplitude : undefined,
			bitDepth: typeof data.bitDepth === 'number' ? data.bitDepth : undefined,
			sampleRate: typeof data.sampleRate === 'number' ? data.sampleRate : undefined
		};
	}

	private extractOriginalTrackUrl(payload: Record<string, unknown>): string | undefined {
		const originalUrl =
			typeof payload.OriginalTrackUrl === 'string'
				? payload.OriginalTrackUrl
				: typeof payload.originalTrackUrl === 'string'
					? payload.originalTrackUrl
					: undefined;
		return originalUrl;
	}

	private async parseTrackLookupV2(
		trackId: number,
		payload: { data?: unknown },
		apiVersion: 'v1' | 'v2' = 'v2'
	): Promise<TrackLookup> {
		const container = (payload?.data ?? payload) as Record<string, unknown>;
		const trackInfo = this.buildTrackInfoFromV2(container, trackId);
		if (!trackInfo.manifest) {
			throw new Error('Malformed track response');
		}
		let track = this.extractTrackFromPayload(container) ?? null;
		if (!track) {
			track = await this.fetchTrackMetadata(trackId, apiVersion);
		}

		return {
			track: prepareTrack(track),
			info: trackInfo,
			originalTrackUrl: this.extractOriginalTrackUrl(container)
		};
	}

	private buildDashManifestResult(payload: string, contentType: string | null): DashManifestResult {
		const manifestText = this.decodeBase64Manifest(payload);

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
				throw this.createDashUnavailableError('Dash manifest not found for track');
			}
			const urls = extractUrlsFromDashJsonPayload(parsed);
			if (urls.length > 0) {
				return { kind: 'flac', manifestText, urls, contentType };
			}
		}

		if (isDashManifestPayload(manifestText, contentType)) {
			return { kind: 'dash', manifest: manifestText, contentType };
		}

		const parsed = parseJsonSafely(manifestText);
		const urls = extractUrlsFromDashJsonPayload(parsed);
		if (urls.length > 0) {
			return { kind: 'flac', manifestText, urls, contentType };
		}

		throw this.createDashUnavailableError('Received unexpected payload from dash endpoint.');
	}

	private isValidMediaUrl(url: string): boolean {
		if (!url) return false;
		const normalized = url.toLowerCase();
		// We don't support HLS playlists in the audio element.
		if (normalized.includes('.m3u8') || normalized.includes('.m3u')) return false;
		// Filter out XML schema/namespace URLs
		if (normalized.includes('w3.org')) return false;
		if (normalized.includes('xmlschema')) return false;
		if (normalized.includes('xmlns')) return false;
		// Must look like a media URL (has extension or query params suggesting media)
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
		// If it has a file-like path segment, it's likely valid
		if (/\/[^/]+\.[a-z0-9]{2,5}(\?|$)/i.test(url)) return true;
		// If it's a relative path starting with a segment name, likely valid
		if (/^[a-z0-9_-]+\//i.test(url)) return true;
		// If it ends with a path segment that could be a file
		if (/\/[a-z0-9_-]+$/i.test(url)) return true;
		return false;
	}

	private parseFlacUrlFromMpd(manifestText: string): string | null {
		const trimmed = manifestText.trim();
		if (!trimmed) return null;

		const isValidMediaUrl = this.isValidMediaUrl.bind(this);

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
				.map((u) => (typeof u === 'string' ? u.trim() : ''))
				.filter((u) => u.length > 0 && isValidMediaUrl(u));
			if (candidates.length === 0) return null;
			return candidates.sort((a, b) => scoreUrl(b) - scoreUrl(a))[0] ?? null;
		};

		// Prefer DOMParser when available (browser side)
		if (typeof DOMParser !== 'undefined') {
			try {
				const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
				const baseUrls = Array.from(doc.getElementsByTagName('BaseURL')).map(
					(n) => n.textContent?.trim() ?? ''
				);
				if (baseUrls.length > 0) {
					const best = pickBest(baseUrls);
					if (best) return best;
				}

				const reps = Array.from(doc.getElementsByTagName('Representation'));
				for (const rep of reps) {
					const codecs = rep.getAttribute('codecs')?.toLowerCase() ?? '';
					const base = Array.from(rep.getElementsByTagName('BaseURL')).map(
						(n) => n.textContent?.trim() ?? ''
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

		// Regex fallback for SSR / non-browser
		const baseUrlMatch = trimmed.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i);
		if (baseUrlMatch?.[1]) {
			const candidate = baseUrlMatch[1].trim();
			if (isValidMediaUrl(candidate)) {
				return candidate;
			}
		}

		return null;
	}

	private parseMpdSegmentTemplate(manifestText: string): {
		initializationUrl: string;
		mediaUrlTemplate: string;
		startNumber: number;
		segmentTimeline: Array<{ duration: number; repeat: number }>;
		baseUrl?: string;
		codec?: string;
	} | null {
		const trimmed = manifestText.trim();
		if (!trimmed) return null;

		const parseWithDom = () => {
			if (typeof DOMParser === 'undefined') return null;
			try {
				const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
				const rawBaseUrl = doc.getElementsByTagName('BaseURL')[0]?.textContent?.trim();
				// Filter out schema/namespace URLs
				const baseUrl = rawBaseUrl && this.isValidMediaUrl(rawBaseUrl) ? rawBaseUrl : undefined;

				let template: Element | null = null;
				let codec: string | undefined;

				const representations = Array.from(doc.getElementsByTagName('Representation'));
				for (const rep of representations) {
					const candidateTemplate = rep.getElementsByTagName('SegmentTemplate')[0];
					if (!candidateTemplate) continue;
					const codecsAttr = rep.getAttribute('codecs')?.toLowerCase() ?? '';
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
			// Match <S> elements with d attribute, r attribute is optional
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
				segmentTimeline
			};
		};

		return parseWithDom() ?? parseWithRegex();
	}

	private buildMpdSegmentUrls(
		template: {
			initializationUrl: string;
			mediaUrlTemplate: string;
			startNumber: number;
			segmentTimeline: Array<{ duration: number; repeat: number }>;
			baseUrl?: string;
			codec?: string;
		} | null
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

	private async downloadFlacFromMpd(
		manifestText: string,
		options?: DownloadTrackOptions
	): Promise<{ blob: Blob; mimeType: string } | null> {
		const template = this.parseMpdSegmentTemplate(manifestText);
		const segments = this.buildMpdSegmentUrls(template);
		if (!segments) return null;

		const urls = [segments.initializationUrl, ...segments.segmentUrls];
		const chunks: Uint8Array[] = [];
		let receivedBytes = 0;

		for (const url of urls) {
			const response = await this.fetch(url, { signal: options?.signal });
			if (!response.ok) {
				throw new Error(`Failed to fetch DASH segment (status ${response.status})`);
			}
			const buffer = await response.arrayBuffer();
			const chunk = new Uint8Array(buffer);
			receivedBytes += chunk.byteLength;
			chunks.push(chunk);
			options?.onProgress?.({ stage: 'downloading', receivedBytes, totalBytes: undefined });
		}

		const totalBytes = chunks.reduce((total, current) => total + current.byteLength, 0);
		const merged = new Uint8Array(totalBytes);
		let offset = 0;
		for (const chunk of chunks) {
			merged.set(chunk, offset);
			offset += chunk.byteLength;
		}

		// Detect actual format from magic bytes instead of assuming FLAC
		const detectedFormat = detectAudioFormat(merged);
		const mimeType = detectedFormat?.mimeType ?? 'audio/flac';
		return { blob: new Blob([merged], { type: mimeType }), mimeType };
	}

	private async resolveHiResStreamFromDash(trackId: number): Promise<string> {
		const manifest = await this.getDashManifest(trackId, 'HI_RES_LOSSLESS');
		if (manifest.kind === 'flac') {
			const url = manifest.urls.find(
				(candidate) => typeof candidate === 'string' && candidate.length > 0
			);
			if (url) {
				return url;
			}
			throw new Error('DASH manifest did not include any FLAC URLs.');
		}
		const directUrl = this.parseFlacUrlFromMpd(manifest.manifest);
		if (directUrl) {
			return directUrl;
		}
		throw new Error('Hi-res DASH manifest does not expose a direct FLAC URL.');
	}

	/**
	 * Fetch wrapper with CORS handling
	 */
	private async fetch(
		url: string,
		options?: RequestInit & {
			apiVersion?: 'v1' | 'v2';
			preferredQuality?: string;
			skipTarget?: string;
		}
	): Promise<Response> {
		return fetchWithCORS(url, options);
	}

	/**
	 * Search for tracks
	 */
	async searchTracks(query: string, region: RegionOption = 'auto'): Promise<SearchResponse<Track>> {
		return searchTracks(this.getSearchContext(), query, region);
	}

	/**
	 * Search for artists
	 */
	async searchArtists(
		query: string,
		region: RegionOption = 'auto'
	): Promise<SearchResponse<Artist>> {
		return searchArtists(this.getSearchContext(), query, region);
	}

	/**
	 * Search for albums
	 */
	async searchAlbums(
		query: string,
		region: RegionOption = 'auto',
		artistQuery?: string
	): Promise<SearchResponse<Album>> {
		return searchAlbums(this.getSearchContext(), query, region, artistQuery);
	}

	/**
	 * Search for playlists
	 */
	async searchPlaylists(
		query: string,
		region: RegionOption = 'auto'
	): Promise<SearchResponse<Playlist>> {
		return searchPlaylists(this.getSearchContext(), query, region);
	}

	/**
	 * Import content from a Tidal URL
	 * Supports track, album, artist, and playlist URLs
	 */
	async importFromUrl(url: string): Promise<{
		type: 'track' | 'album' | 'artist' | 'playlist';
		data: Track | Album | Artist | { playlist: Playlist; tracks: Track[] };
	}> {
		const parsed = parseTidalUrl(url);

		if (parsed.type === 'unknown') {
			throw new Error(
				'Invalid Tidal URL. Please provide a valid track, album, artist, or playlist URL.'
			);
		}

		switch (parsed.type) {
			case 'track': {
				if (!parsed.trackId) {
					throw new Error('Could not extract track ID from URL');
				}
				const lookup = await this.getTrack(parsed.trackId);
				return {
					type: 'track',
					data: prepareTrack(lookup.track)
				};
			}

			case 'album': {
				if (!parsed.albumId) {
					throw new Error('Could not extract album ID from URL');
				}
				const { album } = await this.getAlbum(parsed.albumId);
				return {
					type: 'album',
					data: prepareAlbum(album)
				};
			}

			case 'artist': {
				if (!parsed.artistId) {
					throw new Error('Could not extract artist ID from URL');
				}
				const artist = await this.getArtist(parsed.artistId);
				return {
					type: 'artist',
					data: prepareArtist(artist)
				};
			}

			case 'playlist': {
				if (!parsed.playlistId) {
					throw new Error('Could not extract playlist ID from URL');
				}
				const { playlist, items } = await this.getPlaylist(parsed.playlistId);
				const tracks = items.map((item) => prepareTrack(item.item));
				return {
					type: 'playlist',
					data: { playlist, tracks }
				};
			}

			default:
				throw new Error('Unsupported URL type');
		}
	}

	/**
	 * Get track info and stream URL (with retries for quality fallback)
	 */
	async getTrack(
		id: number,
		quality: AudioQuality = 'LOSSLESS',
		options?: { skipTarget?: string }
	): Promise<TrackLookup> {
		const url = `${this.baseUrl}/track/?id=${id}&quality=${quality}`;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const response = await this.fetch(url, { apiVersion: 'v2', skipTarget: options?.skipTarget });
			this.ensureNotRateLimited(response);
			if (response.ok) {
				const data = await response.json();
				if (this.isV2ApiContainer(data)) {
					return await this.parseTrackLookupV2(id, data, 'v2');
				}
				return this.parseTrackLookup(data);
			}

			let detail: string | undefined;
			let userMessage: string | undefined;
			let subStatus: number | undefined;
			try {
				const errorData = (await response.json()) as {
					detail?: unknown;
					subStatus?: unknown;
					userMessage?: unknown;
				};
				if (typeof errorData?.detail === 'string') {
					detail = errorData.detail;
				}
				if (typeof errorData?.userMessage === 'string') {
					userMessage = errorData.userMessage;
					if (!detail) {
						detail = errorData.userMessage;
					}
				}
				if (typeof errorData?.subStatus === 'number') {
					subStatus = errorData.subStatus;
				}
			} catch {
				// Ignore JSON parse errors
			}

			const isTokenRetry = response.status === 401 && subStatus === 11002;
			const message = detail ?? `Failed to get track (status ${response.status})`;
			lastError = new Error(isTokenRetry ? (userMessage ?? message) : message);
			const shouldRetry =
				isTokenRetry || (detail ? /quality not found/i.test(detail) : response.status >= 500);

			if (attempt === 3 || !shouldRetry) {
				throw lastError;
			}

			await this.delay(200 * attempt);
		}

		throw lastError ?? new Error('Failed to get track');
	}

	async getDashManifest(
		trackId: number,
		quality: AudioQuality = 'HI_RES_LOSSLESS'
	): Promise<DashManifestResult> {
		const { result } = await this.getDashManifestWithMetadata(trackId, quality);
		return result;
	}

	async getDashManifestWithMetadata(
		trackId: number,
		quality: AudioQuality = 'HI_RES_LOSSLESS'
	): Promise<DashManifestWithMetadata> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			try {
				const lookup = await this.getTrack(trackId, quality);
				const manifestPayload = lookup.info?.manifest ?? '';
				const contentType = lookup.info?.manifestMimeType ?? null;
				const result = this.buildDashManifestResult(manifestPayload, contentType);
				const trackInfo = {
					sampleRate: lookup.info?.sampleRate ?? null,
					bitDepth: lookup.info?.bitDepth ?? null,
					replayGain: lookup.info?.trackReplayGain ?? null
				};
				return { result, trackInfo };
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}

			if (attempt < 3) {
				await this.delay(200 * attempt);
			}
		}

		throw lastError ?? this.createDashUnavailableError('Unable to load dash manifest for track');
	}

	/**
	 * Get song with stream info
	 */
	async getSong(query: string, quality: AudioQuality = 'LOSSLESS'): Promise<StreamData> {
		const response = await this.fetch(
			`${this.baseUrl}/song/?q=${encodeURIComponent(query)}&quality=${quality}`
		);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get song');
		const data = await response.json();

		// Validate the stream data
		const validationResult = safeValidateApiResponse(data, StreamDataSchema, {
			endpoint: 'song.stream',
			allowUnvalidated: true
		});

		return validationResult.success ? validationResult.data : data;
	}

	/**
	 * Get album details with track listing
	 */
	async getAlbum(
		id: number,
		options?: { signal?: AbortSignal }
	): Promise<{ album: Album; tracks: Track[] }> {
		return getAlbum(this.getCatalogContext(), id, options);
	}

	/**
	 * Get playlist details
	 */
	async getPlaylist(uuid: string): Promise<{ playlist: Playlist; items: Array<{ item: Track }> }> {
		return getPlaylist(this.getCatalogContext(), uuid);
	}

	/**
	 * Get artist overview, including discography modules and top tracks
	 */
	async getArtist(
		id: number,
		options?: {
			onProgress?: (progress: {
				receivedBytes: number;
				totalBytes?: number;
				percent?: number;
			}) => void;
			signal?: AbortSignal;
		}
	): Promise<ArtistDetails> {
		const officialOrigin =
			typeof window !== 'undefined' && window.location?.origin ? window.location.origin : undefined;
		return getArtist(this.getCatalogContext(), id, {
			...options,
			officialEnrichment: Boolean(officialOrigin),
			officialOrigin
		});
	}

	/**
	 * Get artist/album recommendations derived from the artist mix.
	 */
	async getArtistRecommendations(
		id: number,
		options?: {
			signal?: AbortSignal;
		}
	): Promise<ArtistRecommendations> {
		return getArtistRecommendations(this.getCatalogContext(), id, options);
	}

	/**
	 * Get cover image
	 */
	async getCover(id?: number, query?: string): Promise<CoverImage[]> {
		return getCover(this.getCatalogContext(), id, query);
	}

	/**
	 * Get lyrics for a track
	 */
	async getLyrics(id: number): Promise<Lyrics> {
		return getLyrics(this.getCatalogContext(), id);
	}

	/**
	 * Get stream data including URL and replay gain
	 */
	async getStreamData(
		trackId: number,
		quality: AudioQuality = 'LOSSLESS'
	): Promise<{
		url: string;
		replayGain: number | null;
		sampleRate: number | null;
		bitDepth: number | null;
	}> {
		let replayGain: number | null = null;
		let sampleRate: number | null = null;
		let bitDepth: number | null = null;
		const isDev = import.meta.env.DEV;

		if (this.isHiResQuality(quality)) {
			try {
				// Try to fetch metadata for replay gain, but don't fail if it fails
				try {
					const lookup = await this.getTrack(trackId, quality);
					replayGain = lookup.info.trackReplayGain ?? null;
					sampleRate = lookup.info.sampleRate ?? null;
					bitDepth = lookup.info.bitDepth ?? null;
				} catch {
					// Ignore metadata fetch failure for HiRes
				}

				const url = await this.resolveHiResStreamFromDash(trackId);

				const result = { url, replayGain, sampleRate, bitDepth };

				// Validate the result
				const StreamDataResultSchema = z.object({
					url: z.string(),
					replayGain: z.number().nullable(),
					sampleRate: z.number().nullable(),
					bitDepth: z.number().nullable()
				});

				const validationResult = safeValidateApiResponse(result, StreamDataResultSchema, {
					endpoint: 'stream.hires',
					allowUnvalidated: true
				});

				return validationResult.success ? validationResult.data : result;
			} catch (error) {
				console.warn('Failed to resolve hi-res stream via DASH manifest', error);
				quality = 'LOSSLESS';
			}
		}

		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			try {
				const lookup = await this.getTrack(trackId, quality);
				replayGain = lookup.info.trackReplayGain ?? null;
				sampleRate = lookup.info.sampleRate ?? null;
				bitDepth = lookup.info.bitDepth ?? null;

				if (lookup.originalTrackUrl) {
					const result = { url: lookup.originalTrackUrl, replayGain, sampleRate, bitDepth };

					// Validate the result
					const StreamDataResultSchema = z.object({
						url: z.string(),
						replayGain: z.number().nullable(),
						sampleRate: z.number().nullable(),
						bitDepth: z.number().nullable()
					});

					const validationResult = safeValidateApiResponse(result, StreamDataResultSchema, {
						endpoint: 'stream.standard.original',
						allowUnvalidated: true
					});

					return validationResult.success ? validationResult.data : result;
				}

				if (isDev) {
					const manifestPayload = lookup.info.manifest;
					console.debug('[getStreamData] manifest payload summary', {
						trackId,
						quality,
						manifestType: typeof manifestPayload,
						manifestLength: typeof manifestPayload === 'string' ? manifestPayload.length : null,
						manifestStartsWith:
							typeof manifestPayload === 'string' ? manifestPayload.trim().slice(0, 40) : null,
						manifestMimeType: lookup.info.manifestMimeType ?? null
					});
				}
				const manifestUrl = this.extractStreamUrlFromManifest(lookup.info.manifest);
				if (manifestUrl) {
					const result = { url: manifestUrl, replayGain, sampleRate, bitDepth };

					// Validate the result
					const StreamDataResultSchema = z.object({
						url: z.string(),
						replayGain: z.number().nullable(),
						sampleRate: z.number().nullable(),
						bitDepth: z.number().nullable()
					});

					const validationResult = safeValidateApiResponse(result, StreamDataResultSchema, {
						endpoint: 'stream.standard.manifest',
						allowUnvalidated: true
					});

					return validationResult.success ? validationResult.data : result;
				}

				lastError = new Error('Unable to resolve stream URL for track');
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}

			if (attempt < 3) {
				await this.delay(200 * attempt);
			}
		}

		throw lastError ?? new Error('Unable to resolve stream URL for track');
	}

	/**
	 * Get stream URL for a track
	 */
	async getStreamUrl(trackId: number, quality: AudioQuality = 'LOSSLESS'): Promise<string> {
		const data = await this.getStreamData(trackId, quality);
		return data.url;
	}

	/**
	 * Attempt to embed metadata into a downloaded track using FFmpeg WASM
	 */
	private async embedMetadataIntoBlob(
		blob: Blob,
		lookup: TrackLookup,
		filename: string,
		contentType: string | null,
		options: DownloadTrackOptions | undefined,
		quality: AudioQuality,
		convertToMp3: boolean,
		extraMetadataTags?: Record<string, string>
	): Promise<Blob | null> {
		const job = this.metadataQueue.then(() =>
			this.runMetadataEmbedding(
				blob,
				lookup,
				filename,
				contentType ?? undefined,
				options,
				quality,
				convertToMp3,
				extraMetadataTags
			)
		);
		this.metadataQueue = job.then(
			() => undefined,
			() => undefined
		);

		try {
			return await job;
		} catch (error) {
			console.warn('Metadata embedding failed', error);
			return null;
		}
	}

	private inferExtensionFromFilename(filename: string): string | null {
		const match = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(filename);
		return match ? match[1]!.toLowerCase() : null;
	}

	private inferExtensionFromMime(mime?: string | null): string | null {
		if (!mime) return null;
		const normalized = mime.split(';')[0]?.trim().toLowerCase();
		switch (normalized) {
			case 'audio/flac':
				return 'flac';
			case 'audio/x-flac':
				return 'flac';
			case 'audio/mpeg':
				return 'mp3';
			case 'audio/mp3':
				return 'mp3';
			case 'audio/mp4':
			case 'audio/aac':
			case 'audio/x-m4a':
				return 'm4a';
			case 'audio/wav':
			case 'audio/x-wav':
				return 'wav';
			case 'audio/ogg':
				return 'ogg';
			default:
				return null;
		}
	}

	private inferMimeFromExtension(
		ext: string | null | undefined,
		fallbackType?: string
	): string | undefined {
		switch (ext) {
			case 'flac':
				return 'audio/flac';
			case 'mp3':
				return 'audio/mpeg';
			case 'm4a':
			case 'aac':
				return 'audio/mp4';
			case 'wav':
				return 'audio/wav';
			case 'ogg':
				return 'audio/ogg';
			default:
				return fallbackType;
		}
	}

	private buildMetadataEntries(
		lookup: TrackLookup,
		extraMetadata?: Record<string, string>
	): Array<[string, string]> {
		return buildStandardMetadataEntries(
			lookup,
			undefined,
			extraMetadata as Partial<Record<StandardMetadataKey, string>> | undefined
		);
	}

	private trimMusicBrainzCache(): void {
		const maxEntries = 500;
		if (this.musicBrainzTagCache.size <= maxEntries) return;
		while (this.musicBrainzTagCache.size > maxEntries) {
			const firstKey = this.musicBrainzTagCache.keys().next().value;
			if (typeof firstKey !== 'string') break;
			this.musicBrainzTagCache.delete(firstKey);
		}
	}

	private buildMusicBrainzCacheKey(
		track: Track,
		strictMatch: boolean,
		musicBrainzReleaseId?: string
	): string {
		const mode = strictMatch ? 'strict' : 'flex';
		const releaseSegment =
			typeof musicBrainzReleaseId === 'string' && musicBrainzReleaseId.trim().length > 0
				? musicBrainzReleaseId.trim().toLowerCase()
				: 'auto';
		const trackId = Number(track.id);
		if (Number.isFinite(trackId)) {
			return `${mode}:release:${releaseSegment}:id:${trackId}`;
		}
		const title = String(track.title ?? '')
			.trim()
			.toLowerCase();
		const artist = String(track.artist?.name ?? track.artists?.[0]?.name ?? '')
			.trim()
			.toLowerCase();
		const album = String(track.album?.title ?? '')
			.trim()
			.toLowerCase();
		const isrc = String(track.isrc ?? '')
			.trim()
			.toUpperCase();
		return `${mode}:release:${releaseSegment}:query:${isrc}|${title}|${artist}|${album}`;
	}

	private async lookupMusicBrainzTags(
		track: Track,
		signal?: AbortSignal,
		strictMusicBrainzMatching?: boolean,
		musicBrainzReleaseId?: string
	): Promise<Record<string, string> | undefined> {
		const strictIsrcMatch = strictMusicBrainzMatching === true;
		const cacheKey = this.buildMusicBrainzCacheKey(track, strictIsrcMatch, musicBrainzReleaseId);
		const cached = this.musicBrainzTagCache.get(cacheKey);
		if (cached) {
			return { ...cached };
		}
		if (cached === null) {
			return undefined;
		}

		try {
			const response = await fetch('/api/metadata/musicbrainz', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					track,
					strictIsrcMatch,
					preferredReleaseId: musicBrainzReleaseId
				}),
				signal
			});
			if (!response.ok) {
				throw new Error(`MusicBrainz lookup failed (${response.status})`);
			}
			const payload = (await response.json()) as {
				success?: boolean;
				tags?: Record<string, string>;
			};
			const tags = payload.success ? (payload.tags ?? {}) : {};
			const hasTags = Object.keys(tags).length > 0;
			this.musicBrainzTagCache.set(cacheKey, hasTags ? tags : null);
			this.trimMusicBrainzCache();
			return hasTags ? tags : undefined;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				throw error;
			}
			console.warn('[MusicBrainz] Client lookup failed:', error);
			return undefined;
		}
	}

	private async runMetadataEmbedding(
		blob: Blob,
		lookup: TrackLookup,
		filename: string,
		contentType: string | undefined,
		options: DownloadTrackOptions | undefined,
		quality: AudioQuality,
		convertToMp3: boolean,
		extraMetadataTags?: Record<string, string>
	): Promise<Blob | null> {
		return runMetadataEmbeddingPipeline({
			blob,
			lookup,
			filename,
			contentType,
			options,
			quality,
			convertToMp3,
			extraMetadataTags,
			deps: {
				inferExtensionFromFilename: (candidateFilename) =>
					this.inferExtensionFromFilename(candidateFilename),
				inferExtensionFromMime: (candidateMime) => this.inferExtensionFromMime(candidateMime),
				inferMimeFromExtension: (extension, fallbackType) =>
					this.inferMimeFromExtension(extension, fallbackType),
				buildMetadataEntries: (candidateLookup, extra) =>
					this.buildMetadataEntries(candidateLookup, extra),
				getCoverUrl: (coverId, size, coverOptions) => this.getCoverUrl(coverId, size, coverOptions)
			}
		});
	}

	private async resolveTrackLookups(
		trackId: number,
		quality: AudioQuality
	): Promise<{
		manifestLookup: TrackLookup;
		metadataLookup: TrackLookup;
		manifestQuality: AudioQuality;
	}> {
		const manifestLookup = await this.getTrack(trackId, quality);
		const metadataLookup = manifestLookup;
		return { manifestLookup, metadataLookup, manifestQuality: quality };
	}

	async getPreferredTrackMetadata(
		trackId: number,
		quality: AudioQuality = 'LOSSLESS'
	): Promise<TrackLookup> {
		const { metadataLookup } = await this.resolveTrackLookups(trackId, quality);
		return metadataLookup;
	}

	async fetchTrackBlob(
		trackId: number,
		quality: AudioQuality = 'LOSSLESS',
		filename: string,
		options?: DownloadTrackOptions
	): Promise<{ blob: Blob; mimeType?: string }> {
		return fetchTrackBlobPayload({
			trackId,
			quality,
			filename,
			options,
			deps: {
				resolveTrackLookups: (candidateTrackId, candidateQuality) =>
					this.resolveTrackLookups(candidateTrackId, candidateQuality),
				fetch: (url, init) => this.fetch(url, init),
				decodeBase64Manifest: (manifest) => this.decodeBase64Manifest(manifest),
				downloadFlacFromMpd: (manifestText, downloadOptions) =>
					this.downloadFlacFromMpd(manifestText, downloadOptions),
				extractStreamUrlFromManifest: (manifest) => this.extractStreamUrlFromManifest(manifest),
				getTrack: (candidateTrackId, candidateQuality) =>
					this.getTrack(candidateTrackId, candidateQuality),
				lookupMusicBrainzTags: (track, signal, strictMusicBrainzMatching, musicBrainzReleaseId) =>
					this.lookupMusicBrainzTags(
						track,
						signal,
						strictMusicBrainzMatching,
						musicBrainzReleaseId
					),
				embedMetadataIntoBlob: (
					blobPayload,
					lookup,
					candidateFilename,
					candidateContentType,
					downloadOptions,
					candidateQuality,
					convertToMp3,
					extraMetadataTags
				) =>
					this.embedMetadataIntoBlob(
						blobPayload,
						lookup,
						candidateFilename,
						candidateContentType,
						downloadOptions,
						candidateQuality,
						convertToMp3,
						extraMetadataTags
					),
				rateLimitErrorMessage: RATE_LIMIT_ERROR_MESSAGE
			}
		});
	}

	async getTrackStreamUrl(trackId: number, quality: AudioQuality = 'LOSSLESS'): Promise<string> {
		if (this.isHiResQuality(quality)) {
			quality = 'LOSSLESS';
		}

		const lookup = await this.getTrack(trackId, quality);
		if (lookup.originalTrackUrl) {
			return lookup.originalTrackUrl;
		}
		const fallback = this.extractStreamUrlFromManifest(lookup.info.manifest);
		if (!fallback) {
			throw new Error('Could not resolve stream URL for track');
		}
		return fallback;
	}

	/**
	 * Download a track
	 * Fetches the audio stream and triggers a download
	 */
	async downloadTrack(
		trackId: number,
		quality: AudioQuality = 'LOSSLESS',
		filename: string,
		options?: DownloadTrackOptions
	): Promise<void> {
		try {
			const { blob } = await this.fetchTrackBlob(trackId, quality, filename, options);
			const url = URL.createObjectURL(blob);

			// Trigger download
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);

			// Download cover separately if enabled
			if (options?.downloadCoverSeperately) {
				try {
					const metadata = await this.getPreferredTrackMetadata(trackId, quality);
					const coverId = metadata.track.album?.cover;
					if (coverId) {
						console.log('[Cover Download] Fetching cover for separate download...');
						await downloadCoverSeparately({
							coverId,
							getCoverUrl: (id, size) => this.getCoverUrl(id, size)
						});
					}
				} catch (coverError) {
					console.warn('Failed to download cover separately:', coverError);
				}
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				throw error;
			}
			console.error('Download failed:', error);
			if (error instanceof Error && error.message === RATE_LIMIT_ERROR_MESSAGE) {
				throw error;
			}
			throw new Error(
				'Download failed. The stream URL may require a proxy. Please try streaming instead.'
			);
		}
	}

	/**
	 * Format duration from seconds to MM:SS
	 */
	formatDuration(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	/**
	 * Get cover URL
	 */
	private parseArtworkIdFromResourceUrl(value: string): string | null {
		try {
			const parsed = new URL(value);
			if (parsed.hostname !== 'resources.tidal.com') {
				return null;
			}
			const segments = parsed.pathname
				.split('/')
				.map((segment) => segment.trim())
				.filter(Boolean);
			const imagesIndex = segments.findIndex((segment) => segment.toLowerCase() === 'images');
			if (imagesIndex < 0) {
				return null;
			}
			const idSegments = segments.slice(imagesIndex + 1);
			if (idSegments.length === 0) {
				return null;
			}
			const lastSegment = idSegments[idSegments.length - 1] ?? '';
			if (/^\d+x\d+\.(jpg|jpeg|png|webp)$/i.test(lastSegment)) {
				idSegments.pop();
			}
			if (idSegments.length === 0) {
				return null;
			}
			return idSegments.join('/');
		} catch {
			return null;
		}
	}

	private normalizeArtworkId(coverId: string): string | null {
		const trimmed = coverId.trim();
		if (trimmed.length === 0) {
			return null;
		}

		const fromResourceUrl = this.parseArtworkIdFromResourceUrl(trimmed);
		if (fromResourceUrl) {
			return fromResourceUrl;
		}

		if (/^https?:\/\//i.test(trimmed)) {
			return null;
		}

		const normalized = trimmed.replace(/^\/+|\/+$/g, '');
		if (normalized.length === 0) {
			return null;
		}

		if (!normalized.includes('/')) {
			return normalized;
		}

		const segments = normalized
			.split('/')
			.map((segment) => segment.trim())
			.filter(Boolean);
		if (segments.length === 0) {
			return null;
		}

		const imagesIndex = segments.findIndex((segment) => segment.toLowerCase() === 'images');
		const relevantSegments = imagesIndex >= 0 ? segments.slice(imagesIndex + 1) : segments;
		if (relevantSegments.length === 0) {
			return null;
		}

		const lastSegment = relevantSegments[relevantSegments.length - 1] ?? '';
		if (/^\d+x\d+\.(jpg|jpeg|png|webp)$/i.test(lastSegment)) {
			relevantSegments.pop();
		}

		if (relevantSegments.length === 0) {
			return null;
		}

		return relevantSegments.join('/');
	}

	private static getFallbackCoverSizes(
		size: '1280' | '640' | '320' | '160' | '80'
	): Array<'1280' | '640' | '320' | '160' | '80'> {
		switch (size) {
			case '1280':
				return ['1280', '640', '320', '160', '80'];
			case '640':
				return ['640', '320', '160', '80'];
			case '320':
				return ['320', '160', '80'];
			case '160':
				return ['160', '80'];
			case '80':
			default:
				return ['80'];
		}
	}

	getCoverUrl(
		coverId: string,
		size: '1280' | '640' | '320' | '160' | '80' = '640',
		options?: { proxy?: boolean }
	): string {
		const normalizedCoverId = this.normalizeArtworkId(coverId);
		if (!normalizedCoverId) {
			return '';
		}
		const url = `https://resources.tidal.com/images/${normalizedCoverId.replace(/-/g, '/')}/${size}x${size}.jpg`;
		if (!options?.proxy || !API_CONFIG.proxyUrl) {
			return url;
		}
		return `${API_CONFIG.proxyUrl}?url=${encodeURIComponent(url)}`;
	}

	getCoverUrlFallbacks(
		coverId: string,
		size: '1280' | '640' | '320' | '160' | '80' = '640',
		options?: { proxy?: boolean; includeLowerSizes?: boolean }
	): string[] {
		const sizes = options?.includeLowerSizes ? LosslessAPI.getFallbackCoverSizes(size) : [size];
		const candidates: string[] = [];
		for (const candidateSize of sizes) {
			const directUrl = this.getCoverUrl(coverId, candidateSize, { proxy: false });
			if (!directUrl) {
				continue;
			}
			if (!candidates.includes(directUrl)) {
				candidates.push(directUrl);
			}
			if (options?.proxy && API_CONFIG.proxyUrl) {
				const proxyUrl = `${API_CONFIG.proxyUrl}?url=${encodeURIComponent(directUrl)}`;
				if (!candidates.includes(proxyUrl)) {
					candidates.push(proxyUrl);
				}
			}
		}
		return candidates;
	}

	/**
	 * Get video cover URL
	 */
	getVideoCoverUrl(
		videoCoverId: string,
		size: '1280' | '640' | '320' | '160' | '80' = '640'
	): string {
		return `https://resources.tidal.com/videos/${videoCoverId.replace(/-/g, '/')}/${size}x${size}.mp4`;
	}

	/**
	 * Get artist picture URL
	 */
	getArtistPictureUrl(pictureId: string, size: '750' = '750'): string {
		const trimmed = pictureId.trim();
		if (!trimmed) {
			return '';
		}

		const normalizedPictureId = this.normalizeArtworkId(trimmed);
		if (normalizedPictureId) {
			return `https://resources.tidal.com/images/${normalizedPictureId.replace(/-/g, '/')}/${size}x${size}.jpg`;
		}

		if (/^https?:\/\//i.test(trimmed)) {
			return trimmed;
		}

		return '';
	}
}

export const losslessAPI = new LosslessAPI();
