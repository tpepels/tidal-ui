import { z } from 'zod';
import { API_CONFIG, fetchWithCORS, selectApiTargetForRegion } from '$lib/config';
import { musicBrainzClient } from '$lib/clients/musicBrainzClient';
import type { RegionOption } from '$lib/stores/region';
import { parseTidalUrl } from './utils/urlParser';
import { buildStandardMetadataEntries, type StandardMetadataKey } from './utils/metadataStandard';
import { normalizeSearchResponse, prepareAlbum, prepareArtist, prepareTrack } from './api/normalizers';
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
	buildDashManifestResult as buildDashManifestResultHelper,
	decodeBase64Manifest as decodeBase64ManifestHelper,
	extractStreamUrlFromManifest as extractStreamUrlFromManifestHelper,
	parseFlacUrlFromMpd as parseFlacUrlFromMpdHelper
} from './api/streamManifest';
import { runMetadataEmbeddingPipeline } from './api/metadataEmbedding';
import { fetchTrackBlobPayload } from './api/trackBlob';
import { isQobuzFallbackEnabled, resolveQobuzFallbackLookup } from './api/qobuzFallback';
import {
	isNativeTidalApiEnabled,
	nativeGetAlbum,
	nativeGetArtist,
	nativeGetCover,
	nativeGetLyrics,
	nativeGetPlaylist,
	nativeGetTrackMetadata,
	nativeSearchAlbums,
	nativeSearchArtists,
	nativeSearchPlaylists,
	nativeSearchTracks
} from './api/tidalNativeClient';
import {
	downloadFlacFromMpdManifest,
	downloadTrackToClient,
	getStreamDataForTrack,
	resolveHiResStreamFromDash as resolveHiResStreamFromDashHelper,
	resolveTrackStreamUrl
} from './api/streamDownload';
import {
	AlbumSchema,
	AlbumSearchResponseSchema,
	AlbumWithTracksSchema,
	ArtistDetailsSchema,
	ArtistSchema,
	ArtistSearchResponseSchema,
	PlaylistSearchResponseSchema,
	PlaylistWithTracksSchema,
	StreamDataSchema,
	TrackInfoSchema,
	TrackSchema,
	TrackSearchResponseSchema,
	safeValidateApiResponse
} from './utils/schemas';
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
	ArtistRecommendations,
	TrackRecommendationsResponse
} from './types';

const API_BASE = API_CONFIG.baseUrl;
const RATE_LIMIT_ERROR_MESSAGE = 'Too Many Requests. Please wait a moment and try again.';
export const DASH_MANIFEST_UNAVAILABLE_CODE = 'DASH_MANIFEST_UNAVAILABLE';
const TrackLookupSchema = z.object({
	track: TrackSchema,
	info: TrackInfoSchema,
	originalTrackUrl: z.string().optional()
});
const ArtistRecommendationsSchema = z.object({
	source: z.union([z.literal('artist-mix'), z.literal('none')]),
	reason: z.string().optional(),
	mixId: z.string().optional(),
	mixTitle: z.string().optional(),
	mixSubtitle: z.string().optional(),
	artists: z.array(ArtistSchema),
	albums: z.array(AlbumSchema)
});

type CodedError = Error & { code?: string };

