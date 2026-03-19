import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sanitizeDirName } from '$lib/server/download/shared';

export const AUDIO_EXTENSIONS = new Set([
	'.flac',
	'.mp3',
	'.m4a',
	'.aac',
	'.ogg',
	'.wav',
	'.alac',
	'.opus'
]);

const VARIOUS_ARTISTS_NAME = 'Various Artists';
export const VARIOUS_ARTISTS_DIR = sanitizeDirName(VARIOUS_ARTISTS_NAME);
export const VARIOUS_ARTISTS_KEY = normalizeKey(VARIOUS_ARTISTS_NAME);
const TRANSIENT_ALBUM_ARTIFACT_DIR_RE = /^\..+\.(publishing|backup)-[a-z0-9]/i;
const TRANSIENT_ALBUM_ARTIFACT_JOB_ID_RE = /job-\d+-[a-z0-9]+/i;
export const DEDUPE_SAMPLE_LIMIT = Math.max(
	1,
	Number(process.env.MEDIA_LIBRARY_DEDUPE_SAMPLE_LIMIT || 25)
);

export interface LocalMediaFile {
	path: string;
	relativePath: string;
	artistDir: string;
	albumDir: string;
	filename: string;
	extension: string;
	size: number;
	mtimeMs: number;
	sampleHash: string;
}

export interface LocalMediaSnapshot {
	scannedAt: number;
	baseDir: string;
	files: LocalMediaFile[];
}

export interface MediaLibraryArtistSuggestion {
	artistDir: string;
	artistName: string;
	trackCount: number;
	albumCount: number;
	searchQuery: string;
}

export interface MediaLibraryAlbumSuggestion {
	artistDir: string;
	artistName: string;
	albumDir: string;
	albumTitle: string;
	trackCount: number;
	searchQuery: string;
}

export interface AlbumIntegrityTrackInput {
	trackId: number;
	trackTitle?: string;
	trackNumber?: number;
	expectedDurationSeconds?: number;
}

export type AlbumIntegrityTrackStatus = 'healthy' | 'missing' | 'corrupt';

export interface AlbumIntegrityTrackResult extends AlbumIntegrityTrackInput {
	status: AlbumIntegrityTrackStatus;
	filePath?: string;
	relativePath?: string;
	reason?: string;
}

export interface AlbumIntegrityReport {
	scannedAt: number;
	totalFilesInAlbumDir: number;
	resolvedArtistDir?: string;
	resolvedAlbumDir?: string;
	tracks: AlbumIntegrityTrackResult[];
	summary: {
		expected: number;
		healthy: number;
		missing: number;
		corrupt: number;
	};
}

export interface MediaLibraryDedupeSummary {
	scannedAt: number;
	dryRun: boolean;
	runId?: string;
	albumsScanned: number;
	duplicateAlbumGroups: number;
	duplicateAlbumDirs: number;
	albumsMerged: number;
	filesMovedBetweenAlbums: number;
	filesMoveErrors: number;
	albumsWithTrackDuplicates: number;
	albumsSkipped: number;
	duplicateTrackGroups: number;
	manualReviewRequired: number;
	duplicateFilesBackedUp: number;
	backupErrors: number;
	movedSamples: string[];
	backedUpSamples: string[];
	skippedSamples: string[];
	failedSamples: string[];
	backupRoot?: string;
}

export interface MediaLibraryDedupeProgress {
	phase: 'scan' | 'merge' | 'track_dedupe' | 'complete';
	message: string;
	processed: number;
	total: number;
	currentArtistDir?: string;
	currentAlbumDir?: string;
	summary: MediaLibraryDedupeSummary;
}

export interface MediaLibraryTransientSweepSummary {
	scannedAt: number;
	baseDir: string;
	dryRun: boolean;
	minAgeMs: number;
	artistDirsScanned: number;
	artifactDirsFound: number;
	artifactDirsRemoved: number;
	skippedTooFresh: number;
	skippedActive: number;
	samplePaths: string[];
}

export type EmbeddedTags = {
	artistKey: string;
	albumArtistKey: string;
	albumKey: string;
	titleKey: string;
	trackNo?: number;
	discNo?: number;
};

export type AlbumLookupGroup = {
	artistDir: string;
	albumDir: string;
	files: LocalMediaFile[];
	albumComparable: string;
};

