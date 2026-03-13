import { parseFile } from 'music-metadata';
import { getMediaLibraryScanCacheState, scanLocalMediaLibrary } from './mediaLibraryScan';
import {
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
	toPositiveInt
} from './mediaLibraryShared';

const LIBRARY_SCAN_CACHE_TTL_MS = Math.max(
	5_000,
	Number(process.env.MEDIA_LIBRARY_CACHE_TTL_MS || 30_000)
);
const EMBEDDED_TAG_CACHE_TTL_MS = Math.max(
	5_000,
	Number(process.env.MEDIA_LIBRARY_EMBEDDED_TAG_CACHE_TTL_MS || 10 * 60 * 1000)
);

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
	const expiresAt =
		getMediaLibraryScanCacheState()?.expiresAt ?? now + LIBRARY_SCAN_CACHE_TTL_MS;
	albumLookupCache = {
		expiresAt,
		scannedAt: snapshot.scannedAt,
		baseDir: snapshot.baseDir,
		index
	};
	return index;
}

export function clearMediaLibraryIndexCache(): void {
	albumLookupCache = null;
	embeddedTagCache.clear();
}
