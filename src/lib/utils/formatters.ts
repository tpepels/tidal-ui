import type { Artist } from '../types';

/**
 * Formats an array of artists into a readable string for UI display.
 * For single artist: "Artist Name"
 * For multiple artists: "Artist1, Artist2 & Artist3"
 *
 * @param artists - Array of artists
 * @returns Formatted artist string
 */
export function formatArtists(artists: Artist[] | undefined): string {
	if (!artists || artists.length === 0) {
		return 'Unknown Artist';
	}

	if (artists.length === 1) {
		return artists[0].name;
	}

	if (artists.length === 2) {
		return `${artists[0].name} & ${artists[1].name}`;
	}

	// For 3 or more artists: "Artist1, Artist2 & Artist3"
	const allButLast = artists
		.slice(0, -1)
		.map((a) => a.name)
		.join(', ');
	const last = artists[artists.length - 1].name;
	return `${allButLast} & ${last}`;
}

/**
 * Formats an array of artists for metadata tags (ID3, etc.).
 * Uses semicolons as the standard delimiter.
 * For single artist: "Artist Name"
 * For multiple artists: "Artist1; Artist2; Artist3"
 *
 * @param artists - Array of artists
 * @returns Formatted artist string for metadata
 */
export function formatArtistsForMetadata(artists: Artist[] | undefined): string {
	if (!artists || artists.length === 0) {
		return 'Unknown Artist';
	}

	return artists.map((a) => a.name).join('; ');
}

/**
 * Formats duration in seconds to a human-readable time string.
 * Examples: "3:45", "1:23:45"
 */
export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) {
		return '0:00';
	}

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = Math.floor(seconds % 60);

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
	}

	return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Formats file size in bytes to human-readable format.
 */
export function formatFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return '0 B';
	}

	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

/**
 * Formats a number with commas as thousands separators.
 */
export function formatNumber(num: number): string {
	return num.toLocaleString();
}

/**
 * Truncates text to a specified length with ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return text.slice(0, maxLength - 3) + '...';
}
