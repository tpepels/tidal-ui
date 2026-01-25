import { describe, it, expect } from 'vitest';
import { mapDownloadError } from './downloadErrorMapper';

describe('mapDownloadError', () => {
	it('maps abort errors to cancelled', () => {
		const error = new DOMException('Aborted', 'AbortError');
		const result = mapDownloadError(error);
		expect(result.code).toBe('DOWNLOAD_CANCELLED');
		expect(result.retry).toBe(false);
	});

	it('maps network errors', () => {
		const result = mapDownloadError(new Error('Network connection failed'));
		expect(result.code).toBe('NETWORK_ERROR');
		expect(result.retry).toBe(true);
	});

	it('maps storage errors', () => {
		const result = mapDownloadError(new Error('Disk quota exceeded'));
		expect(result.code).toBe('STORAGE_ERROR');
		expect(result.retry).toBe(true);
	});

	it('maps conversion errors', () => {
		const result = mapDownloadError(new Error('FFmpeg conversion failed'));
		expect(result.code).toBe('CONVERSION_ERROR');
		expect(result.retry).toBe(false);
	});

	it('maps server errors', () => {
		const result = mapDownloadError(new Error('Upload failed with HTTP 500'));
		expect(result.code).toBe('SERVER_ERROR');
		expect(result.retry).toBe(true);
	});

	it('falls back to unknown', () => {
		const result = mapDownloadError({ message: 'Something odd' });
		expect(result.code).toBe('UNKNOWN_ERROR');
	});
});
