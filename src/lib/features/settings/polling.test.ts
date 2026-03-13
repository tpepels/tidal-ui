import { describe, expect, it, vi } from 'vitest';
import {
	createSettingsStatusPoller,
	formatCorrectionDedupProgress,
	formatFullLibraryRepairProgress,
	formatLibraryDeduplicateProgress
} from './polling';

describe('settings polling helpers', () => {
	it('formats full-library repair progress with current album details', () => {
		const message = formatFullLibraryRepairProgress({
			success: true,
			status: 'running',
			currentAlbum: {
				index: 2,
				total: 10,
				artistName: 'Artist',
				albumTitle: 'Album'
			},
			summary: {
				albumsDiscovered: 10,
				albumsProcessed: 2,
				albumsMatched: 1,
				albumsUnresolved: 0,
				albumsErrored: 0,
				albumsWithRepairTargets: 1,
				albumsWithQueuedRepairs: 1,
				tracksExpected: 12,
				tracksHealthy: 8,
				tracksMissing: 2,
				tracksCorrupt: 2,
				tracksQueued: 4
			}
		});

		expect(message).toContain('2/10');
		expect(message).toContain('Artist - Album');
		expect(message).toContain('Queued 4');
	});

	it('formats correction progress by phase', () => {
		const sweep = formatCorrectionDedupProgress({
			success: true,
			status: 'running',
			phase: 'sweep'
		});
		expect(sweep).toContain('Step 1/2');

		const dedupe = formatCorrectionDedupProgress({
			success: true,
			status: 'running',
			phase: 'deduplicate',
			progress: {
				phase: 'merge',
				message: 'Merging duplicates',
				processed: 3,
				total: 7,
				currentArtistDir: 'Artist',
				currentAlbumDir: 'Album',
				summary: {
					scannedAt: Date.now(),
					dryRun: false,
					albumsScanned: 7,
					duplicateAlbumGroups: 1,
					duplicateAlbumDirs: 2,
					albumsMerged: 1,
					filesMovedBetweenAlbums: 3,
					filesMoveErrors: 0,
					albumsWithTrackDuplicates: 1,
					albumsSkipped: 0,
					duplicateTrackGroups: 1,
					manualReviewRequired: 0,
					duplicateFilesBackedUp: 2,
					backupErrors: 0,
					movedSamples: [],
					backedUpSamples: [],
					skippedSamples: [],
					failedSamples: []
				}
			}
		});
		expect(dedupe).toContain('Step 2/2');
		expect(dedupe).toContain('3/7');
	});

	it('formats deduplicate status summary counters', () => {
		const message = formatLibraryDeduplicateProgress({
			success: true,
			status: 'running',
			progress: {
				phase: 'track_dedupe',
				message: 'Scanning album',
				processed: 11,
				total: 32,
				currentArtistDir: 'A',
				currentAlbumDir: 'B',
				summary: {
					scannedAt: Date.now(),
					dryRun: false,
					albumsScanned: 32,
					duplicateAlbumGroups: 2,
					duplicateAlbumDirs: 2,
					albumsMerged: 4,
					filesMovedBetweenAlbums: 12,
					filesMoveErrors: 0,
					albumsWithTrackDuplicates: 6,
					albumsSkipped: 1,
					duplicateTrackGroups: 9,
					manualReviewRequired: 3,
					duplicateFilesBackedUp: 14,
					backupErrors: 0,
					movedSamples: [],
					backedUpSamples: [],
					skippedSamples: [],
					failedSamples: []
				}
			}
		});

		expect(message).toContain('11/32');
		expect(message).toContain('Merged 4');
		expect(message).toContain('manual review 3');
	});

	it('poller emits updates while active and stops cleanly', async () => {
		type MockStatus = { success: boolean; status: 'running'; step: number };
		vi.useFakeTimers();
		let step = 0;
		const fetchStatus = vi.fn(async (): Promise<MockStatus> => {
			step += 1;
			return { success: true, status: 'running', step };
		});
		const onProgress = vi.fn();

		const poller = createSettingsStatusPoller<MockStatus>({
			fetchStatus,
			isRunningStatus: (status) => status.success === true && status.status === 'running',
			mapProgress: (status) => `step ${status.step}`,
			onProgress,
			intervalMs: 5
		});

		poller.start();
		await vi.advanceTimersByTimeAsync(20);
		poller.stop();
		const callsAtStop = onProgress.mock.calls.length;
		await vi.advanceTimersByTimeAsync(20);
		vi.useRealTimers();

		expect(callsAtStop).toBeGreaterThan(0);
		expect(onProgress).toHaveBeenCalledWith('step 1');
		expect(onProgress.mock.calls.length).toBe(callsAtStop);
	});
});
