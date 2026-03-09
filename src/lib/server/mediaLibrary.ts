import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parseFile } from 'music-metadata';
import { getDownloadDir, sanitizeDirName } from '../../routes/api/download-track/_shared';
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
	tracks: AlbumIntegrityTrackResult[];
	summary: {
		expected: number;
		healthy: number;
		missing: number;
		corrupt: number;
	};
}

type EmbeddedTags = {
	artistKey: string;
	albumArtistKey: string;
	albumKey: string;
	titleKey: string;
	trackNo?: number;
	discNo?: number;
};

let scanCache: { expiresAt: number; snapshot: LocalMediaSnapshot } | null = null;
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

function stripExtension(filename: string): string {
	return filename.replace(/\.[^/.]+$/, '');
}

function stripTrackPrefix(value: string): string {
	return value
		.replace(/^\d{1,2}\s*[-_]\s*\d{1,2}\s*-\s*/i, '')
		.replace(/^\d{1,3}\s*-\s*/i, '')
		.trim();
}

function normalizeTrackFilename(filename: string): string {
	const stem = normalizeKey(stripExtension(filename));
	return normalizeKey(stripTrackPrefix(stem));
}

function parseTrackNumberFromFilename(filename: string): number | undefined {
	const stem = stripExtension(filename).trim();
	const discTrackMatch = /^(\d{1,2})\s*[-_]\s*(\d{1,2})\s*-\s*/.exec(stem);
	if (discTrackMatch?.[2]) {
		const parsed = Number.parseInt(discTrackMatch[2], 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
	}
	const trackOnlyMatch = /^(\d{1,3})\s*-\s*/.exec(stem);
	if (trackOnlyMatch?.[1]) {
		const parsed = Number.parseInt(trackOnlyMatch[1], 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
	}
	return undefined;
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

async function resolveAlbumMatches(
	files: LocalMediaFile[],
	input: {
		artistName?: string;
		albumTitle?: string;
	}
): Promise<LocalMediaFile[]> {
	const expectedArtistDir = sanitizeDirName(input.artistName || 'Unknown Artist');
	const expectedAlbumDir = sanitizeDirName(input.albumTitle || 'Unknown Album');
	const expectedArtistKey = normalizeKey(input.artistName);
	const expectedAlbumKey = normalizeKey(input.albumTitle);

	const primaryPathMatches = files.filter(
		(file) => file.artistDir === expectedArtistDir && file.albumDir === expectedAlbumDir
	);
	if (primaryPathMatches.length > 0) {
		return primaryPathMatches;
	}

	// Compilations are commonly filed under "Various Artists/Album Name".
	if (expectedArtistDir !== VARIOUS_ARTISTS_DIR) {
		const compilationPathMatches = files.filter(
			(file) => file.artistDir === VARIOUS_ARTISTS_DIR && file.albumDir === expectedAlbumDir
		);
		if (compilationPathMatches.length > 0) {
			return compilationPathMatches;
		}
	}

	// Final fallback: use embedded metadata for album + artist identification.
	if (!expectedAlbumKey) {
		return [];
	}
	const albumDirCandidates = files.filter((file) => file.albumDir === expectedAlbumDir);
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

	return metadataMatches;
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

export async function checkAlbumInLibrary(input: {
	artistName?: string;
	albumTitle?: string;
	expectedTrackCount?: number;
	force?: boolean;
}): Promise<{ exists: boolean; matchedTracks: number; samplePaths: string[] }> {
	const snapshot = await scanLocalMediaLibrary({ force: input.force });
	const matches = await resolveAlbumMatches(snapshot.files, {
		artistName: input.artistName,
		albumTitle: input.albumTitle
	});
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
	tracks: AlbumIntegrityTrackInput[];
	force?: boolean;
	validationConcurrency?: number;
}): Promise<AlbumIntegrityReport> {
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

	const snapshot = await scanLocalMediaLibrary({ force: input.force });
	const albumFiles = await resolveAlbumMatches(snapshot.files, {
		artistName: input.artistName,
		albumTitle: input.albumTitle
	});

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
			return;
		}

		if (!integrity.ok) {
			const reason = integrity.error || 'Integrity validation failed';
			if (reason.includes('binary not found')) {
				throw new Error(`Integrity scanner unavailable: ${reason}`);
			}
			result.status = 'corrupt';
			result.reason = reason;
			return;
		}

		result.status = 'healthy';
		result.reason = undefined;
	});

	const healthy = results.filter((track) => track.status === 'healthy').length;
	const missing = results.filter((track) => track.status === 'missing').length;
	const corrupt = results.filter((track) => track.status === 'corrupt').length;

	return {
		scannedAt: snapshot.scannedAt,
		totalFilesInAlbumDir: albumFiles.length,
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
	const snapshot = await scanLocalMediaLibrary();
	const response: Record<number, { exists: boolean; matchedTracks: number }> = {};

	for (const album of albums) {
		const matches = await resolveAlbumMatches(snapshot.files, {
			artistName: album.artistName,
			albumTitle: album.albumTitle
		});
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

export function clearMediaLibraryScanCache(): void {
	scanCache = null;
	embeddedTagCache.clear();
}
