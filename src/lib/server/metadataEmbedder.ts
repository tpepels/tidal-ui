import type { TrackLookup } from '../types';
import { execFile } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { formatArtistsForMetadata } from '../utils/formatters';
import { buildTrackDiscMetadataEntries } from '../utils/trackDiscMetadata';

export interface ServerMetadataOptions {
	downloadCoverSeperately?: boolean;
	coverUrl?: string;
	convertToMp3?: boolean;
}

let resolvedFfmpegPath: string | null | undefined = undefined; // undefined = not checked yet

/**
 * Find ffmpeg binary. Checks FFMPEG_PATH env, then PATH, then common install locations.
 */
const findFfmpeg = (): string | null => {
	if (resolvedFfmpegPath !== undefined) return resolvedFfmpegPath;

	const candidates = [
		process.env.FFMPEG_PATH,
		'ffmpeg',
		'/usr/bin/ffmpeg',
		'/usr/local/bin/ffmpeg',
		'/opt/ffmpeg/ffmpeg',
		'/snap/bin/ffmpeg'
	].filter(Boolean) as string[];

	for (const candidate of candidates) {
		try {
			const result = spawnSync(candidate, ['-version'], {
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: 5000
			});
			if (!result.error && result.status === 0) {
				resolvedFfmpegPath = candidate;
				const versionLine = result.stdout?.toString().split('\n')[0] ?? '';
				console.log(`[Server Metadata] Found ffmpeg: ${candidate} (${versionLine})`);
				return resolvedFfmpegPath;
			}
		} catch {
			// Try next candidate
		}
	}

	resolvedFfmpegPath = null;
	console.warn(
		'[Server Metadata] ffmpeg not found. Metadata embedding disabled.\n' +
			'  Searched: ' +
			candidates.join(', ') +
			'\n' +
			'  Set FFMPEG_PATH environment variable to your ffmpeg binary path.'
	);
	return null;
};

/**
 * Embed metadata into an audio file using ffmpeg.
 *
 * For M4A files containing FLAC audio (common with Tidal DASH streams),
 * remuxes to a native FLAC container since older ffmpeg versions can't write
 * FLAC codec back into MP4 containers. This also produces proper .flac files.
 *
 * Returns the final file path, which may differ from the input if the
 * container format was changed (e.g. .m4a -> .flac).
 */
export interface MetadataOverrides {
	albumTitle?: string;
	albumArtist?: string;
	trackNumber?: number;
	totalTracks?: number;
	discNumber?: number;
	totalDiscs?: number;
}

