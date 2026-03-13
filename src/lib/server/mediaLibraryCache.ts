import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parseFile } from 'music-metadata';
import { getDownloadDir } from '../../routes/api/download-track/_shared';
import {
	AUDIO_EXTENSIONS,
	type AlbumLookupGroup,
	appendToMapArray,
	buildSearchQuery,
	formatSuggestionLabel,
	type EmbeddedTags,
	type LibraryAlbumLookupIndex,
	type LocalMediaFile,
	type LocalMediaSnapshot,
	type MediaLibraryAlbumSuggestion,
	type MediaLibraryArtistSuggestion,
	makeAlbumGroupKey,
	normalizeDirComparable,
	normalizeKey,
	isTransientAlbumArtifactDirName,
	toPositiveInt
} from './mediaLibraryShared';

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

export async function getEmbeddedTags(file: LocalMediaFile): Promise<EmbeddedTags | null> {
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

export async function getLibraryAlbumLookupIndex(options?: {
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

export function clearMediaLibraryScanCache(): void {
	scanCache = null;
	albumLookupCache = null;
	embeddedTagCache.clear();
}
