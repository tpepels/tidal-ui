import type { AudioQuality } from '$lib/types';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import Redis from 'ioredis';

const STATE_FILE = path.join(process.cwd(), 'upload-state.json');

// Redis client for persistence
let redis: Redis | null = null;
let redisConnected = false;

function getRedisClient(): Redis | null {
	if (redisConnected) return redis;
	if (redis) return redis; // Already initialized

	try {
		const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
		redis = new Redis(redisUrl);
		redis.on('error', (err) => {
			console.warn('Redis connection error:', err);
			redis = null; // Fallback to file
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
	details?: any;
	recoverable: boolean;
	retryAfter?: number;
	suggestion?: string;
}

export const createDownloadError = (
	code: string,
	message: string,
	recoverable = false,
	details?: any,
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
const UPLOAD_TTL = 5 * 60 * 1000; // 5 minutes
export const MAX_CONCURRENT_UPLOADS = parseInt(process.env.MAX_CONCURRENT_UPLOADS || '40');
export const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '524288000'); // 500MB default
export const MAX_CHUNK_SIZE = parseInt(process.env.MAX_CHUNK_SIZE || '10485760'); // 10MB default

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
const saveToFile = async (state: any) => {
	try {
		await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
		console.log('Saved upload state to file');
	} catch (err) {
		console.error('Failed to save upload state:', err);
	}
};

// Load upload state
const loadState = async () => {
	let state: any = null;

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
export const retryFs = async (fn: () => Promise<any>, retries = 3): Promise<any> => {
	for (let i = 0; i < retries; i++) {
		try {
			return await fn();
		} catch (err: any) {
			if (i === retries - 1 || !['EAGAIN', 'EBUSY', 'EMFILE'].includes(err.code)) {
				throw err;
			}
			await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1))); // Exponential backoff
		}
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

// Clean up expired uploads
export const cleanupExpiredUploads = async () => {
	const now = Date.now();
	for (const [uploadId, data] of pendingUploads.entries()) {
		if (now - data.timestamp > UPLOAD_TTL) {
			pendingUploads.delete(uploadId);
			activeUploads.delete(uploadId); // Also clean up from active uploads
		}
	}
	for (const [uploadId, data] of chunkUploads.entries()) {
		if (now - data.timestamp > UPLOAD_TTL) {
			// Clean up temp files
			try {
				await fs.unlink(data.tempFilePath).catch(() => {});
			} catch {
				// Ignore cleanup errors
			}
			chunkUploads.delete(uploadId);
			activeUploads.delete(uploadId);
		}
	}
	await saveState();
};

// Clean up expired uploads periodically
export const startCleanupInterval = async () => {
	// Clean up orphaned temp files on startup
	await cleanupTempFiles();
	await loadState();

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
			.replace(/\x00-\x1f/g, '_') // Control characters
			.replace(/^\.+/, '_') // Leading dots (hidden files on Unix)
			.replace(/\.\./g, '__') // Path traversal prevention
			.replace(/\.+$/, '') // Trailing dots
			.replace(/[\s]+/g, ' ') // Multiple spaces to single space
			.trim()
	);
};

// Generate MD5 checksum for file integrity
export const generateChecksum = async (buffer: Buffer): Promise<string> => {
	return createHash('md5').update(buffer).digest('hex');
};

// Validate checksum
export const validateChecksum = async (
	buffer: Buffer,
	expectedChecksum: string
): Promise<boolean> => {
	try {
		const actualChecksum = createHash('md5').update(buffer).digest('hex');
		return actualChecksum === expectedChecksum;
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
	activeUploads.delete(uploadId);
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
						const fileBuffer = await fs.readFile(targetPath);
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
