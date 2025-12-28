import type { TrackLookup } from '../types';
// @ts-expect-error - ffmetadata has no TypeScript definitions
import ffmetadata from 'ffmetadata';
import { formatArtistsForMetadata } from '../utils';

export interface ServerMetadataOptions {
	downloadCoverSeperately?: boolean;
	coverUrl?: string;
	convertToMp3?: boolean;
}

/**
 * Embed metadata into audio files server-side using FFmpeg/ffmetadata
 */
export async function embedMetadataToFile(filePath: string, lookup: TrackLookup): Promise<void> {
	try {
		const metadata = buildMetadataObject(lookup);

		// Use ffmetadata to write metadata to the file
		await new Promise<void>((resolve, reject) => {
			ffmetadata.write(filePath, metadata, (err?: Error) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});

		console.log('[Server Metadata] Successfully embedded metadata into:', filePath);
	} catch (error) {
		console.warn('[Server Metadata] Failed to embed metadata into file:', filePath, error);
		throw error;
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
