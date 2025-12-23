import type { AudioQuality } from '$lib/types';
import * as path from 'path';

export type ConflictResolution = 'overwrite' | 'skip' | 'rename' | 'overwrite_if_different';

export interface DownloadError {
	code: string;
	message: string;
	details?: any;
	recoverable: boolean;
	retryAfter?: number; // seconds
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
export const MAX_CONCURRENT_UPLOADS = parseInt(process.env.MAX_CONCURRENT_UPLOADS || '3');

// Clean up expired uploads periodically
export const startCleanupInterval = () => {
	const cleanupExpiredUploads = () => {
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
					const fs = require('fs/promises');
					fs.unlink(data.tempFilePath).catch(() => {});
				} catch {}
				chunkUploads.delete(uploadId);
				activeUploads.delete(uploadId);
			}
		}
	};

	// Run cleanup every minute
	if (typeof setInterval !== 'undefined') {
		setInterval(cleanupExpiredUploads, 60 * 1000);
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
			.replace(/\.+$/, '') // Trailing dots
			.replace(/[\s]+/g, ' ') // Multiple spaces to single space
			.trim()
	);
};

// Generate MD5 checksum for file integrity
export const generateChecksum = async (buffer: Buffer): Promise<string> => {
	const crypto = await import('crypto');
	return crypto.default.createHash('md5').update(buffer).digest('hex');
};

// Validate checksum
export const validateChecksum = (buffer: Buffer, expectedChecksum: string): boolean => {
	try {
		const crypto = require('crypto');
		const actualChecksum = crypto.createHash('md5').update(buffer).digest('hex');
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
	const fs = require('fs/promises');

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