export async function embedMetadataToFile(
	filePath: string,
	lookup: TrackLookup,
	overrides?: MetadataOverrides
): Promise<string> {
	const ffmpegPath = findFfmpeg();
	if (!ffmpegPath) return filePath;

	const metadata = buildMetadataObject(lookup, overrides);
	const entries = Object.entries(metadata);
	if (entries.length === 0) {
		console.warn('[Server Metadata] No metadata entries to embed for:', filePath);
		return filePath;
	}

	const ext = path.extname(filePath).toLowerCase();
	const metadataArgs = entries.flatMap(([key, value]) => ['-metadata', `${key}=${value}`]);

	// M4A files from Tidal DASH often contain FLAC audio in an MP4 container.
	// ffmpeg <6.0 can't write FLAC back into MP4, so remux to native FLAC.
	if (ext === '.m4a') {
		const flacPath = filePath.replace(/\.m4a$/i, '.flac');
		const tempPath = filePath.replace(/\.m4a$/i, '.tmp.flac');

		try {
			await runFfmpeg(ffmpegPath, [
				'-y',
				'-i',
				filePath,
				...metadataArgs,
				'-c',
				'copy',
				tempPath
			]);
			await verifyOutput(filePath, tempPath);
			await fs.rename(tempPath, flacPath);
			await fs.unlink(filePath);
			console.log(
				`[Server Metadata] Remuxed to native FLAC with ${entries.length} tags: ${path.basename(flacPath)}`
			);
			return flacPath;
		} catch (remuxError) {
			await fs.unlink(tempPath).catch(() => {});
			// If remux to FLAC failed, the audio codec isn't FLAC (likely AAC).
			// Fall through to standard M4A metadata embedding.
			console.log(
				`[Server Metadata] Not FLAC-in-MP4, trying standard M4A embedding: ${
					remuxError instanceof Error ? remuxError.message.split('\n')[0] : remuxError
				}`
			);
		}
	}

	// Standard metadata embedding (native FLAC files, or AAC M4A files)
	const tempPath = filePath + '.tmp' + ext;

	try {
		await runFfmpeg(ffmpegPath, ['-y', '-i', filePath, ...metadataArgs, '-c', 'copy', tempPath]);
		await verifyOutput(filePath, tempPath);
		await fs.rename(tempPath, filePath);
		console.log(
			`[Server Metadata] Embedded ${entries.length} tags into: ${path.basename(filePath)}`
		);
		return filePath;
	} catch (error) {
		await fs.unlink(tempPath).catch(() => {});
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[Server Metadata] Failed to embed metadata into ${filePath}: ${msg}`);
		throw error;
	}
}

async function verifyOutput(originalPath: string, outputPath: string): Promise<void> {
	const [origStat, outStat] = await Promise.all([fs.stat(originalPath), fs.stat(outputPath)]);
	if (outStat.size < origStat.size * 0.5) {
		throw new Error(
			`Output file suspiciously small (${outStat.size} vs ${origStat.size} bytes)`
		);
	}
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(ffmpegPath, args, { timeout: 30000 }, (error, _stdout, stderr) => {
			if (error) {
				const stderrTail = stderr ? stderr.split('\n').slice(-5).join('\n') : '';
				reject(new Error(`ffmpeg failed: ${error.message}\n${stderrTail}`));
			} else {
				resolve(stderr || '');
			}
		});
	});
}

/**
 * Build metadata key-value pairs from a TrackLookup object.
 */
function normalizePositiveInteger(value: number | undefined): number | undefined {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return undefined;
	}
	return Math.trunc(parsed);
}

export function buildMetadataObject(lookup: TrackLookup, overrides?: MetadataOverrides) {
	const { track } = lookup;
	const album = track.album;
	const mainArtist = formatArtistsForMetadata(track.artists);
	const overrideAlbumTitle =
		overrides?.albumTitle && overrides.albumTitle.trim().length > 0
			? overrides.albumTitle.trim()
			: undefined;
	const overrideAlbumArtist =
		overrides?.albumArtist && overrides.albumArtist.trim().length > 0
			? overrides.albumArtist.trim()
			: undefined;
	const albumArtist =
		overrideAlbumArtist ??
		album?.artist?.name ??
		(album?.artists && album.artists.length > 0 ? album.artists[0]?.name : undefined) ??
		track.artists?.[0]?.name;

	const metadata: Record<string, string> = {};

	// Basic track information
	if (track.title) metadata.title = track.title;
	if (mainArtist) metadata.artist = mainArtist;
	if (albumArtist) metadata.album_artist = albumArtist;
	if (overrideAlbumTitle || album?.title) metadata.album = overrideAlbumTitle ?? album.title;

	// Track and disc numbers
	const trackNumberOverride = normalizePositiveInteger(overrides?.trackNumber);
	const totalTracksOverride = normalizePositiveInteger(overrides?.totalTracks);
	const discNumberOverride = normalizePositiveInteger(overrides?.discNumber);
	const totalDiscsOverride = normalizePositiveInteger(overrides?.totalDiscs);
	for (const [key, value] of buildTrackDiscMetadataEntries({
		trackNumber: trackNumberOverride ?? track.trackNumber,
		totalTracks: totalTracksOverride ?? album?.numberOfTracks,
		discNumber: discNumberOverride ?? track.volumeNumber,
		totalDiscs: totalDiscsOverride ?? album?.numberOfVolumes
	})) {
		metadata[key] = value;
	}

	// Release date
	const releaseDate = album?.releaseDate ?? track.streamStartDate;
	if (releaseDate) {
		const yearMatch = /^(\d{4})/.exec(releaseDate);
		if (yearMatch?.[1]) {
			metadata.date = yearMatch[1];
			metadata.year = yearMatch[1];
		}
	}

	// ISRC and copyright
	if (track.isrc) metadata.isrc = track.isrc;
	if (album?.copyright) metadata.copyright = album.copyright;

	// ReplayGain information
	if (lookup.info) {
		const { trackReplayGain, trackPeakAmplitude, albumReplayGain, albumPeakAmplitude } =
			lookup.info;

		if (trackReplayGain !== undefined && trackReplayGain !== null) {
			metadata.REPLAYGAIN_TRACK_GAIN = `${trackReplayGain} dB`;
		}
		if (trackPeakAmplitude !== undefined && trackPeakAmplitude !== null) {
			metadata.REPLAYGAIN_TRACK_PEAK = `${trackPeakAmplitude}`;
		}
		if (albumReplayGain !== undefined && albumReplayGain !== null) {
			metadata.REPLAYGAIN_ALBUM_GAIN = `${albumReplayGain} dB`;
		}
		if (albumPeakAmplitude !== undefined && albumPeakAmplitude !== null) {
			metadata.REPLAYGAIN_ALBUM_PEAK = `${albumPeakAmplitude}`;
		}
	} else if (track.replayGain) {
		metadata.REPLAYGAIN_TRACK_GAIN = `${track.replayGain} dB`;
		if (track.peak) {
			metadata.REPLAYGAIN_TRACK_PEAK = `${track.peak}`;
		}
	}

	// Comment with source attribution
	metadata.comment = 'Downloaded from music.binimum.org/tidal.squid.wtf';

	return metadata;
}
