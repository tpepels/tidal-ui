import type { AudioQuality, TrackLookup } from '$lib/types';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import Redis from 'ioredis';

const STATE_FILE = path.join(process.cwd(), 'data', 'upload-state.json');
const CHECKSUM_SAMPLE_BYTES = 1024 * 1024;
const CHECKSUM_ALGORITHM = 'sha256';

// Redis client for persistence
let redis: Redis | null = null;
let redisConnected = false;
let cleanupIntervalStarted = false;

function getRedisClient(): Redis | null {
	const redisDisabled = ['true', '1'].includes((process.env.REDIS_DISABLED || '').toLowerCase());
	if (redisDisabled) {
		return null;
	}

	if (redisConnected) return redis;
	if (redis) return redis; // Already initialized

	try {
		const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
		redis = new Redis(redisUrl);
		redis.on('error', (err) => {
			console.warn('Redis connection error:', err);
			redisConnected = false;
			redis = null; // Fallback to file
		});
		redis.on('close', () => {
			redisConnected = false;
		});
		redis.on('end', () => {
			redisConnected = false;
		});
		redis.on('connect', () => {
			redisConnected = true;
		});
	} catch (err) {
		console.warn('Failed to initialize Redis:', err);
		redis = null;
	}
	return redis;
}

export interface DownloadError {
	code: string;
	message: string;
	details?: unknown;
	recoverable: boolean;
	retryAfter?: number;
	suggestion?: string;
}

export const createDownloadError = (
	code: string,
	message: string,
	recoverable = false,
	details?: unknown,
	retryAfter?: number,
	suggestion?: string
): DownloadError => ({
	code,
	message,
	details,
	recoverable,
	retryAfter,
	suggestion
});

export type ConflictResolution = 'overwrite' | 'skip' | 'rename' | 'overwrite_if_different';

export const ERROR_CODES = {
	// Network errors
	NETWORK_ERROR: 'NETWORK_ERROR',
	TIMEOUT: 'TIMEOUT',
	RATE_LIMITED: 'RATE_LIMITED',

	// File system errors
	DISK_FULL: 'DISK_FULL',
	PERMISSION_DENIED: 'PERMISSION_DENIED',
	FILE_EXISTS: 'FILE_EXISTS',

	// Validation errors
	INVALID_FILE: 'INVALID_FILE',
	CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
	SIZE_MISMATCH: 'SIZE_MISMATCH',

	// Session errors
	SESSION_EXPIRED: 'SESSION_EXPIRED',
	UPLOAD_NOT_FOUND: 'UPLOAD_NOT_FOUND',

	// Generic errors
	UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export interface PendingUpload {
	trackId: number;
	quality: AudioQuality;
	albumTitle?: string;
	artistName?: string;
	trackTitle?: string;
	trackMetadata?: TrackLookup;
	detectedMimeType?: string;
	downloadCoverSeperately?: boolean;
	coverUrl?: string;
	timestamp: number;
	totalSize?: number;
	uploadedChunks?: number[];
	checksum?: string;
	conflictResolution?: ConflictResolution;
}

export interface ChunkUploadState {
	uploadId: string;
	chunkIndex: number;
	totalChunks: number;
	chunkSize: number;
	totalSize: number;
	checksum: string;
	tempFilePath: string;
	completed: boolean;
	timestamp: number;
}

// In-memory store for pending uploads (metadata + uploadId)
// In production, this would use Redis or a database
export const pendingUploads = new Map<string, PendingUpload>();
export const chunkUploads = new Map<string, ChunkUploadState>();
export const activeUploads = new Set<string>();
export const UPLOAD_TTL = 15 * 60 * 1000; // 15 minutes - longer TTL for slow connections/large files
export const MAX_CONCURRENT_UPLOADS = parseInt(process.env.MAX_CONCURRENT_UPLOADS || '40');
export const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '0'); // 0 = unlimited (single-user system)
export const MAX_CHUNK_SIZE = parseInt(process.env.MAX_CHUNK_SIZE || '10485760'); // 10MB default
export const MAX_COVER_BYTES = 10 * 1024 * 1024;
const ALLOWED_COVER_HOSTS = new Set(['resources.tidal.com']);

