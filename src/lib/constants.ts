// API and Application Constants

// API Configuration
export const API_BASE = 'https://triton.squid.wtf';
export const DASH_MANIFEST_UNAVAILABLE_CODE = 'DASH_MANIFEST_UNAVAILABLE';
export const RATE_LIMIT_ERROR_MESSAGE = 'Too Many Requests. Please wait a moment and try again.';

// Audio Quality Options
export const AUDIO_QUALITIES = {
	HI_RES_LOSSLESS: 'HI_RES_LOSSLESS',
	LOSSLESS: 'LOSSLESS',
	HIGH: 'HIGH',
	LOW: 'LOW'
} as const;

export type AudioQuality = (typeof AUDIO_QUALITIES)[keyof typeof AUDIO_QUALITIES];

// Search Types
export const SEARCH_TYPES = {
	TRACKS: 'tracks',
	ALBUMS: 'albums',
	ARTISTS: 'artists',
	PLAYLISTS: 'playlists'
} as const;

export type SearchTab = (typeof SEARCH_TYPES)[keyof typeof SEARCH_TYPES];

// Content Types
export const CONTENT_TYPES = {
	TRACK: 'track',
	ALBUM: 'album',
	ARTIST: 'artist',
	PLAYLIST: 'playlist'
} as const;

// UI Constants
export const UI_BREAKPOINTS = {
	SM: 640,
	MD: 768,
	LG: 1024,
	XL: 1280
} as const;

// Cache TTL values (in milliseconds)
export const CACHE_TTL = {
	SEARCH: 5 * 60 * 1000, // 5 minutes
	TRACK: 10 * 60 * 1000, // 10 minutes
	ALBUM: 15 * 60 * 1000, // 15 minutes
	ARTIST: 15 * 60 * 1000, // 15 minutes
	PLAYLIST: 15 * 60 * 1000, // 15 minutes
	COVER: 60 * 60 * 1000, // 1 hour
	LYRICS: 60 * 60 * 1000 // 1 hour
} as const;

// Error Messages
export const ERROR_MESSAGES = {
	NETWORK_ERROR: 'Network error. Please check your connection and try again.',
	API_ERROR: 'API error. Please try again later.',
	RATE_LIMIT_ERROR: 'Too Many Requests. Please wait a moment and try again.',
	INVALID_URL: 'Invalid URL format.',
	TRACK_NOT_FOUND: 'Track not found.',
	ALBUM_NOT_FOUND: 'Album not found.',
	ARTIST_NOT_FOUND: 'Artist not found.',
	PLAYLIST_NOT_FOUND: 'Playlist not found.',
	STREAM_NOT_AVAILABLE: 'Stream not available for this quality.',
	DOWNLOAD_FAILED: 'Download failed. Please try again.',
	UPLOAD_FAILED: 'Upload failed. Please try again.'
} as const;

// Regex Patterns
export const REGEX_PATTERNS = {
	URL: /^https?:\/\/.+/i,
	TIDAL_URL: /tidal\.com/i,
	SPOTIFY_URL: /spotify\.com/i,
	YOUTUBE_URL: /youtube\.com|youtu\.be/i,
	SOUNDCLOUD_URL: /soundcloud\.com/i
} as const;

// File Extensions
export const FILE_EXTENSIONS = {
	[AUDIO_QUALITIES.LOSSLESS]: 'flac',
	[AUDIO_QUALITIES.HIGH]: 'm4a',
	[AUDIO_QUALITIES.LOW]: 'm4a'
} as const;

// Performance Levels
export const PERFORMANCE_LEVELS = {
	HIGH: 'high',
	MEDIUM: 'medium',
	LOW: 'low'
} as const;

export type PerformanceLevel = (typeof PERFORMANCE_LEVELS)[keyof typeof PERFORMANCE_LEVELS];
