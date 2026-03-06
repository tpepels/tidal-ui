import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadTrackWithRetry } from '../../core/download/downloadCore';
import { downloadTrackServerSide } from './serverDownloadAdapter';
import type { ApiClient } from '../../core/download/types';

vi.mock('../../core/download/downloadCore', () => ({
	downloadTrackWithRetry: vi.fn()
}));

describe('serverDownloadAdapter result hardening', () => {
	beforeEach(() => {
		vi.mocked(downloadTrackWithRetry).mockReset();
	});

	it('keeps downloaded audio when metadata lookup fails', async () => {
		vi.mocked(downloadTrackWithRetry).mockResolvedValue({
			buffer: new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 0]).buffer,
			mimeType: 'audio/flac',
			receivedBytes: 8,
			totalBytes: 8
		});

		const apiClient = {
			getTrack: vi.fn().mockRejectedValue(new Error('Upstream API error'))
		} as unknown as ApiClient;

		const result = await downloadTrackServerSide({
			trackId: 123,
			quality: 'HI_RES_LOSSLESS',
			apiClient
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.buffer).toBeDefined();
		expect(result.trackLookup).toBeUndefined();
		expect(result.warning).toContain('Metadata lookup failed');
	});

	it('classifies rate limit failures as retryable download errors', async () => {
		vi.mocked(downloadTrackWithRetry).mockRejectedValue(new Error('Too Many Requests'));

		const apiClient = {
			getTrack: vi.fn()
		} as unknown as ApiClient;

		const result = await downloadTrackServerSide({
			trackId: 456,
			quality: 'LOSSLESS',
			apiClient
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.errorCode).toBe('RATE_LIMITED');
		expect(result.retryable).toBe(true);
		expect(result.stage).toBe('download');
	});
});