export const isAllowedCoverUrl = (value: string): boolean => {
	try {
		const parsed = new URL(value);
		return (
			(parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
			ALLOWED_COVER_HOSTS.has(parsed.hostname)
		);
	} catch {
		return false;
	}
};

export const downloadCoverToDir = async (
	coverUrl: string,
	targetDir: string,
	filename = 'cover.jpg'
): Promise<boolean> => {
	if (!isAllowedCoverUrl(coverUrl)) {
		console.warn('[Server Download] Cover URL rejected:', coverUrl);
		return false;
	}
	try {
		console.log('[Server Download] Downloading cover from:', coverUrl);
		const coverResponse = await fetch(coverUrl, {
			headers: {
				Accept: 'image/jpeg,image/jpg,image/png,image/*',
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
			},
			signal: AbortSignal.timeout(10000)
		});

		if (!coverResponse.ok) {
			console.warn('[Server Download] Cover download failed with status:', coverResponse.status);
			return false;
		}

		const contentLength = coverResponse.headers.get('Content-Length');
		const contentLengthBytes = contentLength ? Number.parseInt(contentLength, 10) : null;
		if (
			typeof contentLengthBytes === 'number' &&
			Number.isFinite(contentLengthBytes) &&
			contentLengthBytes > MAX_COVER_BYTES
		) {
			console.warn(
				`[Server Download] Cover size ${contentLengthBytes} exceeds limit (${MAX_COVER_BYTES} bytes)`
			);
			return false;
		}

		const coverBuffer = await coverResponse.arrayBuffer();
		if (coverBuffer.byteLength > MAX_COVER_BYTES) {
			console.warn(
				`[Server Download] Cover size ${coverBuffer.byteLength} exceeds limit (${MAX_COVER_BYTES} bytes)`
			);
			return false;
		}

		const coverPath = path.join(targetDir, filename);
		await fs.writeFile(coverPath, Buffer.from(coverBuffer));
		console.log('[Server Download] Cover saved to:', coverPath);
		return true;
	} catch (coverError) {
		console.warn('[Server Download] Cover download failed:', coverError);
		return false;
	}
};

// Save upload state
const saveState = async () => {
	const state = {
		pendingUploads: Object.fromEntries(pendingUploads),
		chunkUploads: Object.fromEntries(chunkUploads),
		activeUploads: Array.from(activeUploads),
		timestamp: Date.now(),
		version: 1
	};

	const redisClient = getRedisClient();
	if (redisClient) {
		try {
			await redisClient.set('tidal:uploadState', JSON.stringify(state));
			console.log('Saved upload state to Redis');
		} catch (err) {
			console.warn('Failed to save to Redis, falling back to file:', err);
			await saveToFile(state);
		}
	} else {
		await saveToFile(state);
	}
};

// Save to file as fallback
const saveToFile = async (state: unknown) => {
	try {
		// Ensure the data directory exists
		const dataDir = path.dirname(STATE_FILE);
		await fs.mkdir(dataDir, { recursive: true });
		await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
		console.log('Saved upload state to file');
	} catch (err) {
		// Don't throw error - just log it. Upload state persistence is not critical.
		console.warn(
			'Failed to save upload state to file (non-critical):',
			err instanceof Error ? err.message : String(err)
		);
	}
};

// Load upload state
const loadState = async () => {
	let state: {
		version?: number;
		pendingUploads?: Record<string, PendingUpload>;
		chunkUploads?: Record<string, ChunkUploadState>;
		activeUploads?: string[];
	} | null = null;

	const redisClient = getRedisClient();
	if (redisClient) {
		try {
			const data = await redisClient.get('tidal:uploadState');
			if (data) {
				state = JSON.parse(data);
				console.log('Loaded upload state from Redis');
			}
		} catch (err) {
			console.warn('Failed to load from Redis, trying file:', err);
		}
	}

	if (!state) {
		// Fallback to file
		try {
			const data = await fs.readFile(STATE_FILE, 'utf8');
			state = JSON.parse(data);
			console.log('Loaded upload state from file');
		} catch {
			console.warn('No saved upload state found');
			return;
		}
	}

	// Validate and load
	if (state && state.version === 1) {
		for (const [k, v] of Object.entries(state.pendingUploads || {})) {
			pendingUploads.set(k, v as PendingUpload);
		}
		for (const [k, v] of Object.entries(state.chunkUploads || {})) {
			chunkUploads.set(k, v as ChunkUploadState);
		}
		for (const id of state.activeUploads || []) {
			activeUploads.add(id);
		}
		console.log(
			`Recovered ${pendingUploads.size} pending, ${chunkUploads.size} chunk, ${activeUploads.size} active uploads`
		);
	} else {
		console.warn('Invalid or outdated upload state, starting fresh');
	}
};

// Retry wrapper for fs operations
export const retryFs = async <T>(fn: () => Promise<T>, retries = 3): Promise<T> => {
	for (let i = 0; i < retries; i++) {
		try {
			return await fn();
		} catch (err: unknown) {
			const error = err as NodeJS.ErrnoException;
			if (i === retries - 1 || !error.code || !['EAGAIN', 'EBUSY', 'EMFILE'].includes(error.code)) {
				throw err;
			}
			await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1))); // Exponential backoff
		}
	}
	throw new Error('Retry function should never reach this point');
};

