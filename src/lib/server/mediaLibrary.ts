import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
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
const HASH_SAMPLE_BYTES = Math.max(4 * 1024, Number(process.env.MEDIA_LIBRARY_HASH_SAMPLE_BYTES || 128 * 1024));

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

let scanCache: { expiresAt: number; snapshot: LocalMediaSnapshot } | null = null;

function normalizeKey(value: string | undefined): string {
	return (value ?? '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

function stripExtension(filename: string): string {
	return filename.replace(/\.[^/.]+$/, '');
}

async function hashSample(filePath: string): Promise<string> {
	const handle = await fs.open(filePath, 'r');
	try {
		const stats = await handle.stat();
		const size = Math.min(stats.size, HASH_SAMPLE_BYTES);
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
	const expectedArtistDir = sanitizeDirName(input.artistName || 'Unknown Artist');
	const expectedAlbumDir = sanitizeDirName(input.albumTitle || 'Unknown Album');
	const matches = snapshot.files.filter(
		(file) => file.artistDir === expectedArtistDir && file.albumDir === expectedAlbumDir
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

	const matches = snapshot.files.filter((file) => {
		if (expectedArtistDir && file.artistDir !== expectedArtistDir) return false;
		if (expectedAlbumDir && file.albumDir !== expectedAlbumDir) return false;
		if (!titleKey) return false;
		const fileTitle = normalizeKey(stripExtension(file.filename));
		return fileTitle.includes(titleKey);
	});

	return {
		exists: matches.length > 0,
		matches
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
		const expectedArtistDir = sanitizeDirName(album.artistName || 'Unknown Artist');
		const expectedAlbumDir = sanitizeDirName(album.albumTitle || 'Unknown Album');
		const matches = snapshot.files.filter(
			(file) => file.artistDir === expectedArtistDir && file.albumDir === expectedAlbumDir
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

export function clearMediaLibraryScanCache(): void {
	scanCache = null;
}
