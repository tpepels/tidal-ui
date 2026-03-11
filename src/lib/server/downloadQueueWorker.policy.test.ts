import { describe, expect, it } from 'vitest';
import { __test } from './downloadQueueWorker';

describe('downloadQueueWorker policy helpers', () => {
	it('detects missing published tracks by expected filename', () => {
		const missing = __test.findMissingPublishedTracks({
			expectedTracks: [
				{ trackId: 1, trackTitle: 'A', trackNumber: 1 },
				{ trackId: 2, trackTitle: 'B', trackNumber: 2 },
				{ trackId: 3, trackTitle: 'C', trackNumber: 3 }
			],
			expectedFileByTrackId: new Map([
				[1, '01 - A.flac'],
				[2, '02 - B.flac'],
				[3, '03 - C.flac']
			]),
			publishedFiles: new Set(['01 - A.flac', '03 - C.flac'])
		});

		expect(missing.map((track) => track.trackId)).toEqual([2]);
	});

	it('accepts Picard-style fallback filenames during reconciliation', () => {
		const missing = __test.findMissingPublishedTracks({
			expectedTracks: [{ trackId: 10, trackTitle: 'Teachers', trackNumber: 10 }],
			expectedFileByTrackId: new Map(),
			publishedFiles: new Set(['10. Teachers.flac'])
		});

		expect(missing).toEqual([]);
	});

	it('marks definitive external failures correctly', () => {
		expect(
			__test.isDefinitiveExternalTrackFailure({
				errorCategory: 'auth',
				error: 'Unauthorized',
				retryable: false
			})
		).toBe(true);

		expect(
			__test.isDefinitiveExternalTrackFailure({
				errorCategory: 'network',
				error: 'Timeout',
				retryable: true
			})
		).toBe(false);
	});

	it('derives stable failure codes for dashboards', () => {
		expect(__test.deriveFailureCode('rate_limit', 'HTTP 429 Too Many Requests')).toBe(
			'UPSTREAM_RATE_LIMITED'
		);
		expect(__test.deriveFailureCode('network', 'Connection timeout')).toBe('UPSTREAM_TIMEOUT');
		expect(__test.deriveFailureCode('unknown', 'ffprobe found no audio stream')).toBe(
			'INTEGRITY_VALIDATION_FAILED'
		);
	});
});