export const moveFile = async (sourcePath: string, targetPath: string): Promise<void> => {
	try {
		await retryFs(() => fs.rename(sourcePath, targetPath));
	} catch (err: unknown) {
		const error = err as NodeJS.ErrnoException;
		if (error.code !== 'EXDEV') {
			throw err;
		}
		await retryFs(() => fs.copyFile(sourcePath, targetPath));
		await retryFs(() => fs.unlink(sourcePath));
	}
};

// Clean up orphaned temp files
export const cleanupTempFiles = async () => {
	try {
		const tempDir = getTempDir();
		await ensureDir(tempDir); // Ensure dir exists
		const files = await fs.readdir(tempDir);
		for (const file of files) {
			if (file.endsWith('.tmp')) {
				const filePath = path.join(tempDir, file);
				try {
					await retryFs(() => fs.unlink(filePath));
					console.log(`Cleaned up orphaned temp file: ${filePath}`);
				} catch (err) {
					console.warn(`Failed to clean up temp file ${filePath}:`, err);
				}
			}
		}
	} catch (err) {
		console.error('Error during temp file cleanup:', err);
	}
};

/**
 * Update timestamps for both pending and chunk upload entries atomically.
 * This prevents race conditions where cleanup sees stale pending timestamps
 * while chunk timestamps are fresh.
 */
export const touchUploadTimestamp = (uploadId: string): void => {
	const now = Date.now();
	const pending = pendingUploads.get(uploadId);
	const chunk = chunkUploads.get(uploadId);

	if (pending) {
		pending.timestamp = now;
	}
	if (chunk) {
		chunk.timestamp = now;
	}
};

/**
 * Clean up expired uploads.
 *
 * IMPORTANT: This function must handle the case where pendingUploads and chunkUploads
 * have different timestamps. The fix is to use the MOST RECENT timestamp between
 * the two entries when determining expiration, preventing race conditions where
 * one entry is deleted while the other is still valid.
 */
export const cleanupExpiredUploads = async () => {
	const now = Date.now();
	const idsToCleanup = new Set<string>();

	// First pass: identify uploads to clean up using the most recent timestamp
	// from either pendingUploads or chunkUploads
	for (const [uploadId, pendingData] of pendingUploads.entries()) {
		const chunkData = chunkUploads.get(uploadId);
		// Use the most recent timestamp between pending and chunk entries
		const mostRecentTimestamp = chunkData
			? Math.max(pendingData.timestamp, chunkData.timestamp)
			: pendingData.timestamp;

		if (now - mostRecentTimestamp > UPLOAD_TTL) {
			idsToCleanup.add(uploadId);
		}
	}

	// Also check chunk entries that might not have pending entries
	for (const [uploadId, chunkData] of chunkUploads.entries()) {
		if (chunkData.completed) {
			idsToCleanup.add(uploadId);
			continue;
		}

		const pendingData = pendingUploads.get(uploadId);
		if (!pendingData) {
			// Chunk entry without pending entry - check if chunk entry itself is expired
			// Give it extra grace period since it's actively processing
			const isExpired = now - chunkData.timestamp > UPLOAD_TTL;
			if (isExpired) {
				idsToCleanup.add(uploadId);
			}
		}
	}

	// Second pass: atomically clean up all identified uploads
	for (const uploadId of idsToCleanup) {
		const chunkData = chunkUploads.get(uploadId);
		if (chunkData) {
			try {
				await fs.unlink(chunkData.tempFilePath).catch(() => {});
			} catch {
				// Ignore cleanup errors
			}
		}
		// Delete from all maps together to prevent race conditions
		pendingUploads.delete(uploadId);
		chunkUploads.delete(uploadId);
		activeUploads.delete(uploadId);
	}

	// Clean up orphaned active uploads
	for (const uploadId of activeUploads) {
		if (!pendingUploads.has(uploadId) && !chunkUploads.has(uploadId)) {
			activeUploads.delete(uploadId);
		}
	}

	if (idsToCleanup.size > 0) {
		console.log(`[Cleanup] Removed ${idsToCleanup.size} expired upload session(s)`);
	}
	await saveState();
};

