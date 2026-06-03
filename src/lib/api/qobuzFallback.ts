import type { AudioQuality, Track, TrackLookup } from '../types';
import { API_CONFIG, refreshApiTargetsIfStale } from '../config/targets';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type QobuzAudioInfo = {
	replaygain_track_gain?: unknown;
	replaygain_track_peak?: unknown;
	replaygain_album_gain?: unknown;
	replaygain_album_peak?: unknown;
};

type QobuzTrackCandidate = {
	id?: unknown;
	isrc?: unknown;
	title?: unknown;
	duration?: unknown;
	streamable?: unknown;
	hires_streamable?: unknown;
	maximum_bit_depth?: unknown;
	maximum_sampling_rate?: unknown;
	audio_info?: QobuzAudioInfo;
	album?: {
		title?: unknown;
	};
	performer?: {
		name?: unknown;
	};
};

type QobuzSearchResponse = {
	success?: unknown;
	data?: {
		tracks?: {
			items?: unknown;
		};
	};
};

type QobuzDownloadResponse = {
	success?: unknown;
	data?: {
		url?: unknown;
	};
};

const DEFAULT_QOBUZ_FALLBACK_TARGETS = [
	'https://qdl-api.monochrome.tf',
	'https://qobuz.kennyy.com.br',
	'https://mono.scavengerfurs.net'
];

const DEFAULT_QOBUZ_TIMEOUT_MS = 8000;

function getEnvValue(name: string): string | undefined {
	if (typeof process === 'undefined' || !process.env) return undefined;
	return process.env[name];
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export function isQobuzFallbackEnabled(): boolean {
	const raw = getEnvValue('QOBUZ_FALLBACK_ENABLED');
	if (!raw) {
		return getEnvValue('VITEST') !== 'true';
	}
	const normalized = raw.trim().toLowerCase();
	return !['0', 'false', 'no', 'off', 'disabled'].includes(normalized);
}

export function getQobuzFallbackTargets(): string[] {
	const raw = getEnvValue('QOBUZ_FALLBACK_TARGETS');
	const configuredTargets = API_CONFIG.qobuzTargets?.map((target) => target.baseUrl) ?? [];
	const candidates = raw && raw.trim().length > 0 ? raw.split(',') : configuredTargets;
	const normalized = candidates
		.map((value) => normalizeInstanceUrl(value))
		.filter((value): value is string => value !== null);
	return normalized.length > 0 ? normalized : DEFAULT_QOBUZ_FALLBACK_TARGETS;
}

function normalizeInstanceUrl(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim().replace(/\/+$/, '');
	if (!trimmed) return null;
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
		return parsed.toString().replace(/\/+$/, '');
	} catch {
		return null;
	}
}

