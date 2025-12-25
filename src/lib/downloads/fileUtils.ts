import type { Album, Track, AudioQuality } from '../types';
import { formatArtists } from '../utils';

/**
 * Filename and path utilities for download operations
 */

/**
 * Sanitize a string for use in filenames
 */
export function sanitizeForFilename(value: string | null | undefined): string {
	if (!value) return 'Unknown';
	return value
		.replace(/[\\/:*?"<>|]/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Get file extension based on audio quality
 */
export function getExtensionForQuality(quality: AudioQuality, convertAacToMp3 = false): string {
	switch (quality) {
		case 'LOW':
		case 'HIGH':
			return convertAacToMp3 ? 'mp3' : 'm4a';
		default:
			return 'flac';
	}
}

/**
 * Build a standardized track filename
 */
export function buildTrackFilename(
	album: Album,
	track: Track,
	quality: AudioQuality,
	artistName?: string,
	convertAacToMp3 = false
): string {
	const extension = getExtensionForQuality(quality, convertAacToMp3);
	const volumeNumber = Number(track.volumeNumber);
	const trackNumber = Number(track.trackNumber);

	// Check if this is a multi-volume album by checking:
	// 1. numberOfVolumes > 1, or
	// 2. volumeNumber is set and finite (indicating multi-volume structure)
	const isMultiVolume =
		(album.numberOfVolumes && album.numberOfVolumes > 1) || Number.isFinite(volumeNumber);

	let trackPart: string;
	if (isMultiVolume) {
		const volumePadded =
			Number.isFinite(volumeNumber) && volumeNumber > 0 ? `${volumeNumber}`.padStart(2, '0') : '01';
		const trackPadded =
			Number.isFinite(trackNumber) && trackNumber > 0 ? `${trackNumber}`.padStart(2, '0') : '00';
		trackPart = `${volumePadded}-${trackPadded}`;
	} else {
		const trackPadded =
			Number.isFinite(trackNumber) && trackNumber > 0 ? `${trackNumber}`.padStart(2, '0') : '00';
		trackPart = trackPadded;
	}

	let title = track.title;
	if (track.version) {
		title = `${title} (${track.version})`;
	}

	const parts = [
		sanitizeForFilename(artistName ?? formatArtists(track.artists)),
		sanitizeForFilename(album.title ?? 'Unknown Album'),
		`${trackPart} ${sanitizeForFilename(title)}`
	];

	return `${parts.join(' - ')}.${extension}`;
}

/**
 * Escape a value for CSV export
 */
export function escapeCsvValue(value: string): string {
	if (value.includes(',') || value.includes('"') || value.includes('\n')) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

/**
 * Build CSV content with track links
 */
export async function buildTrackLinksCsv(tracks: Track[], quality: AudioQuality): Promise<string> {
	const headers = ['Title', 'Artist', 'Album', 'Duration', 'Quality', 'URL'];
	const rows = [headers.join(',')];

	for (const track of tracks) {
		const title = escapeCsvValue(track.title);
		const artist = escapeCsvValue(formatArtists(track.artists));
		const album = escapeCsvValue(track.album?.title ?? 'Unknown Album');
		const duration = track.duration
			? Math.floor(track.duration / 60) + ':' + (track.duration % 60).toString().padStart(2, '0')
			: '';
		const qualityStr = quality.toString();
		const url = `https://tidal.com/track/${track.id}`;

		rows.push([title, artist, album, duration, qualityStr, url].join(','));
	}

	return rows.join('\n');
}
