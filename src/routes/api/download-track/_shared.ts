import type { AudioQuality } from '$lib/types';

export interface PendingUpload {
    trackId: number;
    quality: AudioQuality;
    albumTitle?: string;
    artistName?: string;
    trackTitle?: string;
    timestamp: number;
}

// In-memory store for pending uploads (metadata + uploadId)
// In production, this would use Redis or a database
export const pendingUploads = new Map<string, PendingUpload>();
const UPLOAD_TTL = 5 * 60 * 1000; // 5 minutes

// Clean up expired uploads periodically
export const startCleanupInterval = () => {
    const cleanupExpiredUploads = () => {
        const now = Date.now();
        for (const [uploadId, data] of pendingUploads.entries()) {
            if (now - data.timestamp > UPLOAD_TTL) {
                console.log(`[Server Download] Cleaning up expired upload: ${uploadId}`);
                pendingUploads.delete(uploadId);
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

// Sanitize filename/path components
export const sanitizePath = (input: string | null | undefined): string => {
    if (!input) return 'unknown';
    return String(input)
        .replace(/[^a-zA-Z0-9._\- ]/g, '_')
        .replace(/\s+/g, '_')
        .trim();
};
