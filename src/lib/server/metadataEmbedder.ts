import type { TrackLookup } from '../types';
// @ts-expect-error - ffmetadata has no TypeScript definitions
import ffmetadata from 'ffmetadata';
import { spawnSync } from 'node:child_process';
import { formatArtistsForMetadata } from '../utils/formatters';

export interface ServerMetadataOptions {
	downloadCoverSeperately?: boolean;
	coverUrl?: string;
	convertToMp3?: boolean;
}

let ffmpegAvailable: boolean | null = null;
let warnedMissingFfmpeg = false;

const checkFfmpegAvailable = (): boolean => {
	if (ffmpegAvailable !== null) {
		return ffmpegAvailable;
	}
	try {
		const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
		// Check both for successful status AND absence of spawn errors
		ffmpegAvailable = !result.error && result.status === 0;
	} catch {
		ffmpegAvailable = false;
	}
	if (!ffmpegAvailable && !warnedMissingFfmpeg) {
		warnedMissingFfmpeg = true;
		console.warn('[Server Metadata] ffmpeg not available; skipping metadata embedding.');
	}
	return ffmpegAvailable;
};

/**
 * Embed metadata into audio files server-side using FFmpeg/ffmetadata
 *
 * This function is defensive against crashes in the ffmetadata library.
 * The ffmetadata library has a bug where it can crash with "Cannot read properties
 * of undefined (reading 'toString')" when ffmpeg is not available or fails.
 */
export async function embedMetadataToFile(filePath: string, lookup: TrackLookup): Promise<void> {
	// Early return if ffmpeg is not available
	if (!checkFfmpegAvailable()) {
		return;
	}

	const metadata = buildMetadataObject(lookup);

	// Set up a safety handler to catch crashes from ffmetadata library's buggy error handling
	let uncaughtExceptionHandler: ((err: Error) => void) | null = null;
	let handlerActive = false;

	try {
		// Create a promise that wraps the ffmetadata call with crash protection
		await new Promise<void>((resolve, reject) => {
			let settled = false;

			// Install temporary uncaught exception handler for ffmetadata crashes
			uncaughtExceptionHandler = (err: Error) => {
				if (!settled && err.message?.includes('Cannot read properties of undefined')) {
					// This is the ffmetadata library bug - treat as a regular error
					settled = true;
					handlerActive = false;
					console.warn('[Server Metadata] Caught ffmetadata library crash, treating as error');
					reject(new Error('FFmpeg metadata library encountered an internal error'));
				}
			};
			process.once('uncaughtException', uncaughtExceptionHandler);
			handlerActive = true;

			// Set a timeout to prevent hanging
			const timeout = setTimeout(() => {
				if (!settled) {
					settled = true;
					reject(new Error('Metadata embedding timeout after 30s'));
				}
			}, 30000);

			try {
				ffmetadata.write(filePath, metadata, (err?: Error) => {
					clearTimeout(timeout);
					if (!settled) {
						settled = true;
						// Small delay to catch any async crashes from ffmetadata
						setTimeout(() => {
							if (handlerActive && uncaughtExceptionHandler) {
								process.removeListener('uncaughtException', uncaughtExceptionHandler);
								handlerActive = false;
							}
						}, 100);

						if (err) {
							reject(err);
						} else {
							resolve();
						}
					}
				});
			} catch (error) {
				clearTimeout(timeout);
				if (!settled) {
					settled = true;
					reject(error);
				}
			}
		});

		console.log('[Server Metadata] Successfully embedded metadata into:', filePath);
	} catch (error) {
		console.warn('[Server Metadata] Failed to embed metadata into file:', filePath, error);
		throw error;
	} finally {
		// Clean up the exception handler if still active
		if (handlerActive && uncaughtExceptionHandler) {
			process.removeListener('uncaughtException', uncaughtExceptionHandler);
		}
	}
}

/**
 * Build metadata object compatible with ffmetadata
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
