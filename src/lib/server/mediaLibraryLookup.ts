import { sanitizeDirName } from '../../routes/api/download-track/_shared';
import { getEmbeddedTags, getLibraryAlbumLookupIndex, scanLocalMediaLibrary } from './mediaLibraryCache';
import {
	type LibraryAlbumLookupIndex,
	type LocalMediaFile,
	type MediaLibraryAlbumSuggestion,
	type MediaLibraryArtistSuggestion,
	VARIOUS_ARTISTS_DIR,
	VARIOUS_ARTISTS_KEY,
	makeAlbumGroupKey,
	normalizeDirComparable,
	normalizeKey,
	normalizeTrackFilename,
	stripExtension
} from './mediaLibraryShared';

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

export async function resolveAlbumMatches(
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

export async function checkAlbumInLibrary(input: {
	artistName?: string;
	albumTitle?: string;
	expectedTrackCount?: number;
	force?: boolean;
}): Promise<{ exists: boolean; matchedTracks: number; samplePaths: string[] }> {
	const index = await getLibraryAlbumLookupIndex({ force: input.force });
	const matches = await resolveAlbumMatches(
		index.files,
		{
			artistName: input.artistName,
			albumTitle: input.albumTitle
		},
		index
	);
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
	const index = await getLibraryAlbumLookupIndex();
	const response: Record<number, { exists: boolean; matchedTracks: number }> = {};

	for (const album of albums) {
		const matches = await resolveAlbumMatches(
			index.files,
			{
				artistName: album.artistName,
				albumTitle: album.albumTitle
			},
			index
		);
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