export type LibraryAlbumLookupIndex = {
	scannedAt: number;
	baseDir: string;
	files: LocalMediaFile[];
	groupsByPath: Map<string, AlbumLookupGroup>;
	groupsByAlbumDir: Map<string, AlbumLookupGroup[]>;
	groupsByComparableAlbum: Map<string, AlbumLookupGroup[]>;
	suggestions: {
		artists: MediaLibraryArtistSuggestion[];
		albums: MediaLibraryAlbumSuggestion[];
	};
};

export type AlbumDirGroup = {
	artistDir: string;
	albumDir: string;
	files: LocalMediaFile[];
};

export type AlbumStats = {
	fileCount: number;
	totalSize: number;
	uniqueTrackKeys: number;
	duplicateTrackCount: number;
};

export type DedupeFileCandidate = {
	path: string;
	filename: string;
	extension: string;
	size: number;
	trackKey: string | null;
};

export type EvaluatedDedupeFileCandidate = DedupeFileCandidate & {
	integrityState: 0 | 1 | 2;
	durationSeconds: number;
};

export function normalizeKey(value: string | undefined): string {
	return (value ?? '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

export function isTransientAlbumArtifactDirName(dirName: string | undefined): boolean {
	if (!dirName || typeof dirName !== 'string') {
		return false;
	}
	return TRANSIENT_ALBUM_ARTIFACT_DIR_RE.test(dirName);
}

export function parseTransientAlbumArtifactJobId(dirName: string | undefined): string | null {
	if (!dirName || typeof dirName !== 'string') {
		return null;
	}
	const match = dirName.match(TRANSIENT_ALBUM_ARTIFACT_JOB_ID_RE);
	return match?.[0] ?? null;
}

export function normalizeDirComparable(value: string | undefined): string {
	return (value ?? '')
		.toLowerCase()
		.replace(/[_:]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function makeAlbumGroupKey(artistDir: string, albumDir: string): string {
	return `${artistDir}\u0000${albumDir}`;
}

export function appendToMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const existing = map.get(key);
	if (existing) {
		existing.push(value);
		return;
	}
	map.set(key, [value]);
}

export function formatSuggestionLabel(dirName: string, fallback: string): string {
	const normalized = dirName.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
	return normalized.length > 0 ? normalized : fallback;
}

export function buildSearchQuery(artistName: string, albumTitle?: string): string {
	if (albumTitle && albumTitle.trim().length > 0) {
		return `${artistName} ${albumTitle}`.trim();
	}
	return artistName.trim();
}

export function stripExtension(filename: string): string {
	return filename.replace(/\.[^/.]+$/, '');
}

const DISC_TRACK_PREFIX_RE = /^\d{1,2}\s*[-_]\s*\d{1,2}\s*(?:-|\.|_)\s*/i;
const TRACK_PREFIX_RE = /^\d{1,3}\s*(?:-|\.|_)\s*/i;

export function stripTrackPrefix(value: string): string {
	return value.replace(DISC_TRACK_PREFIX_RE, '').replace(TRACK_PREFIX_RE, '').trim();
}

export function normalizeTrackFilename(filename: string): string {
	const stem = normalizeKey(stripExtension(filename));
	return normalizeKey(stripTrackPrefix(stem));
}

export function parseTrackOrderKey(filename: string): string | null {
	const stem = stripExtension(filename).trim();
	const discTrackMatch = /^(\d{1,2})\s*[-_]\s*(\d{1,2})\s*(?:-|\.|_)\s*/.exec(stem);
	if (discTrackMatch?.[1] && discTrackMatch?.[2]) {
		const disc = Number.parseInt(discTrackMatch[1], 10);
		const track = Number.parseInt(discTrackMatch[2], 10);
		if (Number.isFinite(disc) && disc > 0 && Number.isFinite(track) && track > 0) {
			return `${String(disc).padStart(2, '0')}${String(track).padStart(2, '0')}`;
		}
	}
	const compactTrackMatch = /^(\d{2,3})\s*(?:-|\.|_)\s*/.exec(stem);
	if (compactTrackMatch?.[1]) {
		const raw = compactTrackMatch[1];
		if (raw.length >= 3) {
			return raw.padStart(3, '0');
		}
		return raw.padStart(2, '0');
	}
	const trackOnlyMatch = /^(\d{1,3})\s*(?:-|\.|_)\s*/.exec(stem);
	if (trackOnlyMatch?.[1]) {
		return trackOnlyMatch[1].padStart(2, '0');
	}
	return null;
}

export function hasTrackDuplicates(files: LocalMediaFile[]): boolean {
	const seen = new Set<string>();
	for (const file of files) {
		const key = parseTrackOrderKey(file.filename);
		if (!key) {
			continue;
		}
		if (seen.has(key)) {
			return true;
		}
		seen.add(key);
	}
	return false;
}

export function parseTrackNumberFromFilename(filename: string): number | undefined {
	const stem = stripExtension(filename).trim();
	const discTrackMatch = /^(\d{1,2})\s*[-_]\s*(\d{1,2})\s*(?:-|\.|_)\s*/.exec(stem);
	if (discTrackMatch?.[2]) {
		const parsed = Number.parseInt(discTrackMatch[2], 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
	}
	const trackOnlyMatch = /^(\d{1,3})\s*(?:-|\.|_)\s*/.exec(stem);
	if (trackOnlyMatch?.[1]) {
		const parsed = Number.parseInt(trackOnlyMatch[1], 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
	}
	return undefined;
}

export function keysLooselyMatch(a: string, b: string): boolean {
	if (!a || !b) return false;
	return a === b || a.includes(b) || b.includes(a);
}

export async function mapWithConcurrency<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>
): Promise<void> {
	if (items.length === 0) return;
	const limit = Math.max(1, Math.min(concurrency, items.length));
	let nextIndex = 0;

	const runners = Array.from({ length: limit }, async () => {
		while (true) {
			const index = nextIndex++;
			if (index >= items.length) return;
			await worker(items[index]);
		}
	});

	await Promise.all(runners);
}

export function toPositiveInt(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return Math.trunc(value);
	}
	return undefined;
}

export async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

export function uniquePathSuffix(name: string, index: number): string {
	const parsed = path.parse(name);
	return `${parsed.name} (${index})${parsed.ext}`;
}

export async function ensureUniquePath(directory: string, name: string): Promise<string> {
	let attempt = 0;
	let candidate = path.join(directory, name);
	while (await pathExists(candidate)) {
		attempt += 1;
		candidate = path.join(directory, uniquePathSuffix(name, attempt));
	}
	return candidate;
}

export function pushSample(
	list: string[],
	value: string,
	maxSamples = DEDUPE_SAMPLE_LIMIT
): void {
	if (list.length >= maxSamples) {
		return;
	}
	list.push(value);
}

export function summarizeAlbumGroup(files: LocalMediaFile[]): AlbumStats {
	const trackKeys = new Set<string>();
	let totalSize = 0;
	for (const file of files) {
		totalSize += file.size;
		const trackKey = parseTrackOrderKey(file.filename);
		if (trackKey) {
			trackKeys.add(trackKey);
		}
	}
	const fileCount = files.length;
	const uniqueTrackKeys = trackKeys.size;
	return {
		fileCount,
		totalSize,
		uniqueTrackKeys,
		duplicateTrackCount: Math.max(0, fileCount - uniqueTrackKeys)
	};
}

export function compareAlbumGroupPriority(a: AlbumDirGroup, b: AlbumDirGroup): number {
	const aStats = summarizeAlbumGroup(a.files);
	const bStats = summarizeAlbumGroup(b.files);
	if (aStats.uniqueTrackKeys !== bStats.uniqueTrackKeys) {
		return bStats.uniqueTrackKeys - aStats.uniqueTrackKeys;
	}
	if (aStats.duplicateTrackCount !== bStats.duplicateTrackCount) {
		return aStats.duplicateTrackCount - bStats.duplicateTrackCount;
	}
	if (aStats.fileCount !== bStats.fileCount) {
		return bStats.fileCount - aStats.fileCount;
	}
	if (aStats.totalSize !== bStats.totalSize) {
		return bStats.totalSize - aStats.totalSize;
	}
	return a.albumDir.localeCompare(b.albumDir);
}

export function chooseCanonicalAlbumGroup(groups: AlbumDirGroup[]): AlbumDirGroup {
	const sorted = [...groups].sort(compareAlbumGroupPriority);
	return sorted[0];
}
