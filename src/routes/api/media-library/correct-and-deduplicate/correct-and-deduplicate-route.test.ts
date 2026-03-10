import { beforeEach, describe, expect, it, vi } from 'vitest';

const lockMocks = vi.hoisted(() => ({
	acquireMediaMaintenanceLock: vi.fn(),
	getMediaMaintenanceLockHolder: vi.fn()
}));
const mediaLibraryMocks = vi.hoisted(() => ({
	sweepTransientAlbumArtifacts: vi.fn(),
	deduplicateMediaLibrary: vi.fn()
}));
const queueMocks = vi.hoisted(() => ({
	getActiveJobIdsForMaintenance: vi.fn()
}));
const reportMocks = vi.hoisted(() => ({
	writeMediaMaintenanceRunReport: vi.fn()
}));

vi.mock('$lib/server/mediaMaintenanceLock', () => ({
	acquireMediaMaintenanceLock: lockMocks.acquireMediaMaintenanceLock,
	getMediaMaintenanceLockHolder: lockMocks.getMediaMaintenanceLockHolder
}));

vi.mock('$lib/server/mediaLibrary', () => ({
	sweepTransientAlbumArtifacts: mediaLibraryMocks.sweepTransientAlbumArtifacts,
	deduplicateMediaLibrary: mediaLibraryMocks.deduplicateMediaLibrary
}));

vi.mock('$lib/server/downloadQueueManager', () => ({
	getActiveJobIdsForMaintenance: queueMocks.getActiveJobIdsForMaintenance
}));

vi.mock('$lib/server/mediaMaintenanceReports', () => ({
	writeMediaMaintenanceRunReport: reportMocks.writeMediaMaintenanceRunReport
}));

describe('POST /api/media-library/correct-and-deduplicate', () => {
	beforeEach(() => {
		vi.resetModules();
		lockMocks.acquireMediaMaintenanceLock.mockReset();
		lockMocks.getMediaMaintenanceLockHolder.mockReset();
		mediaLibraryMocks.sweepTransientAlbumArtifacts.mockReset();
		mediaLibraryMocks.deduplicateMediaLibrary.mockReset();
		queueMocks.getActiveJobIdsForMaintenance.mockReset();
		reportMocks.writeMediaMaintenanceRunReport.mockReset();
	});

	it('returns partial phase results when dedupe fails after sweep', async () => {
		const release = vi.fn().mockResolvedValue(undefined);
		lockMocks.acquireMediaMaintenanceLock.mockResolvedValue({
			lockId: 'lock-1',
			owner: 'test',
			acquiredAt: Date.now(),
			source: 'memory',
			release
		});
		queueMocks.getActiveJobIdsForMaintenance.mockResolvedValue([]);
		mediaLibraryMocks.sweepTransientAlbumArtifacts.mockResolvedValue({
			scannedAt: Date.now(),
			baseDir: '/tmp/music',
			dryRun: false,
			minAgeMs: 0,
			artistDirsScanned: 1,
			artifactDirsFound: 1,
			artifactDirsRemoved: 1,
			skippedTooFresh: 0,
			skippedActive: 0,
			samplePaths: ['Artist/.Album.publishing-job-1']
		});
		mediaLibraryMocks.deduplicateMediaLibrary.mockRejectedValue(
			new Error('simulated deduplicate failure')
		);
		reportMocks.writeMediaMaintenanceRunReport.mockResolvedValue('/tmp/report.json');

		const { POST } = await import('./+server');
		const response = await POST({
			request: new Request('http://localhost/api/media-library/correct-and-deduplicate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ dryRun: false, forceRescan: true })
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(500);
		const payload = await response.json();
		expect(payload.success).toBe(false);
		expect(payload.error).toContain('simulated deduplicate failure');
		expect(payload.partial?.sweep?.artifactDirsRemoved).toBe(1);
		expect(payload.partial?.deduplicate ?? null).toBeNull();

		expect(reportMocks.writeMediaMaintenanceRunReport).toHaveBeenCalled();
		const lastReportCall = reportMocks.writeMediaMaintenanceRunReport.mock.calls.at(-1)?.[0];
		expect(lastReportCall?.payload?.partial?.sweep?.artifactDirsRemoved).toBe(1);
		expect(lastReportCall?.payload?.partial?.deduplicate ?? null).toBeNull();
		expect(release).toHaveBeenCalledTimes(1);
	});
});
