import type { TrackLookup } from '../types';
import { execFile } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { formatArtistsForMetadata } from '../utils/formatters';

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
 * Embed metadata into an audio file using ffmpeg directly.
 * Supports both FLAC and M4A/MP4 containers.
 */
export async function embedMetadataToFile(filePath: string, lookup: TrackLookup): Promise<void> {
	const ffmpegPath = findFfmpeg();
	if (!ffmpegPath) return;

	const metadata = buildMetadataObject(lookup);
	const entries = Object.entries(metadata);
	if (entries.length === 0) {
		console.warn('[Server Metadata] No metadata entries to embed for:', filePath);
		return;
	}

	const ext = path.extname(filePath);
	const tempPath = filePath + '.tmp' + ext;

	// Build ffmpeg arguments: -i input -metadata key=value ... -c copy -y output
	const args = [
		'-y',
		'-i',
		filePath,
		...entries.flatMap(([key, value]) => ['-metadata', `${key}=${value}`]),
		'-c',
		'copy',
		tempPath
	];

	try {
		await runFfmpeg(ffmpegPath, args);
		// Verify temp file was created and has reasonable size
		const [origStat, tempStat] = await Promise.all([fs.stat(filePath), fs.stat(tempPath)]);
		if (tempStat.size < origStat.size * 0.5) {
			throw new Error(
				`Output file suspiciously small (${tempStat.size} vs ${origStat.size} bytes)`
			);
		}
		await fs.rename(tempPath, filePath);
		console.log(
			`[Server Metadata] Embedded ${entries.length} tags into: ${path.basename(filePath)}`
		);
	} catch (error) {
		await fs.unlink(tempPath).catch(() => {});
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[Server Metadata] Failed to embed metadata into ${filePath}: ${msg}`);
		throw error;
	}
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(ffmpegPath, args, { timeout: 30000 }, (error, _stdout, stderr) => {
			if (error) {
				// Include stderr for diagnosis
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
function buildMetadataObject(lookup: TrackLookup) {
	const { track } = lookup;
	const album = track.album;
	const mainArtist = formatArtistsForMetadata(track.artists);
	const albumArtist =
		album?.artist?.name ??
		(album?.artists && album.artists.length > 0 ? album.artists[0]?.name : undefined) ??
		track.artists?.[0]?.name;

	const metadata: Record<string, string> = {};

	// Basic track information
	if (track.title) metadata.title = track.title;
	if (mainArtist) metadata.artist = mainArtist;
	if (albumArtist) metadata.album_artist = albumArtist;
	if (album?.title) metadata.album = album.title;

	// Track and disc numbers
	const trackNumber = Number(track.trackNumber);
	const totalTracks = Number(album?.numberOfTracks);
	if (Number.isFinite(trackNumber) && trackNumber > 0) {
		metadata.track =
			Number.isFinite(totalTracks) && totalTracks > 0
				? `${trackNumber}/${totalTracks}`
				: `${trackNumber}`;
	}

	const discNumber = Number(track.volumeNumber);
	const totalDiscs = Number(album?.numberOfVolumes);
	if (Number.isFinite(discNumber) && discNumber > 0) {
		metadata.disc =
			Number.isFinite(totalDiscs) && totalDiscs > 0
				? `${discNumber}/${totalDiscs}`
				: `${discNumber}`;
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
