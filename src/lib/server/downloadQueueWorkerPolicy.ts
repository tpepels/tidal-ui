import * as path from 'path';
import type { AudioQuality } from '$lib/types';
import type { ErrorCategory, QueuedJob } from './downloadQueueTypes';

export type ExpectedAlbumTrack = {
	trackId: number;
	trackTitle: string;
	trackNumber: number;
};

type WorkerFailureInput = {
	errorCategory?: ErrorCategory;
	error?: string;
	retryable?: boolean;
};

const QUALITY_FALLBACK_CHAIN: Record<AudioQuality, AudioQuality[]> = {
	HI_RES_LOSSLESS: ['LOSSLESS', 'HIGH', 'LOW'],
	LOSSLESS: ['HIGH', 'LOW'],
	HIGH: ['LOW'],
	LOW: []
};

export function formatMegabytes(bytes: number | undefined): string {
	if (!Number.isFinite(bytes) || !bytes) return '0 MB';
	const mb = (bytes as number) / (1024 * 1024);
	return `${mb.toFixed(2)} MB`;
}

export function rotateTargets<T>(targets: T[], offset: number): T[] {
	if (targets.length === 0) return targets;
	const shift = ((offset % targets.length) + targets.length) % targets.length;
	return [...targets.slice(shift), ...targets.slice(0, shift)];
}

export function resolveNextFallbackQuality(
	current: AudioQuality,
	history: AudioQuality[] | undefined
): AudioQuality | null {
	const tried = new Set<AudioQuality>(history ?? []);
	const candidates = QUALITY_FALLBACK_CHAIN[current] ?? [];
	for (const candidate of candidates) {
		if (!tried.has(candidate)) {
			return candidate;
		}
	}
	return null;
}

export function shouldAttemptQualityFallback(
	result: WorkerFailureInput,
	downloadEnableQualityFallback: boolean
): boolean {
	if (!downloadEnableQualityFallback) return false;
	if (result.retryable) return false;
	if (result.errorCategory === 'not_found') return true;
	const message = (result.error ?? '').toLowerCase();
	return (
		message.includes('quality') ||
		message.includes('manifest') ||
		message.includes('unsupported') ||
		message.includes('unavailable')
	);
}

export function isDefinitiveExternalTrackFailure(result: WorkerFailureInput): boolean {
	if (result.retryable === true) return false;
	const category = result.errorCategory;
	if (category === 'auth' || category === 'not_found') {
		return true;
	}

	const message = (result.error ?? '').toLowerCase();
	return (
		message.includes('permission denied') ||
		message.includes('eacces') ||
		message.includes('enospc') ||
		message.includes('no space left') ||
		message.includes('disk space') ||
		message.includes('invalid track id') ||
		message.includes('unauthorized') ||
		message.includes('forbidden') ||
		message.includes('quality unavailable') ||
		message.includes('manifest unavailable') ||
		message.includes('unsupported quality') ||
		message.includes('not found')
	);
}

export function isAlbumCategoryRetryable(category: ErrorCategory | undefined): boolean {
	return (
		category === 'network' ||
		category === 'rate_limit' ||
		category === 'server_error' ||
		category === 'unknown'
	);
}

export function deriveFailureCode(category: ErrorCategory | undefined, message: string): string {
	const lower = message.toLowerCase();
	if (lower.includes('integrity') || lower.includes('ffprobe') || lower.includes('decode')) {
		return 'INTEGRITY_VALIDATION_FAILED';
	}
	if (lower.includes('enospc') || lower.includes('disk full') || lower.includes('no space left')) {
		return 'DISK_FULL';
	}
	if (lower.includes('permission') || lower.includes('eacces')) {
		return 'PERMISSION_DENIED';
	}
	if (lower.includes('album removed due external error')) {
		return 'ALBUM_EXTERNAL_ABORT';
	}
	if (lower.includes('reconciliation') || lower.includes('missing track')) {
		return 'ALBUM_RECONCILIATION_MISSING_TRACKS';
	}
	if (category === 'rate_limit') return 'UPSTREAM_RATE_LIMITED';
	if (category === 'network' && lower.includes('timeout')) return 'UPSTREAM_TIMEOUT';
	if (category === 'network') return 'UPSTREAM_NETWORK';
	if (category === 'auth') return 'UPSTREAM_AUTH';
	if (category === 'not_found') return 'UPSTREAM_NOT_FOUND';
	if (category === 'server_error') return 'UPSTREAM_SERVER_ERROR';
	if (category === 'api_error') return 'UPSTREAM_API_ERROR';
	return 'UNKNOWN';
}

export function resetTrackProgressForAlbumRetry(
	trackProgress: QueuedJob['trackProgress']
): QueuedJob['trackProgress'] | undefined {
	if (!Array.isArray(trackProgress)) return undefined;
	return trackProgress.map((track) => ({
		...track,
		status: 'pending',
		error: undefined
	}));
}

export function findMissingPublishedTracks(params: {
	expectedTracks: ExpectedAlbumTrack[];
	expectedFileByTrackId: Map<number, string>;
	publishedFiles: Set<string>;
}): ExpectedAlbumTrack[] {
	const hasTrackNumberFallbackMatch = (filename: string, trackNumber: number): boolean => {
		const parsed = path.parse(filename);
		const stem = parsed.name.trim();
		const normalizedTrackNumber = Math.trunc(trackNumber);
		if (!Number.isFinite(normalizedTrackNumber) || normalizedTrackNumber <= 0) {
			return false;
		}
		const plainPrefix = String(normalizedTrackNumber);
		const paddedPrefix = plainPrefix.padStart(2, '0');
		const matcher = new RegExp(`^(?:${paddedPrefix}|${plainPrefix})\\s*(?:-|\\.)\\s*`, 'i');
		return matcher.test(stem);
	};

	const missing: ExpectedAlbumTrack[] = [];
	for (const track of params.expectedTracks) {
		const expectedFile = params.expectedFileByTrackId.get(track.trackId);
		if (expectedFile) {
			if (!params.publishedFiles.has(expectedFile)) {
				missing.push(track);
			}
			continue;
		}
		const hasFallbackMatch = [...params.publishedFiles].some((name) =>
			hasTrackNumberFallbackMatch(name, track.trackNumber)
		);
		if (!hasFallbackMatch) {
			missing.push(track);
		}
	}
	return missing;
}
