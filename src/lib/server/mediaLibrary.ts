import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parseFile } from 'music-metadata';
import { getDownloadDir, sanitizeDirName } from '../../routes/api/download-track/_shared';

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