// Force cleanup of all stuck/completed uploads (for manual intervention)
export const forceCleanupAllUploads = async (): Promise<{ cleaned: number }> => {
	let cleaned = 0;

	// Clear all active uploads
	for (const uploadId of activeUploads) {
		activeUploads.delete(uploadId);
		pendingUploads.delete(uploadId);
		chunkUploads.delete(uploadId);
		cleaned++;
	}

	// Clear expired pending uploads
	const now = Date.now();
	for (const [uploadId, data] of pendingUploads.entries()) {
		if (now - data.timestamp > UPLOAD_TTL) {
			pendingUploads.delete(uploadId);
			cleaned++;
		}
	}

	// Clear expired chunk uploads
	for (const [uploadId, data] of chunkUploads.entries()) {
		if (now - data.timestamp > UPLOAD_TTL) {
			try {
				await fs.unlink(data.tempFilePath).catch(() => {});
			} catch {
				// Ignore cleanup errors
			}
			chunkUploads.delete(uploadId);
			cleaned++;
		}
	}

	await saveState();
	console.log(`Force cleaned ${cleaned} uploads`);
	return { cleaned };
};

// Clean up expired uploads periodically
export const startCleanupInterval = async () => {
	if (cleanupIntervalStarted) {
		return;
	}
	cleanupIntervalStarted = true;
	// Clean up orphaned temp files on startup
	await cleanupTempFiles();
	await loadState();
	await cleanupExpiredUploads();

	// Clean up on process exit
	const cleanupOnExit = async () => {
		try {
			await cleanupTempFiles();
			await saveState();
		} catch (err) {
			console.error('Exit cleanup error:', err);
		}
	};
	process.on('SIGINT', cleanupOnExit);
	process.on('SIGTERM', cleanupOnExit);

	// Run cleanup every minute
	if (typeof setInterval !== 'undefined') {
		setInterval(() => {
			cleanupExpiredUploads().catch((err) => console.error('Cleanup error:', err));
		}, 60 * 1000);
	}
};

// Get the download directory from environment variable
export const getDownloadDir = (): string => {
	return process.env.DOWNLOAD_DIR || '/tmp/tidal-ui-downloads';
};

