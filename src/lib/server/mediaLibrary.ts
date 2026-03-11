import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parseFile } from 'music-metadata';
import {
	getDownloadDir,
	getTempDir,
	moveFile,
	sanitizeDirName
} from '../../routes/api/download-track/_shared';
import { validateAudioFileIntegrity } from './download/audioIntegrity';

const AUDIO_EXTENSIONS = new Set([
	'.flac',
	'.mp3',
	'.m4a',
	'.aac',
	'.ogg',
	'.wav',
	'.alac',
	'.opus'
]);

const LIBRARY_SCAN_CACHE_TTL_MS = Math.max(
	5_000,
	Number(process.env.MEDIA_LIBRARY_CACHE_TTL_MS || 30_000)
);
const HASH_SAMPLE_BYTES = Math.max(
	0,
	Number(process.env.MEDIA_LIBRARY_HASH_SAMPLE_BYTES || 0)
);
const EMBEDDED_TAG_CACHE_TTL_MS = Math.max(
	5_000,
	Number(process.env.MEDIA_LIBRARY_EMBEDDED_TAG_CACHE_TTL_MS || 10 * 60 * 1000)
);

const VARIOUS_ARTISTS_NAME = 'Various Artists';
const VARIOUS_ARTISTS_DIR = sanitizeDirName(VARIOUS_ARTISTS_NAME);
const VARIOUS_ARTISTS_KEY = normalizeKey(VARIOUS_ARTISTS_NAME);
const TRANSIENT_ALBUM_ARTIFACT_DIR_RE = /^\..+\.(publishing|backup)-[a-z0-9]/i;
const TRANSIENT_ALBUM_ARTIFACT_JOB_ID_RE = /job-\d+-[a-z0-9]+/i;
const TRANSIENT_SWEEP_MIN_AGE_MS = Math.max(
	0,
	Number(process.env.MEDIA_LIBRARY_TRANSIENT_SWEEP_MIN_AGE_MS || 30 * 60 * 1000)
);
const DEDUPE_SAMPLE_LIMIT = Math.max(
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

type EmbeddedTags = {
	artistKey: string;
	albumArtistKey: string;
	albumKey: string;
	titleKey: string;
	trackNo?: number;
	discNo?: number;
};

type AlbumLookupGroup = {
	artistDir: string;
	albumDir: string;
	files: LocalMediaFile[];
	albumComparable: string;
};

type LibraryAlbumLookupIndex = {
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

let scanCache: { expiresAt: number; snapshot: LocalMediaSnapshot } | null = null;
let albumLookupCache: {
	expiresAt: number;
	scannedAt: number;
	baseDir: string;
	index: LibraryAlbumLookupIndex;
} | null = null;
const embeddedTagCache = new Map<
	string,
	{
		expiresAt: number;
		mtimeMs: number;
		size: number;
		tags: EmbeddedTags | null;
	}
>();

function normalizeKey(value: string | undefined): string {
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

function normalizeDirComparable(value: string | undefined): string {
	return (value ?? '')
		.toLowerCase()
		.replace(/[_:]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function makeAlbumGroupKey(artistDir: string, albumDir: string): string {
	return `${artistDir}\u0000${albumDir}`;
}

function appendToMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const existing = map.get(key);
	if (existing) {
		existing.push(value);
		return;
	}
	map.set(key, [value]);
}

function formatSuggestionLabel(dirName: string, fallback: string): string {
	const normalized = dirName.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
	return normalized.length > 0 ? normalized : fallback;
}

function buildSearchQuery(artistName: string, albumTitle?: string): string {
	if (albumTitle && albumTitle.trim().length > 0) {
		return `${artistName} ${albumTitle}`.trim();
	}
	return artistName.trim();
}

function buildLibraryAlbumLookupIndex(snapshot: LocalMediaSnapshot): LibraryAlbumLookupIndex {
	const groupsByPath = new Map<string, AlbumLookupGroup>();
	for (const file of snapshot.files) {
		const artistDir = file.artistDir || 'Unknown Artist';
		const albumDir = file.albumDir || 'Unknown Album';
		const key = makeAlbumGroupKey(artistDir, albumDir);
		const existing = groupsByPath.get(key);
		if (existing) {
			existing.files.push(file);
			continue;
		}
		groupsByPath.set(key, {
			artistDir,
			albumDir,
			files: [file],
			albumComparable: normalizeDirComparable(albumDir)
		});
	}

	const groupsByAlbumDir = new Map<string, AlbumLookupGroup[]>();
	const groupsByComparableAlbum = new Map<string, AlbumLookupGroup[]>();
	const artistStats = new Map<string, { trackCount: number; albumDirs: Set<string> }>();

	for (const group of groupsByPath.values()) {
		appendToMapArray(groupsByAlbumDir, group.albumDir, group);
		if (group.albumComparable.length > 0) {
			appendToMapArray(groupsByComparableAlbum, group.albumComparable, group);
		}

		const stats = artistStats.get(group.artistDir);
		if (stats) {
			stats.trackCount += group.files.length;
			stats.albumDirs.add(group.albumDir);
			continue;
		}
		artistStats.set(group.artistDir, {
			trackCount: group.files.length,
			albumDirs: new Set([group.albumDir])
		});
	}

	const artists = Array.from(artistStats.entries())
		.map(([artistDir, stats]) => {
			const artistName = formatSuggestionLabel(artistDir, 'Unknown Artist');
			return {
				artistDir,
				artistName,
				trackCount: stats.trackCount,
				albumCount: stats.albumDirs.size,
				searchQuery: buildSearchQuery(artistName)
			} satisfies MediaLibraryArtistSuggestion;
		})
		.sort((a, b) => {
			if (b.trackCount !== a.trackCount) {
				return b.trackCount - a.trackCount;
			}
			if (b.albumCount !== a.albumCount) {
				return b.albumCount - a.albumCount;
			}
			return a.artistName.localeCompare(b.artistName);
		});

	const albums = Array.from(groupsByPath.values())
		.map((group) => {
			const artistName = formatSuggestionLabel(group.artistDir, 'Unknown Artist');
			const albumTitle = formatSuggestionLabel(group.albumDir, 'Unknown Album');
			return {
				artistDir: group.artistDir,
				artistName,
				albumDir: group.albumDir,
				albumTitle,
				trackCount: group.files.length,
				searchQuery: buildSearchQuery(artistName, albumTitle)
			} satisfies MediaLibraryAlbumSuggestion;
		})
		.sort((a, b) => {
			if (b.trackCount !== a.trackCount) {
				return b.trackCount - a.trackCount;
			}
			const artistCompare = a.artistName.localeCompare(b.artistName);
			if (artistCompare !== 0) {
				return artistCompare;
			}
			return a.albumTitle.localeCompare(b.albumTitle);
		});

	return {
		scannedAt: snapshot.scannedAt,
		baseDir: snapshot.baseDir,
		files: snapshot.files,
		groupsByPath,
		groupsByAlbumDir,
		groupsByComparableAlbum,
		suggestions: {
			artists,
			albums
		}
	};
}

function stripExtension(filename: string): string {
	return filename.replace(/\.[^/.]+$/, '');
}

const DISC_TRACK_PREFIX_RE = /^\d{1,2}\s*[-_]\s*\d{1,2}\s*(?:-|\.|_)\s*/i;
const TRACK_PREFIX_RE = /^\d{1,3}\s*(?:-|\.|_)\s*/i;

function stripTrackPrefix(value: string): string {
	return value.replace(DISC_TRACK_PREFIX_RE, '').replace(TRACK_PREFIX_RE, '').trim();
}

function normalizeTrackFilename(filename: string): string {
	const stem = normalizeKey(stripExtension(filename));
	return normalizeKey(stripTrackPrefix(stem));
}

function parseTrackOrderKey(filename: string): string | null {
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

function hasTrackDuplicates(files: LocalMediaFile[]): boolean {
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

function parseTrackNumberFromFilename(filename: string): number | undefined {
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

async function parseTrackOrderKeyFromEmbeddedTags(filePath: string): Promise<string | null> {
	try {
		const metadata = await parseFile(filePath, { duration: false, skipCovers: true });
		const discNo = toPositiveInt(metadata.common.disk?.no);
		const trackNo = toPositiveInt(metadata.common.track?.no);
		if (!trackNo) {
			return null;
		}
		if (discNo) {
			return `${String(discNo).padStart(2, '0')}${String(trackNo).padStart(2, '0')}`;
		}
		return String(trackNo).padStart(2, '0');
	} catch {
		return null;
	}
}

function keysLooselyMatch(a: string, b: string): boolean {
	if (!a || !b) return false;
	return a === b || a.includes(b) || b.includes(a);
}

async function scoreAlbumTrackCandidate(
	file: LocalMediaFile,
	expected: AlbumIntegrityTrackInput
): Promise<number> {
	const titleKey = normalizeKey(expected.trackTitle);
	const expectedTrackNo = toPositiveInt(expected.trackNumber);
	const tags = await getEmbeddedTags(file);
	const filenameTrackNo = parseTrackNumberFromFilename(file.filename);
	const filenameTrackKey = normalizeTrackFilename(file.filename);

	let score = 0;
	if (expectedTrackNo && tags?.trackNo === expectedTrackNo) {
		score += 100;
	}
	if (expectedTrackNo && filenameTrackNo === expectedTrackNo) {
		score += 80;
	}
	if (titleKey.length > 0 && tags?.titleKey && keysLooselyMatch(tags.titleKey, titleKey)) {
		score += tags.titleKey === titleKey ? 70 : 45;
	}
	if (titleKey.length > 0 && keysLooselyMatch(filenameTrackKey, titleKey)) {
		score += filenameTrackKey === titleKey ? 60 : 35;
	}

	return score;
}

async function mapWithConcurrency<T>(
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

function toPositiveInt(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return Math.trunc(value);
	}
	return undefined;
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

export async function sweepTransientAlbumArtifacts(options?: {
	baseDir?: string;
	dryRun?: boolean;
	maxSamples?: number;
	minAgeMs?: number;
	activeJobIds?: Iterable<string>;
	nowMs?: number;
}): Promise<MediaLibraryTransientSweepSummary> {
	const baseDir = options?.baseDir ?? getDownloadDir();
	const dryRun = options?.dryRun === true;
	const maxSamples = Math.max(0, Number(options?.maxSamples ?? 25));
	const minAgeMs = Math.max(0, Number(options?.minAgeMs ?? TRANSIENT_SWEEP_MIN_AGE_MS));
	const nowMs = Number.isFinite(options?.nowMs) ? Number(options?.nowMs) : Date.now();
	const activeJobIds = new Set<string>(
		Array.from(options?.activeJobIds ?? [])
			.map((value) => String(value).trim())
			.filter((value) => value.length > 0)
	);
	const summary: MediaLibraryTransientSweepSummary = {
		scannedAt: Date.now(),
		baseDir,
		dryRun,
		minAgeMs,
		artistDirsScanned: 0,
		artifactDirsFound: 0,
		artifactDirsRemoved: 0,
		skippedTooFresh: 0,
		skippedActive: 0,
		samplePaths: []
	};

	let artistEntries: Dirent[];
	try {
		artistEntries = await fs.readdir(baseDir, { withFileTypes: true });
	} catch {
		return summary;
	}

	for (const artistEntry of artistEntries) {
		if (!artistEntry.isDirectory()) {
			continue;
		}
		summary.artistDirsScanned += 1;
		const artistPath = path.join(baseDir, artistEntry.name);
		let albumEntries: Dirent[];
		try {
			albumEntries = await fs.readdir(artistPath, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const albumEntry of albumEntries) {
			if (!albumEntry.isDirectory()) {
				continue;
			}
			if (!isTransientAlbumArtifactDirName(albumEntry.name)) {
				continue;
			}

			summary.artifactDirsFound += 1;
			const relativePath = `${artistEntry.name}/${albumEntry.name}`;
			if (summary.samplePaths.length < maxSamples) {
				summary.samplePaths.push(relativePath);
			}

			const targetPath = path.join(artistPath, albumEntry.name);
			const artifactJobId = parseTransientAlbumArtifactJobId(albumEntry.name);
			if (artifactJobId && activeJobIds.has(artifactJobId)) {
				summary.skippedActive += 1;
				continue;
			}
			const artifactStat = await fs.stat(targetPath).catch(() => null);
			if (artifactStat) {
				const artifactAgeMs = Math.max(0, nowMs - artifactStat.mtimeMs);
				if (artifactAgeMs < minAgeMs) {
					summary.skippedTooFresh += 1;
					continue;
				}
			}

			if (dryRun) {
				continue;
			}

			try {
				await fs.rm(targetPath, { recursive: true, force: true });
				summary.artifactDirsRemoved += 1;
			} catch (error) {
				console.warn(
					'[Media Library Sweep] Failed to remove transient album artifact directory',
					JSON.stringify({
						path: targetPath,
						error: error instanceof Error ? error.message : String(error)
					})
				);
			}
		}
	}

	if (summary.artifactDirsRemoved > 0) {
		clearMediaLibraryScanCache();
	}

	return summary;
}

function uniquePathSuffix(name: string, index: number): string {
	const parsed = path.parse(name);
	return `${parsed.name} (${index})${parsed.ext}`;
}

async function ensureUniquePath(directory: string, name: string): Promise<string> {
	let attempt = 0;
	let candidate = path.join(directory, name);
	while (await pathExists(candidate)) {
		attempt += 1;
		candidate = path.join(directory, uniquePathSuffix(name, attempt));
	}
	return candidate;
}

function pushSample(list: string[], value: string, maxSamples = DEDUPE_SAMPLE_LIMIT): void {
	if (list.length >= maxSamples) {
		return;
	}
	list.push(value);
}

const AUDIO_EXTENSION_RANK: Record<string, number> = {
	'.flac': 600,
	'.alac': 550,
	'.wav': 520,
	'.m4a': 500,
	'.mp4': 480,
	'.aac': 450,
	'.ogg': 430,
	'.opus': 420,
	'.mp3': 400
};

async function hashSample(filePath: string): Promise<string> {
	if (HASH_SAMPLE_BYTES <= 0) {
		return '';
	}
	const handle = await fs.open(filePath, 'r');
	try {
		const stats = await handle.stat();
		const size = Math.min(stats.size, HASH_SAMPLE_BYTES);
		if (size <= 0) {
			return '';
		}
		const buffer = Buffer.alloc(size);
		await handle.read(buffer, 0, size, 0);
		return createHash('sha1').update(buffer).digest('hex');
	} finally {
		await handle.close().catch(() => {});
	}
}

async function collectAudioFiles(baseDir: string): Promise<LocalMediaFile[]> {
	const results: LocalMediaFile[] = [];

	async function walk(currentDir: string, relativeSegments: string[]): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await fs.readdir(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const nextPath = path.join(currentDir, entry.name);
			const nextSegments = [...relativeSegments, entry.name];
			if (entry.isDirectory()) {
				if (isTransientAlbumArtifactDirName(entry.name)) {
					continue;
				}
				await walk(nextPath, nextSegments);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			const extension = path.extname(entry.name).toLowerCase();
			if (!AUDIO_EXTENSIONS.has(extension)) {
				continue;
			}

			const stats = await fs.stat(nextPath).catch(() => null);
			if (!stats) {
				continue;
			}

			const relativePath = nextSegments.join('/');
			const artistDir = relativeSegments[0] ?? '';
			const albumDir = relativeSegments[1] ?? '';
			results.push({
				path: nextPath,
				relativePath,
				artistDir,
				albumDir,
				filename: entry.name,
				extension,
				size: stats.size,
				mtimeMs: stats.mtimeMs,
				sampleHash: await hashSample(nextPath)
			});
		}
	}

	await walk(baseDir, []);
	return results;
}

async function getEmbeddedTags(file: LocalMediaFile): Promise<EmbeddedTags | null> {
	const now = Date.now();
	const cached = embeddedTagCache.get(file.path);
	if (
		cached &&
		cached.expiresAt > now &&
		cached.mtimeMs === file.mtimeMs &&
		cached.size === file.size
	) {
		return cached.tags;
	}

	try {
		const metadata = await parseFile(file.path, { duration: false, skipCovers: true });
		const common = metadata.common ?? {};
		const tags: EmbeddedTags = {
			artistKey: normalizeKey(common.artist ?? common.artists?.[0]),
			albumArtistKey: normalizeKey(common.albumartist),
			albumKey: normalizeKey(common.album),
			titleKey: normalizeKey(common.title),
			trackNo: toPositiveInt(common.track?.no),
			discNo: toPositiveInt(common.disk?.no)
		};
		const hasAnyTag =
			tags.artistKey.length > 0 ||
			tags.albumArtistKey.length > 0 ||
			tags.albumKey.length > 0 ||
			tags.titleKey.length > 0;
		const result = hasAnyTag ? tags : null;
		embeddedTagCache.set(file.path, {
			expiresAt: now + EMBEDDED_TAG_CACHE_TTL_MS,
			mtimeMs: file.mtimeMs,
			size: file.size,
			tags: result
		});
		return result;
	} catch {
		embeddedTagCache.set(file.path, {
			expiresAt: now + EMBEDDED_TAG_CACHE_TTL_MS,
			mtimeMs: file.mtimeMs,
			size: file.size,
			tags: null
		});
		return null;
	}
}

function selectLargestAlbumGroup(files: LocalMediaFile[]): LocalMediaFile[] {
	if (files.length <= 1) return files;
	const grouped = new Map<string, LocalMediaFile[]>();
	for (const file of files) {
		const key = `${file.artistDir}::${file.albumDir}`;
		const existing = grouped.get(key);
		if (existing) {
			existing.push(file);
			continue;
		}
		grouped.set(key, [file]);
	}
	let best: LocalMediaFile[] = [];
	for (const group of grouped.values()) {
		if (group.length > best.length) {
			best = group;
		}
	}
	return best.length > 0 ? best : files;
}

async function resolveAlbumMatches(
	files: LocalMediaFile[],
	input: {
		artistName?: string;
		albumTitle?: string;
		targetArtistDir?: string;
		targetAlbumDir?: string;
	},
	index?: LibraryAlbumLookupIndex
): Promise<LocalMediaFile[]> {
	const overrideArtistDir =
		typeof input.targetArtistDir === 'string' && input.targetArtistDir.trim().length > 0
			? input.targetArtistDir.trim()
			: undefined;
	const overrideAlbumDir =
		typeof input.targetAlbumDir === 'string' && input.targetAlbumDir.trim().length > 0
			? input.targetAlbumDir.trim()
			: undefined;
	const expectedArtistDir = overrideArtistDir ?? sanitizeDirName(input.artistName || 'Unknown Artist');
	const expectedAlbumDir = overrideAlbumDir ?? sanitizeDirName(input.albumTitle || 'Unknown Album');
	const expectedArtistKey = normalizeKey(input.artistName);
	const expectedAlbumKey = normalizeKey(input.albumTitle);
	const expectedArtistComparable = normalizeDirComparable(overrideArtistDir ?? input.artistName);
	const expectedAlbumComparable = normalizeDirComparable(overrideAlbumDir ?? input.albumTitle);

	const primaryPathMatches =
		index?.groupsByPath.get(makeAlbumGroupKey(expectedArtistDir, expectedAlbumDir))?.files ??
		files.filter((file) => file.artistDir === expectedArtistDir && file.albumDir === expectedAlbumDir);
	if (primaryPathMatches.length > 0) {
		return primaryPathMatches;
	}

	// Compilations are commonly filed under "Various Artists/Album Name".
	if (expectedArtistDir !== VARIOUS_ARTISTS_DIR) {
		const compilationPathMatches =
			index?.groupsByPath.get(makeAlbumGroupKey(VARIOUS_ARTISTS_DIR, expectedAlbumDir))?.files ??
			files.filter((file) => file.artistDir === VARIOUS_ARTISTS_DIR && file.albumDir === expectedAlbumDir);
		if (compilationPathMatches.length > 0) {
			return compilationPathMatches;
		}
	}

	if (expectedAlbumComparable) {
		const comparableCandidates = index
			? (index.groupsByComparableAlbum.get(expectedAlbumComparable) ?? []).flatMap(
					(group) => group.files
				)
			: files;
		const normalizedDirMatches = comparableCandidates.filter((file) => {
			if (!index) {
				const albumMatches = normalizeDirComparable(file.albumDir) === expectedAlbumComparable;
				if (!albumMatches) return false;
			}
			if (!expectedArtistComparable) return true;
			return (
				normalizeDirComparable(file.artistDir) === expectedArtistComparable ||
				file.artistDir === VARIOUS_ARTISTS_DIR
			);
		});
		if (normalizedDirMatches.length > 0) {
			return selectLargestAlbumGroup(normalizedDirMatches);
		}
	}

	// Final fallback: use embedded metadata for album + artist identification.
	if (!expectedAlbumKey) {
		return [];
	}
	const indexedExactCandidates = (index?.groupsByAlbumDir.get(expectedAlbumDir) ?? []).flatMap(
		(group) => group.files
	);
	const indexedComparableCandidates =
		expectedAlbumComparable.length > 0
			? (index?.groupsByComparableAlbum.get(expectedAlbumComparable) ?? []).flatMap(
					(group) => group.files
				)
			: [];
	const albumDirCandidates = index
		? indexedExactCandidates.length > 0
			? indexedExactCandidates
			: indexedComparableCandidates
		: files.filter(
				(file) =>
					file.albumDir === expectedAlbumDir ||
					(expectedAlbumComparable.length > 0 &&
						normalizeDirComparable(file.albumDir) === expectedAlbumComparable)
			);
	if (albumDirCandidates.length === 0) {
		return [];
	}

	const metadataMatches: LocalMediaFile[] = [];
	for (const file of albumDirCandidates) {
		const tags = await getEmbeddedTags(file);
		if (!tags) continue;
		if (tags.albumKey !== expectedAlbumKey) continue;
		if (expectedArtistKey.length === 0) {
			metadataMatches.push(file);
			continue;
		}
		if (
			tags.artistKey === expectedArtistKey ||
			tags.albumArtistKey === expectedArtistKey ||
			tags.albumArtistKey === VARIOUS_ARTISTS_KEY
		) {
			metadataMatches.push(file);
		}
	}

	return selectLargestAlbumGroup(metadataMatches);
}

export async function scanLocalMediaLibrary(options?: {
	force?: boolean;
}): Promise<LocalMediaSnapshot> {
	if (!options?.force && scanCache && scanCache.expiresAt > Date.now()) {
		return scanCache.snapshot;
	}

	const baseDir = getDownloadDir();
	await fs.mkdir(baseDir, { recursive: true });
	const files = await collectAudioFiles(baseDir);
	const snapshot: LocalMediaSnapshot = {
		scannedAt: Date.now(),
		baseDir,
		files
	};
	scanCache = {
		expiresAt: Date.now() + LIBRARY_SCAN_CACHE_TTL_MS,
		snapshot
	};
	return snapshot;
}

async function getLibraryAlbumLookupIndex(options?: {
	force?: boolean;
}): Promise<LibraryAlbumLookupIndex> {
	const snapshot = await scanLocalMediaLibrary({ force: options?.force });
	const now = Date.now();

	if (
		!options?.force &&
		albumLookupCache &&
		albumLookupCache.expiresAt > now &&
		albumLookupCache.scannedAt === snapshot.scannedAt &&
		albumLookupCache.baseDir === snapshot.baseDir
	) {
		return albumLookupCache.index;
	}

	const index = buildLibraryAlbumLookupIndex(snapshot);
	const expiresAt = scanCache?.expiresAt ?? now + LIBRARY_SCAN_CACHE_TTL_MS;
	albumLookupCache = {
		expiresAt,
		scannedAt: snapshot.scannedAt,
		baseDir: snapshot.baseDir,
		index
	};
	return index;
}

export async function checkAlbumInLibrary(input: {
	artistName?: string;
	albumTitle?: string;
	expectedTrackCount?: number;
	force?: boolean;
}): Promise<{ exists: boolean; matchedTracks: number; samplePaths: string[] }> {
	const index = await getLibraryAlbumLookupIndex({ force: input.force });
	const matches = await resolveAlbumMatches(index.files, {
		artistName: input.artistName,
		albumTitle: input.albumTitle
	}, index);
	const matchedTracks = matches.length;
	const expectedTrackCount =
		typeof input.expectedTrackCount === 'number' && input.expectedTrackCount > 0
			? input.expectedTrackCount
			: undefined;
	const exists = expectedTrackCount ? matchedTracks >= expectedTrackCount : matchedTracks > 0;
	return {
		exists,
		matchedTracks,
		samplePaths: matches.slice(0, 3).map((entry) => entry.relativePath)
	};
}

export async function checkTrackInLibrary(input: {
	artistName?: string;
	albumTitle?: string;
	trackTitle?: string;
	force?: boolean;
}): Promise<{ exists: boolean; matches: LocalMediaFile[] }> {
	const snapshot = await scanLocalMediaLibrary({ force: input.force });
	const titleKey = normalizeKey(input.trackTitle);
	const expectedArtistDir = input.artistName ? sanitizeDirName(input.artistName) : '';
	const expectedAlbumDir = input.albumTitle ? sanitizeDirName(input.albumTitle) : '';
	const expectedArtistKey = normalizeKey(input.artistName);
	const expectedAlbumKey = normalizeKey(input.albumTitle);

	const strictCandidates = snapshot.files.filter((file) => {
		if (expectedArtistDir && file.artistDir !== expectedArtistDir) return false;
		if (expectedAlbumDir && file.albumDir !== expectedAlbumDir) return false;
		return true;
	});
	const compilationCandidates =
		strictCandidates.length === 0 && expectedAlbumDir
			? snapshot.files.filter(
					(file) =>
						file.artistDir === VARIOUS_ARTISTS_DIR && file.albumDir === expectedAlbumDir
				)
			: [];
	const candidates =
		strictCandidates.length > 0
			? strictCandidates
			: compilationCandidates.length > 0
				? compilationCandidates
				: snapshot.files;

	const filenameMatches = candidates.filter((file) => {
		if (!titleKey) return false;
		const normalizedFilename = normalizeKey(stripExtension(file.filename));
		const normalizedTrackStem = normalizeTrackFilename(file.filename);
		return (
			normalizedFilename.includes(titleKey) ||
			normalizedTrackStem.includes(titleKey) ||
			titleKey.includes(normalizedTrackStem)
		);
	});
	const hasStrictPathScope = strictCandidates.length > 0;
	const hasLooseFallbackScope = !hasStrictPathScope;
	const canTrustFilenameMatches =
		hasStrictPathScope || (expectedArtistKey.length === 0 && expectedAlbumKey.length === 0);
	if (filenameMatches.length > 0 && canTrustFilenameMatches) {
		return {
			exists: true,
			matches: filenameMatches
		};
	}

	// Filename did not match; fallback to embedded tags for robust matching.
	const metadataMatches: LocalMediaFile[] = [];
	for (const file of candidates) {
		const tags = await getEmbeddedTags(file);
		if (!tags) continue;
		if (titleKey) {
			if (tags.titleKey.length === 0) continue;
			const titleMatches =
				tags.titleKey === titleKey ||
				tags.titleKey.includes(titleKey) ||
				titleKey.includes(tags.titleKey);
			if (!titleMatches) continue;
		}
		if (expectedAlbumKey.length > 0) {
			if (hasLooseFallbackScope && tags.albumKey.length === 0) continue;
			if (tags.albumKey.length > 0 && tags.albumKey !== expectedAlbumKey) continue;
		}
		if (expectedArtistKey.length > 0) {
			if (hasLooseFallbackScope && tags.artistKey.length === 0 && tags.albumArtistKey.length === 0) {
				continue;
			}
			const artistMatches =
				tags.artistKey === expectedArtistKey ||
				tags.albumArtistKey === expectedArtistKey ||
				(tags.albumArtistKey === VARIOUS_ARTISTS_KEY && tags.artistKey === expectedArtistKey);
			if (!artistMatches) continue;
		}
		metadataMatches.push(file);
	}

	return {
		exists: metadataMatches.length > 0,
		matches: metadataMatches
	};
}

export async function inspectAlbumIntegrity(input: {
	artistName?: string;
	albumTitle?: string;
	targetArtistDir?: string;
	targetAlbumDir?: string;
	tracks: AlbumIntegrityTrackInput[];
	force?: boolean;
	validationConcurrency?: number;
}): Promise<AlbumIntegrityReport> {
	const logPrefix = '[Media Library Integrity]';
	const requestedTracks = Array.isArray(input.tracks)
		? input.tracks
				.map((track) => ({
					trackId: Number(track.trackId),
					trackTitle: track.trackTitle,
					trackNumber: track.trackNumber,
					expectedDurationSeconds: track.expectedDurationSeconds
				}))
				.filter((track) => Number.isFinite(track.trackId) && track.trackId > 0)
		: [];

	const index = await getLibraryAlbumLookupIndex({ force: input.force });
	const albumFiles = await resolveAlbumMatches(index.files, {
		artistName: input.artistName,
		albumTitle: input.albumTitle,
		targetArtistDir: input.targetArtistDir,
		targetAlbumDir: input.targetAlbumDir
	}, index);
	const resolvedArtistDir = albumFiles[0]?.artistDir;
	const resolvedAlbumDir = albumFiles[0]?.albumDir;

	const results: AlbumIntegrityTrackResult[] = requestedTracks.map((track) => ({
		...track,
		status: 'missing',
		reason: 'No matching local file found'
	}));
	const resultByTrackId = new Map<number, AlbumIntegrityTrackResult>(
		results.map((result) => [result.trackId, result])
	);
	const unusedFiles = [...albumFiles];
	const candidates: Array<{
		track: AlbumIntegrityTrackInput;
		file: LocalMediaFile;
		result: AlbumIntegrityTrackResult;
	}> = [];

	for (const track of requestedTracks) {
		let bestIndex = -1;
		let bestScore = 0;
		for (let i = 0; i < unusedFiles.length; i++) {
			const score = await scoreAlbumTrackCandidate(unusedFiles[i], track);
			if (score > bestScore) {
				bestScore = score;
				bestIndex = i;
			}
		}
		if (bestIndex < 0 || bestScore <= 0) {
			continue;
		}

		const [matchedFile] = unusedFiles.splice(bestIndex, 1);
		if (!matchedFile) continue;
		const result = resultByTrackId.get(track.trackId);
		if (!result) continue;
		result.filePath = matchedFile.path;
		result.relativePath = matchedFile.relativePath;
		candidates.push({ track, file: matchedFile, result });
	}

	const configuredConcurrency = Number(
		process.env.MEDIA_LIBRARY_VALIDATION_CONCURRENCY || '2'
	);
	const validationConcurrency =
		toPositiveInt(input.validationConcurrency) ??
		(toPositiveInt(configuredConcurrency) ?? 2);

	console.log(
		`${logPrefix} Starting integrity scan`,
		JSON.stringify({
			artistName: input.artistName ?? null,
			albumTitle: input.albumTitle ?? null,
			targetArtistDir: input.targetArtistDir ?? null,
			targetAlbumDir: input.targetAlbumDir ?? null,
			resolvedArtistDir: resolvedArtistDir ?? null,
			resolvedAlbumDir: resolvedAlbumDir ?? null,
			requestedTrackCount: requestedTracks.length,
			matchedAlbumFileCount: albumFiles.length,
			candidateTrackCount: candidates.length,
			validationConcurrency,
			forceRescan: input.force === true,
			scannedAt: index.scannedAt
		})
	);

	await mapWithConcurrency(candidates, validationConcurrency, async ({ track, file, result }) => {
		const expectedDurationSeconds =
			typeof track.expectedDurationSeconds === 'number' &&
			Number.isFinite(track.expectedDurationSeconds) &&
			track.expectedDurationSeconds > 0
				? track.expectedDurationSeconds
				: undefined;
		let integrity;
		try {
			integrity = await validateAudioFileIntegrity({
				filePath: file.path,
				expectedExtension: file.extension,
				expectedDurationSeconds
			});
		} catch (error) {
			result.status = 'corrupt';
			result.reason = error instanceof Error ? error.message : String(error);
			console.warn(
				`${logPrefix} Track marked corrupt after validation error`,
				JSON.stringify({
					trackId: track.trackId,
					trackNumber: track.trackNumber ?? null,
					trackTitle: track.trackTitle ?? null,
					relativePath: file.relativePath,
					reason: result.reason
				})
			);
			return;
		}

		if (!integrity.ok) {
			const reason = integrity.error || 'Integrity validation failed';
			if (reason.includes('binary not found')) {
				throw new Error(`Integrity scanner unavailable: ${reason}`);
			}
			result.status = 'corrupt';
			result.reason = reason;
			console.warn(
				`${logPrefix} Track marked corrupt`,
				JSON.stringify({
					trackId: track.trackId,
					trackNumber: track.trackNumber ?? null,
					trackTitle: track.trackTitle ?? null,
					relativePath: file.relativePath,
					reason
				})
			);
			return;
		}

		result.status = 'healthy';
		result.reason = undefined;
		console.log(
			`${logPrefix} Track healthy`,
			JSON.stringify({
				trackId: track.trackId,
				trackNumber: track.trackNumber ?? null,
				trackTitle: track.trackTitle ?? null,
				relativePath: file.relativePath,
				durationSeconds: integrity.durationSeconds ?? null,
				codecName: integrity.codecName ?? null,
				formatName: integrity.formatName ?? null
			})
		);
	});

	for (const track of results) {
		if (track.status !== 'missing') continue;
		console.warn(
			`${logPrefix} Track missing`,
			JSON.stringify({
				trackId: track.trackId,
				trackNumber: track.trackNumber ?? null,
				trackTitle: track.trackTitle ?? null,
				reason: track.reason ?? null
			})
		);
	}

	const healthy = results.filter((track) => track.status === 'healthy').length;
	const missing = results.filter((track) => track.status === 'missing').length;
	const corrupt = results.filter((track) => track.status === 'corrupt').length;

	console.log(
		`${logPrefix} Scan complete`,
		JSON.stringify({
			artistName: input.artistName ?? null,
			albumTitle: input.albumTitle ?? null,
			resolvedArtistDir: resolvedArtistDir ?? null,
			resolvedAlbumDir: resolvedAlbumDir ?? null,
			expected: results.length,
			healthy,
			missing,
			corrupt
		})
	);

	return {
		scannedAt: index.scannedAt,
		totalFilesInAlbumDir: albumFiles.length,
		resolvedArtistDir,
		resolvedAlbumDir,
		tracks: results,
		summary: {
			expected: results.length,
			healthy,
			missing,
			corrupt
		}
	};
}

export async function batchAlbumLibraryStatus(
	albums: Array<{
		id: number;
		artistName?: string;
		albumTitle?: string;
		expectedTrackCount?: number;
	}>
): Promise<Record<number, { exists: boolean; matchedTracks: number }>> {
	const index = await getLibraryAlbumLookupIndex();
	const response: Record<number, { exists: boolean; matchedTracks: number }> = {};

	for (const album of albums) {
		const matches = await resolveAlbumMatches(index.files, {
			artistName: album.artistName,
			albumTitle: album.albumTitle
		}, index);
		const matchedTracks = matches.length;
		const expectedTrackCount =
			typeof album.expectedTrackCount === 'number' && album.expectedTrackCount > 0
				? album.expectedTrackCount
				: undefined;
		response[album.id] = {
			exists: expectedTrackCount ? matchedTracks >= expectedTrackCount : matchedTracks > 0,
			matchedTracks
		};
	}

	return response;
}

export async function getMediaLibrarySuggestions(options?: {
	force?: boolean;
	artistLimit?: number;
	albumLimit?: number;
}): Promise<{
	scannedAt: number;
	totalArtists: number;
	totalAlbums: number;
	artists: MediaLibraryArtistSuggestion[];
	albums: MediaLibraryAlbumSuggestion[];
}> {
	const index = await getLibraryAlbumLookupIndex({ force: options?.force });
	const artistLimit = Math.max(1, Number(options?.artistLimit ?? 5));
	const albumLimit = Math.max(1, Number(options?.albumLimit ?? 5));

	return {
		scannedAt: index.scannedAt,
		totalArtists: index.suggestions.artists.length,
		totalAlbums: index.suggestions.albums.length,
		artists: index.suggestions.artists.slice(0, artistLimit),
		albums: index.suggestions.albums.slice(0, albumLimit)
	};
}

type AlbumDirGroup = {
	artistDir: string;
	albumDir: string;
	files: LocalMediaFile[];
};

type AlbumStats = {
	fileCount: number;
	totalSize: number;
	uniqueTrackKeys: number;
	duplicateTrackCount: number;
};

type DedupeFileCandidate = {
	path: string;
	filename: string;
	extension: string;
	size: number;
	trackKey: string | null;
};

type EvaluatedDedupeFileCandidate = DedupeFileCandidate & {
	integrityState: 0 | 1 | 2; // 2=verified healthy, 1=unknown scanner state, 0=failed integrity
	durationSeconds: number;
};

function summarizeAlbumGroup(files: LocalMediaFile[]): AlbumStats {
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

function compareAlbumGroupPriority(a: AlbumDirGroup, b: AlbumDirGroup): number {
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

function chooseCanonicalAlbumGroup(groups: AlbumDirGroup[]): AlbumDirGroup {
	const sorted = [...groups].sort(compareAlbumGroupPriority);
	return sorted[0];
}

async function moveDirectoryContents(
	sourceDir: string,
	targetDir: string,
	dryRun: boolean
): Promise<{
	movedFiles: number;
	moveErrors: Array<{
		sourcePath: string;
		targetPath: string;
		error: string;
	}>;
}> {
	const entries = await fs.readdir(sourceDir, { withFileTypes: true });
	let movedFiles = 0;
	const moveErrors: Array<{
		sourcePath: string;
		targetPath: string;
		error: string;
	}> = [];
	if (!dryRun) {
		await fs.mkdir(targetDir, { recursive: true });
	}

	for (const entry of entries) {
		const sourcePath = path.join(sourceDir, entry.name);
		const targetPath = path.join(targetDir, entry.name);

		if (entry.isDirectory()) {
			const nested = await moveDirectoryContents(sourcePath, targetPath, dryRun);
			movedFiles += nested.movedFiles;
			moveErrors.push(...nested.moveErrors);
			if (!dryRun) {
				if (nested.moveErrors.length === 0) {
					await fs.rm(sourcePath, { recursive: true, force: true }).catch(() => {});
				} else {
					// Preserve directories with failed moves for manual inspection/recovery.
					await fs.rmdir(sourcePath).catch(() => {});
				}
			}
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		if (dryRun) {
			movedFiles += 1;
			continue;
		}

		const resolvedTargetPath = (await pathExists(targetPath))
			? await ensureUniquePath(targetDir, entry.name)
			: targetPath;
		try {
			await moveFile(sourcePath, resolvedTargetPath);
			movedFiles += 1;
		} catch (error) {
			let effectiveError = error;
			const exdevLike = (error as NodeJS.ErrnoException | undefined)?.code === 'EXDEV';
			if (exdevLike) {
				try {
					await fs.copyFile(sourcePath, resolvedTargetPath);
					await fs.unlink(sourcePath);
					movedFiles += 1;
					continue;
				} catch (fallbackError) {
					effectiveError = fallbackError;
				}
			}
			moveErrors.push({
				sourcePath,
				targetPath: resolvedTargetPath,
				error: effectiveError instanceof Error ? effectiveError.message : String(effectiveError)
			});
		}
	}

	return { movedFiles, moveErrors };
}

async function listAlbumAudioCandidates(albumPath: string): Promise<DedupeFileCandidate[]> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(albumPath, { withFileTypes: true });
	} catch {
		return [];
	}

	const candidates: DedupeFileCandidate[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const extension = path.extname(entry.name).toLowerCase();
		if (!AUDIO_EXTENSIONS.has(extension)) continue;
		const filePath = path.join(albumPath, entry.name);
		const stat = await fs.stat(filePath).catch(() => null);
		if (!stat) continue;
		let trackKey = parseTrackOrderKey(entry.name);
		if (!trackKey) {
			trackKey = await parseTrackOrderKeyFromEmbeddedTags(filePath);
		}
		candidates.push({
			path: filePath,
			filename: entry.name,
			extension,
			size: stat.size,
			trackKey
		});
	}
	return candidates;
}

function compareDedupeCandidatePriority(a: DedupeFileCandidate, b: DedupeFileCandidate): number {
	const evaluatedA = a as EvaluatedDedupeFileCandidate;
	const evaluatedB = b as EvaluatedDedupeFileCandidate;
	if (evaluatedA.integrityState !== evaluatedB.integrityState) {
		return evaluatedB.integrityState - evaluatedA.integrityState;
	}
	if (evaluatedA.durationSeconds !== evaluatedB.durationSeconds) {
		return evaluatedB.durationSeconds - evaluatedA.durationSeconds;
	}
	const rankA = AUDIO_EXTENSION_RANK[a.extension] ?? 100;
	const rankB = AUDIO_EXTENSION_RANK[b.extension] ?? 100;
	if (rankA !== rankB) {
		return rankB - rankA;
	}
	if (a.size !== b.size) {
		return b.size - a.size;
	}
	if (a.filename.length !== b.filename.length) {
		return a.filename.length - b.filename.length;
	}
	return a.filename.localeCompare(b.filename);
}

async function evaluateDedupeCandidate(
	candidate: DedupeFileCandidate
): Promise<EvaluatedDedupeFileCandidate> {
	let integrityState: 0 | 1 | 2 = 1;
	let durationSeconds = 0;

	try {
		const integrity = await validateAudioFileIntegrity({
			filePath: candidate.path,
			expectedExtension: candidate.extension
		});
		if (typeof integrity.durationSeconds === 'number' && Number.isFinite(integrity.durationSeconds)) {
			durationSeconds = Math.max(0, integrity.durationSeconds);
		}
		if (integrity.ok) {
			integrityState = 2;
		} else {
			const reason = (integrity.error || '').toLowerCase();
			if (reason.includes('binary not found')) {
				integrityState = 1;
			} else {
				integrityState = 0;
			}
		}
	} catch {
		integrityState = 1;
	}

	if (durationSeconds <= 0) {
		try {
			const metadata = await parseFile(candidate.path, { duration: true, skipCovers: true });
			if (typeof metadata.format.duration === 'number' && Number.isFinite(metadata.format.duration)) {
				durationSeconds = Math.max(0, metadata.format.duration);
			}
		} catch {
			// Keep default 0 duration when duration probing fails.
		}
	}

	return {
		...candidate,
		integrityState,
		durationSeconds
	};
}

async function moveToBackup(
	filePath: string,
	backupRoot: string,
	artistDir: string,
	albumDir: string
): Promise<void> {
	const backupDir = path.join(backupRoot, artistDir, albumDir);
	await fs.mkdir(backupDir, { recursive: true });
	const fileName = path.basename(filePath);
	const backupPath = await ensureUniquePath(backupDir, fileName);
	await moveFile(filePath, backupPath);
}

export async function deduplicateMediaLibrary(options?: {
	dryRun?: boolean;
	forceRescan?: boolean;
	maxAlbums?: number;
	runId?: string;
	onProgress?: (progress: MediaLibraryDedupeProgress) => void;
}): Promise<MediaLibraryDedupeSummary> {
	const dryRun = options?.dryRun !== false;
	const snapshot = await scanLocalMediaLibrary({ force: options?.forceRescan === true || !dryRun });
	const albumGroupsMap = new Map<string, AlbumDirGroup>();
	for (const file of snapshot.files) {
		const key = `${file.artistDir}::${file.albumDir}`;
		const existing = albumGroupsMap.get(key);
		if (existing) {
			existing.files.push(file);
		} else {
			albumGroupsMap.set(key, {
				artistDir: file.artistDir,
				albumDir: file.albumDir,
				files: [file]
			});
		}
	}
	const albumGroups = Array.from(albumGroupsMap.values());
	const summary: MediaLibraryDedupeSummary = {
		scannedAt: snapshot.scannedAt,
		dryRun,
		runId: options?.runId,
		albumsScanned: albumGroups.length,
		duplicateAlbumGroups: 0,
		duplicateAlbumDirs: 0,
		albumsMerged: 0,
		filesMovedBetweenAlbums: 0,
		filesMoveErrors: 0,
		albumsWithTrackDuplicates: 0,
		albumsSkipped: 0,
		duplicateTrackGroups: 0,
		manualReviewRequired: 0,
		duplicateFilesBackedUp: 0,
		backupErrors: 0,
		movedSamples: [],
		backedUpSamples: [],
		skippedSamples: [],
		failedSamples: []
	};
	const emitProgress = (
		phase: MediaLibraryDedupeProgress['phase'],
		message: string,
		processed: number,
		total: number,
		current?: { artistDir?: string; albumDir?: string }
	): void => {
		const progress: MediaLibraryDedupeProgress = {
			phase,
			message,
			processed,
			total,
			currentArtistDir: current?.artistDir,
			currentAlbumDir: current?.albumDir,
			summary: { ...summary }
		};
		console.log(
			`[Media Library Dedupe] ${message}`,
			JSON.stringify({
				phase,
				processed,
				total,
				currentArtistDir: progress.currentArtistDir ?? null,
				currentAlbumDir: progress.currentAlbumDir ?? null,
				summary: progress.summary
			})
		);
		try {
			options?.onProgress?.(progress);
		} catch {
			// Never fail dedupe due to progress observers.
		}
	};
	emitProgress(
		'scan',
		`Scanned ${summary.albumsScanned} album directory group(s).`,
		0,
		summary.albumsScanned
	);

	const duplicateAlbumGroups = new Map<string, AlbumDirGroup[]>();
	for (const album of albumGroups) {
		const key = `${album.artistDir}::${normalizeDirComparable(album.albumDir)}`;
		const existing = duplicateAlbumGroups.get(key);
		if (existing) {
			existing.push(album);
		} else {
			duplicateAlbumGroups.set(key, [album]);
		}
	}

	const dedupeTargets = new Map<string, { artistDir: string; albumDir: string }>();
	const maxAlbums = toPositiveInt(options?.maxAlbums);
	let mergedGroupCount = 0;
	const candidateMergeGroups = Array.from(duplicateAlbumGroups.values()).filter(
		(groups) => groups.length > 1
	);
	const mergeTotal =
		typeof maxAlbums === 'number'
			? Math.min(maxAlbums, candidateMergeGroups.length)
			: candidateMergeGroups.length;
	emitProgress('merge', 'Starting duplicate album directory merge phase.', 0, mergeTotal);

	for (const groups of duplicateAlbumGroups.values()) {
		if (groups.length <= 1) continue;
		if (typeof maxAlbums === 'number' && mergedGroupCount >= maxAlbums) break;
		mergedGroupCount += 1;
		summary.duplicateAlbumGroups += 1;
		summary.duplicateAlbumDirs += groups.length;

		const canonical = chooseCanonicalAlbumGroup(groups);
		const canonicalKey = `${canonical.artistDir}::${canonical.albumDir}`;
		dedupeTargets.set(canonicalKey, {
			artistDir: canonical.artistDir,
			albumDir: canonical.albumDir
		});
		emitProgress(
			'merge',
			`Merging duplicate directories for ${canonical.artistDir}/${canonical.albumDir}`,
			mergedGroupCount,
			mergeTotal,
			{ artistDir: canonical.artistDir, albumDir: canonical.albumDir }
		);

		for (const group of groups) {
			if (group.albumDir === canonical.albumDir) continue;
			summary.albumsMerged += 1;

			const sourceDir = path.join(snapshot.baseDir, group.artistDir, group.albumDir);
			const targetDir = path.join(snapshot.baseDir, canonical.artistDir, canonical.albumDir);
			if (dryRun) {
				summary.filesMovedBetweenAlbums += group.files.length;
				pushSample(summary.movedSamples, `${sourceDir} -> ${targetDir} (dry-run)`);
				continue;
			}

			const moved = await moveDirectoryContents(sourceDir, targetDir, dryRun);
			summary.filesMovedBetweenAlbums += moved.movedFiles;
			summary.filesMoveErrors += moved.moveErrors.length;
			if (moved.movedFiles > 0) {
				pushSample(summary.movedSamples, `${sourceDir} -> ${targetDir} (${moved.movedFiles} file(s))`);
			}
			if (moved.moveErrors.length > 0) {
				summary.albumsSkipped += 1;
				pushSample(summary.skippedSamples, `${group.artistDir}/${group.albumDir} (merge errors)`);
				console.warn(
					'[Media Library Dedupe] Merge completed with file move errors',
					JSON.stringify({
						artistDir: group.artistDir,
						albumDir: group.albumDir,
						targetArtistDir: canonical.artistDir,
						targetAlbumDir: canonical.albumDir,
						errorCount: moved.moveErrors.length,
						samples: moved.moveErrors.slice(0, 5)
					})
				);
				for (const moveError of moved.moveErrors.slice(0, DEDUPE_SAMPLE_LIMIT)) {
					pushSample(
						summary.failedSamples,
						`${moveError.sourcePath} -> ${moveError.targetPath}: ${moveError.error}`
					);
				}
				continue;
			}
			await fs.rm(sourceDir, { recursive: true, force: true }).catch(() => {});
		}
	}

	for (const album of albumGroups) {
		if (hasTrackDuplicates(album.files)) {
			summary.albumsWithTrackDuplicates += 1;
			const key = `${album.artistDir}::${album.albumDir}`;
			if (!dedupeTargets.has(key)) {
				dedupeTargets.set(key, {
					artistDir: album.artistDir,
					albumDir: album.albumDir
				});
			}
		}
	}
	const trackDedupeTotal =
		typeof maxAlbums === 'number' ? Math.min(maxAlbums, dedupeTargets.size) : dedupeTargets.size;
	emitProgress(
		'track_dedupe',
		'Starting duplicate track resolution phase.',
		0,
		trackDedupeTotal
	);

	let backupRoot: string | undefined;
	if (!dryRun) {
		backupRoot = path.join(
			getTempDir(),
			'library-dedup-backups',
			`run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
		);
		await fs.mkdir(backupRoot, { recursive: true });
	}

	let dedupeProcessedAlbums = 0;
	for (const target of dedupeTargets.values()) {
		if (typeof maxAlbums === 'number' && dedupeProcessedAlbums >= maxAlbums) {
			break;
		}
		dedupeProcessedAlbums += 1;
		emitProgress(
			'track_dedupe',
			`Resolving duplicate tracks in ${target.artistDir}/${target.albumDir}`,
			dedupeProcessedAlbums,
			trackDedupeTotal,
			{ artistDir: target.artistDir, albumDir: target.albumDir }
		);
		const albumPath = path.join(snapshot.baseDir, target.artistDir, target.albumDir);
		if (!(await pathExists(albumPath))) {
			continue;
		}
		const files = await listAlbumAudioCandidates(albumPath);
		const grouped = new Map<string, DedupeFileCandidate[]>();
		for (const file of files) {
			if (!file.trackKey) {
				continue;
			}
			const existing = grouped.get(file.trackKey);
			if (existing) {
				existing.push(file);
			} else {
				grouped.set(file.trackKey, [file]);
			}
		}

		for (const candidates of grouped.values()) {
			if (candidates.length <= 1) continue;
			summary.duplicateTrackGroups += 1;
			const evaluated = await Promise.all(candidates.map((candidate) => evaluateDedupeCandidate(candidate)));
			const sorted = [...evaluated].sort(compareDedupeCandidatePriority);
			const [winner, ...losers] = sorted;
			if (!winner) {
				continue;
			}
			if (winner.integrityState !== 2) {
				summary.manualReviewRequired += 1;
				summary.albumsSkipped += 1;
				pushSample(
					summary.skippedSamples,
					`${target.artistDir}/${target.albumDir} track ${winner.trackKey ?? 'unknown'} (winner not verified)`
				);
				console.warn(
					'[Media Library Dedupe] Skipping duplicate group due to unverified winner',
					JSON.stringify({
						artistDir: target.artistDir,
						albumDir: target.albumDir,
						trackKey: winner.trackKey,
						winner: {
							path: winner.path,
							integrityState: winner.integrityState,
							durationSeconds: winner.durationSeconds
						},
						candidates: sorted.map((candidate) => ({
							path: candidate.path,
							integrityState: candidate.integrityState,
							durationSeconds: candidate.durationSeconds
						}))
					})
				);
				continue;
			}
			summary.duplicateFilesBackedUp += losers.length;
			for (const loser of losers) {
				pushSample(
					summary.backedUpSamples,
					`${target.artistDir}/${target.albumDir}/${path.basename(loser.path)}${dryRun ? ' (dry-run)' : ''}`
				);
			}
			if (dryRun || !backupRoot) {
				continue;
			}
			for (const loser of losers) {
				try {
					await moveToBackup(loser.path, backupRoot, target.artistDir, target.albumDir);
				} catch (error) {
					summary.backupErrors += 1;
					pushSample(
						summary.failedSamples,
						`${loser.path}: ${error instanceof Error ? error.message : String(error)}`
					);
					console.warn(
						'[Media Library Dedupe] Failed to move duplicate file to backup',
						JSON.stringify({
							artistDir: target.artistDir,
							albumDir: target.albumDir,
							filePath: loser.path,
							error: error instanceof Error ? error.message : String(error)
						})
					);
				}
			}
		}
	}

	if (!dryRun) {
		summary.backupRoot = backupRoot;
		clearMediaLibraryScanCache();
	}
	emitProgress(
		'complete',
		`Deduplication complete: merged ${summary.albumsMerged} album folder(s), backed up ${summary.duplicateFilesBackedUp} duplicate file(s).`,
		trackDedupeTotal,
		trackDedupeTotal
	);

	return summary;
}

export function clearMediaLibraryScanCache(): void {
	scanCache = null;
	albumLookupCache = null;
	embeddedTagCache.clear();
}