type TrackManifestAttributes = {
	trackPresentation?: string;
	previewReason?: string;
	uri?: string;
	manifest?: string;
	manifestHash?: string;
	formats: string[];
	albumReplayGain?: number;
	albumPeakAmplitude?: number;
	trackReplayGain?: number;
	trackPeakAmplitude?: number;
};

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
	musicBrainzReleaseIdPromise?: Promise<string | undefined>;
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

	private isBrowserRuntime(): boolean {
		return typeof window !== 'undefined' && typeof window.document !== 'undefined';
	}

	private async tryNativeTidal<T>(
		operation: string,
		callback: () => Promise<T>
	): Promise<T | null> {
		if (this.isBrowserRuntime() || !isNativeTidalApiEnabled()) {
			return null;
		}
		try {
			return await callback();
		} catch (error) {
			console.warn(`[NativeTidal] ${operation} failed; using hifi-api fallback`, {
				error: error instanceof Error ? error.message : String(error)
			});
			return null;
		}
	}

	private getAppErrorMessage(payload: unknown, status: number): string {
		if (status === 429) {
			return RATE_LIMIT_ERROR_MESSAGE;
		}
		if (payload && typeof payload === 'object') {
			const candidate = payload as Record<string, unknown>;
			if (typeof candidate.error === 'string' && candidate.error.trim().length > 0) {
				return candidate.error;
			}
			if (typeof candidate.detail === 'string' && candidate.detail.trim().length > 0) {
				return candidate.detail;
			}
			if (typeof candidate.userMessage === 'string' && candidate.userMessage.trim().length > 0) {
				return candidate.userMessage;
			}
		}
		return `Request failed (${status})`;
	}

	private validateAppPayload<T>(payload: unknown, schema: z.ZodTypeAny, endpoint: string): T {
		const validation = safeValidateApiResponse(payload, schema, {
			endpoint,
			allowUnvalidated: false
		});
		if (!validation.success) {
			throw new Error(`Malformed ${endpoint} response`);
		}
		return payload as T;
	}

	private async fetchAppPayload(path: string, init?: RequestInit): Promise<unknown> {
		const response = await fetch(path, init);
		let payload: unknown;
		try {
			payload = await response.json();
		} catch (error) {
			if (!response.ok) {
				throw new Error(this.getAppErrorMessage(undefined, response.status));
			}
			throw error instanceof Error ? error : new Error('Invalid JSON response');
		}
		if (!response.ok) {
			throw new Error(this.getAppErrorMessage(payload, response.status));
		}
		return payload;
	}

	private async fetchAppJson<T>(path: string, init?: RequestInit): Promise<T> {
		return (await this.fetchAppPayload(path, init)) as T;
	}

	private async fetchValidatedAppJson<T>(
		path: string,
		schema: z.ZodTypeAny,
		endpoint: string,
		init?: RequestInit
	): Promise<T> {
		const payload = await this.fetchAppPayload(path, init);
		return this.validateAppPayload(payload, schema, endpoint);
	}

	private parseBrowserSearchResponse<T>(
		payload: unknown,
		key: 'tracks' | 'artists' | 'albums' | 'playlists',
		schema: z.ZodTypeAny,
		endpoint: string
	): SearchResponse<T> {
		const normalized = normalizeSearchResponse<T>(payload, key);
		return this.validateAppPayload<SearchResponse<T>>(normalized, schema, endpoint);
	}

	private async parseBrowserTrackLookupPayload(
		trackId: number,
		payload: unknown
	): Promise<TrackLookup> {
		const validation = safeValidateApiResponse(payload, TrackLookupSchema, {
			endpoint: 'catalog.track',
			allowUnvalidated: false
		});
		if (validation.success) {
			return {
				track: prepareTrack(validation.data.track as Track),
				info: validation.data.info as TrackInfo,
				originalTrackUrl: validation.data.originalTrackUrl
			};
		}
		try {
			if (this.isV2ApiContainer(payload)) {
				return await this.parseTrackLookupV2(trackId, payload, 'v2');
			}
			return this.parseTrackLookup(payload);
		} catch {
			throw new Error('Malformed catalog.track response');
		}
	}

	private serializeArtworkIdForRoute(artworkId: string): string | null {
		const normalized = this.normalizeArtworkId(artworkId);
		if (!normalized) {
			return null;
		}
		return normalized.replace(/\//g, '-');
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
		return extractStreamUrlFromManifestHelper(manifest);
	}

	private createDashUnavailableError(message: string): CodedError {
		const error = new Error(message) as CodedError;
		error.code = DASH_MANIFEST_UNAVAILABLE_CODE;
		return error;
	}

	private isHiResQuality(quality: AudioQuality | string): boolean {
		return String(quality).toUpperCase() === 'HI_RES_LOSSLESS';
	}

	private isPreviewEntitlementFailure(error: unknown): boolean {
		if (!(error instanceof Error)) return false;
		const message = error.message.toLowerCase();
		return (
			message.includes('preview') ||
			message.includes('assetpresentation') ||
			message.includes('trackpresentation: preview') ||
			message.includes('full_requires_subscription')
		);
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
		return decodeBase64ManifestHelper(manifest);
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
		const nativeTrack = await this.tryNativeTidal('track metadata', () =>
			nativeGetTrackMetadata(trackId)
		);
		if (nativeTrack) {
			return prepareTrack(nativeTrack);
		}

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
			previewReason: typeof data.previewReason === 'string' ? data.previewReason : undefined,
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

	private isPreviewTrackLookup(lookup: TrackLookup): boolean {
		return lookup.info?.assetPresentation?.trim().toUpperCase() === 'PREVIEW';
	}

	private async getQobuzFallbackLookup(
		track: Track,
		quality: AudioQuality
	): Promise<TrackLookup | null> {
		try {
			return await resolveQobuzFallbackLookup({
				track,
				quality
			});
		} catch (error) {
			console.warn('[API] Qobuz fallback failed', {
				trackId: track.id,
				quality,
				error: error instanceof Error ? error.message : String(error)
			});
			return null;
		}
	}

	private async getQobuzFallbackLookupByTrackId(
		trackId: number,
		quality: AudioQuality
	): Promise<TrackLookup | null> {
		if (!isQobuzFallbackEnabled()) {
			return null;
		}
		try {
			const track = await this.fetchTrackMetadata(trackId, 'v2');
			return await this.getQobuzFallbackLookup(track, quality);
		} catch (error) {
			console.warn('[API] Could not prepare Qobuz fallback', {
				trackId,
				quality,
				error: error instanceof Error ? error.message : String(error)
			});
			return null;
		}
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

	private getRequiredTrackManifestFormat(quality: AudioQuality): string | null {
		switch (quality) {
			case 'HI_RES_LOSSLESS':
				return 'FLAC_HIRES';
			case 'LOSSLESS':
				return 'FLAC';
			default:
				return null;
		}
	}

	private extractTrackManifestAttributes(payload: unknown): TrackManifestAttributes | null {
		const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
		const firstData = root?.data;
		const secondData =
			firstData && typeof firstData === 'object'
				? (firstData as Record<string, unknown>).data
				: undefined;
		const candidate =
			secondData && typeof secondData === 'object'
				? secondData
				: firstData && typeof firstData === 'object'
					? firstData
					: root;
		const attributesSource =
			candidate && typeof candidate === 'object'
				? ((candidate as Record<string, unknown>).attributes ?? candidate)
				: null;
		if (!attributesSource || typeof attributesSource !== 'object') {
			return null;
		}

		const attributes = attributesSource as Record<string, unknown>;
		const rawFormats = Array.isArray(attributes.formats) ? attributes.formats : [];
		const normalization = (value: unknown, key: 'replayGain' | 'peakAmplitude'): number | undefined => {
			if (!value || typeof value !== 'object') return undefined;
			const candidate = (value as Record<string, unknown>)[key];
			return typeof candidate === 'number' ? candidate : undefined;
		};

		return {
			trackPresentation:
				typeof attributes.trackPresentation === 'string'
					? attributes.trackPresentation
					: undefined,
			previewReason:
				typeof attributes.previewReason === 'string'
					? attributes.previewReason
					: undefined,
			uri: typeof attributes.uri === 'string' ? attributes.uri : undefined,
			manifest: typeof attributes.manifest === 'string' ? attributes.manifest : undefined,
			manifestHash:
				typeof attributes.hash === 'string'
					? attributes.hash
					: typeof attributes.manifestHash === 'string'
						? attributes.manifestHash
						: undefined,
			formats: rawFormats
				.filter((format): format is string => typeof format === 'string')
				.map((format) => format.trim().toUpperCase())
				.filter((format) => format.length > 0),
			albumReplayGain: normalization(attributes.albumAudioNormalizationData, 'replayGain'),
			albumPeakAmplitude: normalization(attributes.albumAudioNormalizationData, 'peakAmplitude'),
			trackReplayGain: normalization(attributes.trackAudioNormalizationData, 'replayGain'),
			trackPeakAmplitude: normalization(attributes.trackAudioNormalizationData, 'peakAmplitude')
		};
	}

	private async resolveTrackManifestText(attributes: TrackManifestAttributes): Promise<{
		manifest: string;
		manifestMimeType: string;
	}> {
		if (attributes.manifest && attributes.manifest.trim().length > 0) {
			return {
				manifest: attributes.manifest,
				manifestMimeType: 'application/dash+xml'
			};
		}

		const uri = attributes.uri?.trim();
		if (!uri) {
			throw new Error('Track manifest response did not include a manifest URI');
		}

		if (!/^https?:\/\//i.test(uri)) {
			return {
				manifest: uri,
				manifestMimeType: 'application/dash+xml'
			};
		}

		const response = await this.fetch(uri, { apiVersion: 'v2', maxRetries: 0 });
		if (!response.ok) {
			throw new Error(`Failed to fetch track manifest URI (status ${response.status})`);
		}
		const manifest = await response.text();
		if (!manifest.trim()) {
			throw new Error('Track manifest URI returned an empty manifest');
		}

		return {
			manifest,
			manifestMimeType: response.headers.get('content-type') ?? 'application/dash+xml'
		};
	}

	private isTrackManifestQualityUnavailable(error: unknown): boolean {
		return (
			error instanceof Error &&
			error.message.includes('trackManifests response did not include required format')
		);
	}

	private async getTrackFromTrackManifests(
		id: number,
		quality: AudioQuality,
		options?: { skipTarget?: string }
	): Promise<TrackLookup> {
		const requiredFormat = this.getRequiredTrackManifestFormat(quality);
		if (!requiredFormat) {
			throw new Error(`trackManifests does not support ${quality} quality`);
		}

		const params = new URLSearchParams({
			id: String(id),
			adaptive: 'true',
			manifestType: 'MPEG_DASH',
			uriScheme: 'HTTPS',
			usage: 'PLAYBACK'
		});
		params.append('formats', requiredFormat);

		const response = await this.fetch(`${this.baseUrl}/trackManifests/?${params.toString()}`, {
			apiVersion: 'v2',
			skipTarget: options?.skipTarget
		});
		this.ensureNotRateLimited(response);
		if (!response.ok) {
			throw new Error(`Failed to get trackManifests response (status ${response.status})`);
		}

		const payload = await response.json();
		const attributes = this.extractTrackManifestAttributes(payload);
		if (!attributes) {
			throw new Error('Malformed trackManifests response');
		}
		if (!attributes.formats.includes(requiredFormat)) {
			throw new Error(
				`trackManifests response did not include required format ${requiredFormat} for ${quality}`
			);
		}
		if (attributes.trackPresentation?.trim().toUpperCase() === 'PREVIEW') {
			const reason = attributes.previewReason?.trim();
			throw new Error(
				`TIDAL returned a preview track manifest instead of the full track ` +
					`(trackPresentation: PREVIEW${reason ? `, previewReason: ${reason}` : ''}). ` +
					`Track ${id} is not available as a full ${quality} stream from this upstream account.`
			);
		}

		const manifestPayload = await this.resolveTrackManifestText(attributes);
		const track = await this.fetchTrackMetadata(id, 'v2');
		return {
			track,
			info: {
				trackId: id,
				audioMode: 'STEREO',
				audioQuality: quality,
				manifest: manifestPayload.manifest,
				manifestMimeType: manifestPayload.manifestMimeType,
				manifestHash: attributes.manifestHash,
				assetPresentation:
					attributes.trackPresentation?.trim().toUpperCase() === 'PREVIEW' ? 'PREVIEW' : 'FULL',
				previewReason: attributes.previewReason,
				albumReplayGain: attributes.albumReplayGain,
				albumPeakAmplitude: attributes.albumPeakAmplitude,
				trackReplayGain: attributes.trackReplayGain,
				trackPeakAmplitude: attributes.trackPeakAmplitude
			}
		};
	}

	private buildDashManifestResult(payload: string, contentType: string | null): DashManifestResult {
		return buildDashManifestResultHelper({
			payload,
			contentType,
			createDashUnavailableError: (message) => this.createDashUnavailableError(message)
		});
	}

	private async downloadFlacFromMpd(
		manifestText: string,
		options?: DownloadTrackOptions
	): Promise<{ blob: Blob; mimeType: string } | null> {
		return downloadFlacFromMpdManifest({
			manifestText,
			options,
			fetch: (url, requestInit) => this.fetch(url, requestInit)
		});
	}

	private async resolveHiResStreamFromDash(trackId: number): Promise<string> {
		return resolveHiResStreamFromDashHelper({
			trackId,
			getDashManifest: (candidateTrackId, quality) =>
				this.getDashManifest(candidateTrackId, quality),
			parseFlacUrlFromMpd: (manifestText) => parseFlacUrlFromMpdHelper(manifestText)
		});
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
			maxRetries?: number;
		}
	): Promise<Response> {
		return fetchWithCORS(url, options);
	}

	resolvePlaybackUrl(url: string): string {
		const trimmed = url.trim();
		if (!trimmed) {
			return '';
		}
		if (
			trimmed.startsWith('blob:') ||
			trimmed.startsWith('data:') ||
			trimmed.startsWith('/api/')
		) {
			return trimmed;
		}
		if (!API_CONFIG.useProxy || !API_CONFIG.proxyUrl) {
			return trimmed;
		}
		return `${API_CONFIG.proxyUrl}?url=${encodeURIComponent(trimmed)}`;
	}

	/**
	 * Search for tracks
	 */
	async searchTracks(query: string, region: RegionOption = 'auto'): Promise<SearchResponse<Track>> {
		if (this.isBrowserRuntime()) {
			const payload = await this.fetchAppPayload(
				`/api/catalog/search?${new URLSearchParams({
					type: 'tracks',
					q: query,
					region
				}).toString()}`
			);
			const result = this.parseBrowserSearchResponse<Track>(
				payload,
				'tracks',
				TrackSearchResponseSchema,
				'catalog.search.tracks'
			);
			return {
				...result,
				items: result.items.map((track) => prepareTrack(track))
			};
		}
		const nativeResult = await this.tryNativeTidal('search tracks', () =>
			nativeSearchTracks(query)
		);
		if (nativeResult) {
			return {
				...nativeResult,
				items: nativeResult.items.map((track) => prepareTrack(track))
			};
		}
		return searchTracks(this.getSearchContext(), query, region);
	}

	/**
	 * Search for artists
	 */
	async searchArtists(
		query: string,
		region: RegionOption = 'auto'
	): Promise<SearchResponse<Artist>> {
		if (this.isBrowserRuntime()) {
			const payload = await this.fetchAppPayload(
				`/api/catalog/search?${new URLSearchParams({
					type: 'artists',
					q: query,
					region
				}).toString()}`
			);
			const result = this.parseBrowserSearchResponse<Artist>(
				payload,
				'artists',
				ArtistSearchResponseSchema,
				'catalog.search.artists'
			);
			return {
				...result,
				items: result.items.map((artist) => prepareArtist(artist))
			};
		}
		const nativeResult = await this.tryNativeTidal('search artists', () =>
			nativeSearchArtists(query)
		);
		if (nativeResult) {
			return {
				...nativeResult,
				items: nativeResult.items.map((artist) => prepareArtist(artist))
			};
		}
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
		if (this.isBrowserRuntime()) {
			const params = new URLSearchParams({
				type: 'albums',
				q: query,
				region
			});
			if (artistQuery?.trim()) {
				params.set('artistQuery', artistQuery.trim());
			}
			const payload = await this.fetchAppPayload(`/api/catalog/search?${params.toString()}`);
			const result = this.parseBrowserSearchResponse<Album>(
				payload,
				'albums',
				AlbumSearchResponseSchema,
				'catalog.search.albums'
			);
			return {
				...result,
				items: result.items.map((album) => prepareAlbum(album))
			};
		}
		const nativeResult = await this.tryNativeTidal('search albums', () =>
			nativeSearchAlbums(query)
		);
		if (nativeResult) {
			const trimmedArtistQuery = artistQuery?.trim().toLowerCase() ?? '';
			const preparedItems = nativeResult.items.map((album) => prepareAlbum(album));
			if (!trimmedArtistQuery) {
				return {
					...nativeResult,
					items: preparedItems
				};
			}
			const filteredItems = preparedItems.filter((album) => {
				const names = [
					album.artist?.name,
					...(Array.isArray(album.artists) ? album.artists.map((artist) => artist.name) : [])
				]
					.filter((name): name is string => typeof name === 'string')
					.map((name) => name.toLowerCase());
				return names.some((name) => name.includes(trimmedArtistQuery));
			});
			if (filteredItems.length > 0) {
				return {
					...nativeResult,
					items: filteredItems,
					totalNumberOfItems: filteredItems.length
				};
			}
		}
		return searchAlbums(this.getSearchContext(), query, region, artistQuery);
	}

	/**
	 * Search for playlists
	 */
	async searchPlaylists(
		query: string,
		region: RegionOption = 'auto'
	): Promise<SearchResponse<Playlist>> {
		if (this.isBrowserRuntime()) {
			const payload = await this.fetchAppPayload(
				`/api/catalog/search?${new URLSearchParams({
					type: 'playlists',
					q: query,
					region
				}).toString()}`
			);
			return this.parseBrowserSearchResponse<Playlist>(
				payload,
				'playlists',
				PlaylistSearchResponseSchema,
				'catalog.search.playlists'
			);
		}
		const nativeResult = await this.tryNativeTidal('search playlists', () =>
			nativeSearchPlaylists(query)
		);
		if (nativeResult) {
			return nativeResult;
		}
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
		if (this.isBrowserRuntime()) {
			const payload = await this.fetchAppPayload(
				`/api/catalog/track/${id}?${new URLSearchParams({ quality }).toString()}`
			);
			return this.parseBrowserTrackLookupPayload(id, payload);
		}

		const qobuzPrimary = await this.getQobuzFallbackLookupByTrackId(id, quality);
		if (qobuzPrimary) {
			return qobuzPrimary;
		}

		if (this.isHiResQuality(quality)) {
			try {
				return await this.getTrackFromTrackManifests(id, quality, options);
			} catch (error) {
				console.warn('[API] trackManifests lookup failed for exact hi-res request', {
					trackId: id,
					quality,
					error: error instanceof Error ? error.message : String(error)
				});
				if (this.isPreviewEntitlementFailure(error)) {
					const qobuzFallback = await this.getQobuzFallbackLookupByTrackId(id, quality);
					if (qobuzFallback) {
						return qobuzFallback;
					}
				}
				if (this.isTrackManifestQualityUnavailable(error)) {
					throw error;
				}
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`trackManifests lookup failed for ${quality}: ${message}`);
			}
		}

		const url = `${this.baseUrl}/track/?id=${id}&quality=${quality}`;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const response = await this.fetch(url, { apiVersion: 'v2', skipTarget: options?.skipTarget });
			this.ensureNotRateLimited(response);
			if (response.ok) {
				const data = await response.json();
				const lookup = this.isV2ApiContainer(data)
					? await this.parseTrackLookupV2(id, data, 'v2')
					: this.parseTrackLookup(data);
				if (this.isPreviewTrackLookup(lookup)) {
					const qobuzFallback = await this.getQobuzFallbackLookup(lookup.track, quality);
					if (qobuzFallback) {
						return qobuzFallback;
					}
				}
				return lookup;
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

	async getRecommendations(trackId: number): Promise<Track[]> {
		const response = await this.fetch(`${this.baseUrl}/recommendations/?id=${trackId}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) {
			throw new Error('Failed to fetch track recommendations');
		}
		const payload: TrackRecommendationsResponse = await response.json();
		if (!payload.data.items) {
			throw new Error('No recommendations found');
		}
		return payload.data.items.map((item) => item.track);
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
		if (this.isBrowserRuntime()) {
			return this.fetchAppJson<DashManifestWithMetadata>(
				`/api/playback/track/${trackId}/dash?${new URLSearchParams({ quality }).toString()}`
			);
		}
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
		if (this.isBrowserRuntime()) {
			const result = await this.fetchValidatedAppJson<{ album: Album; tracks: Track[] }>(
				`/api/catalog/album/${id}`,
				AlbumWithTracksSchema,
				'catalog.album',
				{
					signal: options?.signal
				}
			);
			return {
				album: prepareAlbum(result.album),
				tracks: result.tracks.map((track) => prepareTrack(track))
			};
		}
		const nativeResult = await this.tryNativeTidal('album metadata', () =>
			nativeGetAlbum(id, { signal: options?.signal })
		);
		if (nativeResult) {
			return {
				album: prepareAlbum(nativeResult.album),
				tracks: nativeResult.tracks.map((track) => prepareTrack(track))
			};
		}
		return getAlbum(this.getCatalogContext(), id, options);
	}

	/**
	 * Get playlist details
	 */
	async getPlaylist(uuid: string): Promise<{ playlist: Playlist; items: Array<{ item: Track }> }> {
		if (this.isBrowserRuntime()) {
			return this.fetchValidatedAppJson<{ playlist: Playlist; items: Array<{ item: Track }> }>(
				`/api/catalog/playlist/${encodeURIComponent(uuid)}`,
				PlaylistWithTracksSchema,
				'catalog.playlist'
			);
		}
		const nativeResult = await this.tryNativeTidal('playlist metadata', () =>
			nativeGetPlaylist(uuid)
		);
		if (nativeResult) {
			return {
				playlist: nativeResult.playlist,
				items: nativeResult.items.map((entry) => ({ item: prepareTrack(entry.item) }))
			};
		}
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
		if (this.isBrowserRuntime()) {
			const result = await this.fetchValidatedAppJson<ArtistDetails>(
				`/api/catalog/artist/${id}`,
				ArtistDetailsSchema,
				'catalog.artist',
				{
					signal: options?.signal
				}
			);
			return {
				...prepareArtist(result),
				albums: (result.albums ?? []).map((album) => prepareAlbum(album)),
				tracks: (result.tracks ?? []).map((track) => prepareTrack(track))
			};
		}
		const nativeResult = await this.tryNativeTidal('artist metadata', () =>
			nativeGetArtist(id, { signal: options?.signal })
		);
		if (nativeResult) {
			return {
				...prepareArtist(nativeResult),
				albums: (nativeResult.albums ?? []).map((album) => prepareAlbum(album)),
				tracks: (nativeResult.tracks ?? []).map((track) => prepareTrack(track))
			};
		}
		return getArtist(this.getCatalogContext(), id, options);
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
		if (this.isBrowserRuntime()) {
			const result = await this.fetchValidatedAppJson<ArtistRecommendations>(
				`/api/catalog/artist/${id}/recommendations`,
				ArtistRecommendationsSchema,
				'catalog.artistRecommendations',
				{ signal: options?.signal }
			);
			return {
				...result,
				artists: result.artists.map((artist) => prepareArtist(artist)),
				albums: result.albums.map((album) => prepareAlbum(album))
			};
		}
		return getArtistRecommendations(this.getCatalogContext(), id, options);
	}

	/**
	 * Get cover image
	 */
	async getCover(id?: number, query?: string): Promise<CoverImage[]> {
		const nativeResult = await this.tryNativeTidal('cover lookup', () => nativeGetCover(id, query));
		if (nativeResult) {
			return nativeResult;
		}
		return getCover(this.getCatalogContext(), id, query);
	}

	/**
	 * Get lyrics for a track
	 */
	async getLyrics(id: number): Promise<Lyrics> {
		const nativeResult = await this.tryNativeTidal('lyrics lookup', () => nativeGetLyrics(id));
		if (nativeResult) {
			return nativeResult;
		}
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
		if (this.isBrowserRuntime()) {
			return this.fetchAppJson<{
				url: string;
				replayGain: number | null;
				sampleRate: number | null;
				bitDepth: number | null;
			}>(`/api/playback/track/${trackId}/stream?${new URLSearchParams({ quality }).toString()}`);
		}
		return getStreamDataForTrack({
			trackId,
			quality,
			isHiResQuality: (candidateQuality) => this.isHiResQuality(candidateQuality),
			getTrack: (candidateTrackId, candidateQuality) =>
				this.getTrack(candidateTrackId, candidateQuality),
			resolveHiResStreamFromDash: (candidateTrackId) =>
				this.resolveHiResStreamFromDash(candidateTrackId),
			extractStreamUrlFromManifest: (manifest) => this.extractStreamUrlFromManifest(manifest),
			delay: (ms) => this.delay(ms),
			isDev: import.meta.env.DEV
		});
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
			const payload = await musicBrainzClient.lookupTrackMetadata(track, {
				strictIsrcMatch,
				preferredReleaseId: musicBrainzReleaseId,
				signal
			});
			const tags = payload.tags ?? {};
			if (payload.lookupStatus === 'matched') {
				this.musicBrainzTagCache.set(cacheKey, tags);
				this.trimMusicBrainzCache();
				return Object.keys(tags).length > 0 ? tags : undefined;
			}
			if (payload.lookupStatus === 'no_match') {
				this.musicBrainzTagCache.set(cacheKey, null);
				this.trimMusicBrainzCache();
				return undefined;
			}
			if (payload.lookupStatus === 'lookup_failed') {
				console.warn('[MusicBrainz] Client lookup failed:', payload.error || 'lookup failed');
				return undefined;
			}
			throw new Error('Unexpected MusicBrainz lookup response');
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
				getCoverUrl: (coverId, size) => this.getCoverUrl(coverId, size)
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
		return resolveTrackStreamUrl({
			trackId,
			quality,
			isHiResQuality: (candidateQuality) => this.isHiResQuality(candidateQuality),
			getTrack: (candidateTrackId, candidateQuality) =>
				this.getTrack(candidateTrackId, candidateQuality),
			extractStreamUrlFromManifest: (manifest) => this.extractStreamUrlFromManifest(manifest)
		});
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
		return downloadTrackToClient({
			trackId,
			quality,
			filename,
			options,
			fetchTrackBlob: (candidateTrackId, candidateQuality, candidateFilename, downloadOptions) =>
				this.fetchTrackBlob(candidateTrackId, candidateQuality, candidateFilename, downloadOptions),
			getPreferredTrackMetadata: (candidateTrackId, candidateQuality) =>
				this.getPreferredTrackMetadata(candidateTrackId, candidateQuality),
			getCoverUrl: (coverId, size) => this.getCoverUrl(coverId, size),
			rateLimitErrorMessage: RATE_LIMIT_ERROR_MESSAGE
		});
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
		size: '1280' | '640' | '320' | '160' | '80' = '640'
	): string {
		const routeId = this.serializeArtworkIdForRoute(coverId);
		if (!routeId) {
			return '';
		}
		return `/api/artwork/cover/${encodeURIComponent(routeId)}/${size}`;
	}

	getCoverUrlFallbacks(
		coverId: string,
		size: '1280' | '640' | '320' | '160' | '80' = '640',
		options?: { proxy?: boolean; includeLowerSizes?: boolean }
	): string[] {
		const sizes = options?.includeLowerSizes ? LosslessAPI.getFallbackCoverSizes(size) : [size];
		const candidates: string[] = [];
		for (const candidateSize of sizes) {
			const directUrl = this.getCoverUrl(coverId, candidateSize);
			if (!directUrl) {
				continue;
			}
			if (!candidates.includes(directUrl)) {
				candidates.push(directUrl);
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
		const routeId = this.serializeArtworkIdForRoute(videoCoverId);
		if (!routeId) {
			return '';
		}
		return `/api/artwork/video/${encodeURIComponent(routeId)}/${size}`;
	}

	/**
	 * Get artist picture URL
	 */
	getArtistPictureUrl(pictureId: string, size: '750' = '750'): string {
		const trimmed = pictureId.trim();
		if (!trimmed) {
			return '';
		}

		const routeId = this.serializeArtworkIdForRoute(trimmed);
		if (routeId) {
			return `/api/artwork/artist/${encodeURIComponent(routeId)}/${size}`;
		}

		if (/^https?:\/\//i.test(trimmed)) {
			return trimmed;
		}

		return '';
	}
}

export const losslessAPI = new LosslessAPI();