function normalizeText(value: unknown): string {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function normalizeIsrc(value: unknown): string {
	return String(value ?? '')
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '');
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function asTrackId(value: unknown): string | null {
	if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
	if (typeof value === 'string' && value.trim().length > 0) return value.trim();
	return null;
}

function sampleRateToHz(value: unknown): number | undefined {
	const sampleRate = asNumber(value);
	if (!sampleRate || sampleRate <= 0) return undefined;
	return sampleRate < 1000 ? Math.round(sampleRate * 1000) : Math.round(sampleRate);
}

function getQualityCode(quality: AudioQuality): string {
	switch (quality) {
		case 'HI_RES_LOSSLESS':
			return '27';
		case 'LOSSLESS':
			return '6';
		case 'HIGH':
		case 'LOW':
			return '5';
		default:
			return '6';
	}
}

function inferMimeType(quality: AudioQuality): string {
	switch (quality) {
		case 'HI_RES_LOSSLESS':
		case 'LOSSLESS':
			return 'audio/flac';
		default:
			return 'audio/mpeg';
	}
}

function candidateSupportsQuality(candidate: QobuzTrackCandidate, quality: AudioQuality): boolean {
	if (candidate.streamable === false) return false;
	if (quality !== 'HI_RES_LOSSLESS') return true;
	if (candidate.hires_streamable === true) return true;
	const bitDepth = asNumber(candidate.maximum_bit_depth);
	const sampleRate = asNumber(candidate.maximum_sampling_rate);
	return (bitDepth !== undefined && bitDepth > 16) || (sampleRate !== undefined && sampleRate > 44.1);
}

function scoreCandidate(candidate: QobuzTrackCandidate, tidalTrack: Track): number {
	let score = 0;
	const title = normalizeText(candidate.title);
	const tidalTitle = normalizeText(tidalTrack.title);
	if (title && tidalTitle) {
		if (title === tidalTitle) score += 40;
		else if (title.includes(tidalTitle) || tidalTitle.includes(title)) score += 12;
	}

	const albumTitle = normalizeText(candidate.album?.title);
	const tidalAlbumTitle = normalizeText(tidalTrack.album?.title);
	if (albumTitle && tidalAlbumTitle) {
		if (albumTitle === tidalAlbumTitle) score += 30;
		else if (albumTitle.includes(tidalAlbumTitle) || tidalAlbumTitle.includes(albumTitle)) {
			score += 10;
		}
	}

	const performer = normalizeText(candidate.performer?.name);
	const tidalArtists = [
		tidalTrack.artist?.name,
		...(Array.isArray(tidalTrack.artists) ? tidalTrack.artists.map((artist) => artist.name) : [])
	].map(normalizeText);
	const artistMatches = tidalArtists.some(
		(artist) =>
			artist && (artist === performer || artist.includes(performer) || performer.includes(artist))
	);
	if (performer && artistMatches) {
		score += 20;
	}

	const duration = asNumber(candidate.duration);
	if (duration && tidalTrack.duration) {
		const delta = Math.abs(duration - tidalTrack.duration);
		if (delta <= 2) score += 25;
		else if (delta <= 5) score += 12;
		else if (delta <= 10) score += 4;
	}

	return score;
}

function pickBestCandidate(
	payload: QobuzSearchResponse,
	tidalTrack: Track,
	quality: AudioQuality
): QobuzTrackCandidate | null {
	const items = payload.data?.tracks?.items;
	if (!Array.isArray(items)) return null;
	const tidalIsrc = normalizeIsrc(tidalTrack.isrc);
	if (!tidalIsrc) return null;

	const candidates = items
		.filter((item): item is QobuzTrackCandidate => item !== null && typeof item === 'object')
		.filter((item) => normalizeIsrc(item.isrc) === tidalIsrc)
		.filter((item) => asTrackId(item.id) !== null)
		.filter((item) => candidateSupportsQuality(item, quality));

	if (candidates.length === 0) return null;
	return candidates
		.map((candidate) => ({ candidate, score: scoreCandidate(candidate, tidalTrack) }))
		.sort((a, b) => b.score - a.score)[0]?.candidate ?? null;
}

async function fetchJsonWithTimeout<T>(
	fetchImpl: FetchLike,
	url: string,
	timeoutMs: number,
	signal?: AbortSignal
): Promise<T> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	const abortFromParent = () => controller.abort(signal?.reason);
	if (signal) {
		if (signal.aborted) {
			controller.abort(signal.reason);
		} else {
			signal.addEventListener('abort', abortFromParent, { once: true });
		}
	}

	try {
		const response = await fetchImpl(url, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		return (await response.json()) as T;
	} finally {
		clearTimeout(timeoutId);
		signal?.removeEventListener('abort', abortFromParent);
	}
}

function buildFallbackLookup(
	tidalTrack: Track,
	qobuzTrack: QobuzTrackCandidate,
	streamUrl: string,
	quality: AudioQuality
): TrackLookup {
	const audioInfo = qobuzTrack.audio_info;
	const bitDepth = asNumber(qobuzTrack.maximum_bit_depth);
	const sampleRate = sampleRateToHz(qobuzTrack.maximum_sampling_rate);

	return {
		track: tidalTrack,
		info: {
			trackId: tidalTrack.id,
			audioMode: 'STEREO',
			audioQuality: quality,
			manifest: streamUrl,
			manifestMimeType: inferMimeType(quality),
			assetPresentation: 'FULL',
			bitDepth,
			sampleRate,
			trackReplayGain: asNumber(audioInfo?.replaygain_track_gain),
			trackPeakAmplitude: asNumber(audioInfo?.replaygain_track_peak),
			albumReplayGain: asNumber(audioInfo?.replaygain_album_gain),
			albumPeakAmplitude: asNumber(audioInfo?.replaygain_album_peak)
		},
		originalTrackUrl: streamUrl
	};
}

export async function resolveQobuzFallbackLookup(params: {
	track: Track;
	quality: AudioQuality;
	fetch?: FetchLike;
	signal?: AbortSignal;
}): Promise<TrackLookup | null> {
	if (!isQobuzFallbackEnabled()) return null;

	try {
		await refreshApiTargetsIfStale();
	} catch (error) {
		console.warn('[QobuzFallback] Target refresh failed; using current Qobuz targets', {
			error: error instanceof Error ? error.message : String(error)
		});
	}

	const isrc = normalizeIsrc(params.track.isrc);
	if (!isrc) return null;

	const fetchImpl = params.fetch ?? globalThis.fetch?.bind(globalThis);
	if (!fetchImpl) return null;

	const timeoutMs = parsePositiveInteger(
		getEnvValue('QOBUZ_FALLBACK_TIMEOUT_MS'),
		DEFAULT_QOBUZ_TIMEOUT_MS
	);
	const qualityCode = getQualityCode(params.quality);

	for (const baseUrl of getQobuzFallbackTargets()) {
		try {
			const searchUrl = `${baseUrl}/api/get-music?q=${encodeURIComponent(isrc)}&offset=0`;
			const searchPayload = await fetchJsonWithTimeout<QobuzSearchResponse>(
				fetchImpl,
				searchUrl,
				timeoutMs,
				params.signal
			);
			const candidate = pickBestCandidate(searchPayload, params.track, params.quality);
			const qobuzTrackId = candidate ? asTrackId(candidate.id) : null;
			if (!candidate || !qobuzTrackId) continue;

			const downloadUrl =
				`${baseUrl}/api/download-music?track_id=${encodeURIComponent(qobuzTrackId)}` +
				`&quality=${encodeURIComponent(qualityCode)}`;
			const downloadPayload = await fetchJsonWithTimeout<QobuzDownloadResponse>(
				fetchImpl,
				downloadUrl,
				timeoutMs,
				params.signal
			);
			const streamUrl = downloadPayload.data?.url;
			if (downloadPayload.success === false || typeof streamUrl !== 'string' || !streamUrl.trim()) {
				continue;
			}

			console.info('[QobuzFallback] Resolved full stream by ISRC', {
				trackId: params.track.id,
				isrc,
				quality: params.quality,
				instance: baseUrl,
				qobuzTrackId
			});
			return buildFallbackLookup(params.track, candidate, streamUrl.trim(), params.quality);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn('[QobuzFallback] Instance failed', {
				instance: baseUrl,
				trackId: params.track.id,
				isrc,
				error: message
			});
		}
	}

	return null;
}