// Sanitize filename/path components - keep spaces for readability but escape problematic characters
export const sanitizePath = (input: string | null | undefined): string => {
	if (!input) return 'Unknown';
	return (
		String(input)
			// Replace problematic characters with safe alternatives
			.replace(/[<>:"/\\|?*]/g, '_') // Windows forbidden chars
			// eslint-disable-next-line no-control-regex
			.replace(/[\x00-\x1F]/g, '_') // Control characters
			.replace(/^\.+/, '_') // Leading dots (hidden files on Unix)
			.replace(/\.\./g, '__') // Path traversal prevention
			.replace(/\.+$/, '') // Trailing dots
			.replace(/[\s]+/g, ' ') // Multiple spaces to single space
			.trim()
	);
};

// Generate MD5 checksum for file integrity
const hashBufferSample = (buffer: Buffer): string => {
	const slice = buffer.subarray(0, Math.min(buffer.length, CHECKSUM_SAMPLE_BYTES));
	return createHash(CHECKSUM_ALGORITHM).update(slice).digest('hex');
};

export const generateChecksum = async (buffer: Buffer): Promise<string> => {
	return hashBufferSample(buffer);
};

// Validate checksum
export const validateChecksum = async (
	buffer: Buffer,
	expectedChecksum: string
): Promise<boolean> => {
	try {
		return hashBufferSample(buffer) === expectedChecksum;
	} catch {
		return false;
	}
};

export const readFileSample = async (filePath: string): Promise<Buffer> => {
	const handle = await fs.open(filePath, 'r');
	try {
		const stats = await handle.stat();
		const length = Math.min(stats.size, CHECKSUM_SAMPLE_BYTES);
		const buffer = Buffer.alloc(length);
		if (length > 0) {
			await handle.read(buffer, 0, length, 0);
		}
		return buffer;
	} finally {
		await handle.close().catch(() => {});
	}
};

export const validateFileChecksum = async (
	filePath: string,
	expectedChecksum: string
): Promise<boolean> => {
	try {
		const sample = await readFileSample(filePath);
		return hashBufferSample(sample) === expectedChecksum;
	} catch {
		return false;
	}
};

// Ensure directory exists
export const ensureDir = async (dirPath: string): Promise<void> => {
	try {
		await import('fs/promises').then((fs) => fs.mkdir(dirPath, { recursive: true }));
	} catch (err) {
		console.error(`Failed to create directory ${dirPath}:`, err);
		throw err;
	}
};

// Get temp directory for chunked uploads
export const getTempDir = (): string => {
	return process.env.TEMP_DIR || '/tmp/tidal-ui-temp';
};

// Upload queue management
export const canStartUpload = (): boolean => {
	return activeUploads.size < MAX_CONCURRENT_UPLOADS;
};

export const startUpload = (uploadId: string): boolean => {
	if (activeUploads.size >= MAX_CONCURRENT_UPLOADS) {
		return false;
	}
	activeUploads.add(uploadId);
	return true;
};

export const endUpload = (uploadId: string): void => {
	// Clean up from all tracking structures
	activeUploads.delete(uploadId);
	pendingUploads.delete(uploadId);
	chunkUploads.delete(uploadId);

	// Save updated state
	saveState().catch((err) => console.warn('Failed to save state after upload end:', err));
};

export const getActiveUploadCount = (): number => {
	return activeUploads.size;
};

export const getQueuePosition = (uploadId: string): number => {
	// Simple queue position based on when the upload was started
	// In a more sophisticated system, this could be a proper queue
	const pendingUploads = Array.from(activeUploads);
	const position = pendingUploads.indexOf(uploadId);
	return position >= 0 ? position : -1;
};

/**
 * Detect audio format from magic bytes in a buffer.
 * FLAC starts with "fLaC" (0x664C6143), MP4 has "ftyp" at offset 4.
 */
export const detectAudioFormatFromBuffer = (
	buffer: Buffer | Uint8Array
): { extension: string; mimeType: string } | null => {
	if (!buffer || buffer.length < 12) return null;

	// FLAC: bytes 0-3 = 0x66 0x4C 0x61 0x43 ("fLaC")
	if (buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43) {
		return { extension: 'flac', mimeType: 'audio/flac' };
	}

	// MP4/M4A: bytes 4-7 = 0x66 0x74 0x79 0x70 ("ftyp")
	if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
		return { extension: 'm4a', mimeType: 'audio/mp4' };
	}

	return null;
};

/**
 * Detect audio format from a file on disk by reading the first 12 bytes.
 */
export const detectAudioFormatFromFile = async (
	filePath: string
): Promise<{ extension: string; mimeType: string } | null> => {
	const handle = await fs.open(filePath, 'r');
	try {
		const buffer = Buffer.alloc(12);
		await handle.read(buffer, 0, 12, 0);
		return detectAudioFormatFromBuffer(buffer);
	} finally {
		await handle.close().catch(() => {});
	}
};

/**
 * Determine file extension for audio quality, with optional format detection override.
 * Priority: magic byte detection > client-detected mimeType > quality-based default.
 */
export const getServerExtension = (
	quality: AudioQuality,
	detectedFormat?: { extension: string } | null,
	detectedMimeType?: string
): string => {
	if (detectedFormat) return detectedFormat.extension;
	if (detectedMimeType) {
		if (detectedMimeType.includes('flac')) return 'flac';
		if (detectedMimeType.includes('mp4') || detectedMimeType.includes('m4a')) return 'm4a';
	}
	if (quality === 'HI_RES_LOSSLESS' || quality === 'LOSSLESS') return 'flac';
	return 'm4a';
};

/**
 * Build a filename for server-side downloads that includes track numbers for ordering.
 * Album title is already part of the directory structure, so it's not duplicated in the filename.
 * Format: "Artist - 01 Title.ext" or "Artist - 01-03 Title.ext" for multi-volume
 */
export const buildServerFilename = (
	artistName: string | undefined,
	trackTitle: string | undefined,
	trackId: number,
	ext: string,
	trackMetadata?: { track?: { trackNumber?: number; volumeNumber?: number; album?: { numberOfVolumes?: number } } },
	trackNumberOverride?: number
): string => {
	if (!trackTitle) {
		return `track-${trackId}.${ext}`;
	}

	const artist = sanitizePath(artistName || 'Unknown');
	const title = sanitizePath(trackTitle);

	// Use override if provided, otherwise extract from metadata
	const trackNumber = trackNumberOverride ?? Number(trackMetadata?.track?.trackNumber);
	const volumeNumber = Number(trackMetadata?.track?.volumeNumber);
	const numberOfVolumes = Number(trackMetadata?.track?.album?.numberOfVolumes);

	let trackPart = '';
	if (Number.isFinite(trackNumber) && trackNumber > 0) {
		if (numberOfVolumes > 1 && Number.isFinite(volumeNumber) && volumeNumber > 0) {
			trackPart = `${volumeNumber}-${trackNumber.toString().padStart(2, '0')} `;
		} else {
			trackPart = `${trackNumber.toString().padStart(2, '0')} `;
		}
	}

	return `${artist} - ${trackPart}${title}.${ext}`;
};

// Handle file conflicts based on resolution strategy
export const resolveFileConflict = async (
	targetPath: string,
	conflictResolution: ConflictResolution = 'overwrite_if_different',
	newFileSize?: number,
	newFileChecksum?: string
): Promise<{ finalPath: string; action: 'overwrite' | 'skip' | 'rename' }> => {
	// Security check: ensure targetPath is within expected directory
	const resolvedTarget = path.resolve(targetPath);
	const baseDir = getDownloadDir();
	const resolvedBase = path.resolve(baseDir);
	if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
		throw new Error('Invalid path: outside allowed directory');
	}
	try {
		await fs.access(targetPath);

		// File exists, handle based on resolution strategy
		switch (conflictResolution) {
			case 'skip':
				return { finalPath: targetPath, action: 'skip' };
			case 'rename': {
				const parsedPath = path.parse(targetPath);
				let counter = 1;
				let newPath = path.join(parsedPath.dir, `${parsedPath.name} (${counter})${parsedPath.ext}`);

				while (
					await fs
						.access(newPath)
						.then(() => true)
						.catch(() => false)
				) {
					counter++;
					newPath = path.join(parsedPath.dir, `${parsedPath.name} (${counter})${parsedPath.ext}`);
				}

				return { finalPath: newPath, action: 'rename' };
			}
			case 'overwrite_if_different': {
				// Check if file is different from what we're uploading
				const stats = await fs.stat(targetPath);
				const existingSize = stats.size;

				// If sizes are different, overwrite
				if (newFileSize && existingSize !== newFileSize) {
					return { finalPath: targetPath, action: 'overwrite' };
				}

				// If checksums are available and different, overwrite
				if (newFileChecksum) {
					try {
						const fileBuffer = await readFileSample(targetPath);
						const existingChecksum = await generateChecksum(fileBuffer);
						if (existingChecksum !== newFileChecksum) {
							return { finalPath: targetPath, action: 'overwrite' };
						}
					} catch (error) {
						// If checksum check fails, assume files are different and overwrite
						console.warn('Failed to check existing file checksum:', error);
						return { finalPath: targetPath, action: 'overwrite' };
					}
				}

				// Files appear to be the same, skip
				return { finalPath: targetPath, action: 'skip' };
			}
			case 'overwrite':
			default:
				return { finalPath: targetPath, action: 'overwrite' };
		}
	} catch {
		// File doesn't exist, use original path
		return { finalPath: targetPath, action: 'overwrite' };
	}
};
