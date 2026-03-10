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

function createPostEvent(body: unknown = {}) {
	return {
		request: new Request('http://localhost/api/test', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		url: new URL('http://localhost/api/test')
	};
}

describe('media-library maintenance routes lock conflict', () => {
	beforeEach(() => {
		vi.resetModules();
		lockMocks.acquireMediaMaintenanceLock.mockReset();
		lockMocks.getMediaMaintenanceLockHolder.mockReset();
		mediaLibraryMocks.sweepTransientAlbumArtifacts.mockReset();
		mediaLibraryMocks.deduplicateMediaLibrary.mockReset();
		queueMocks.getActiveJobIdsForMaintenance.mockReset();
		reportMocks.writeMediaMaintenanceRunReport.mockReset();

		lockMocks.acquireMediaMaintenanceLock.mockResolvedValue(null);
		lockMocks.getMediaMaintenanceLockHolder.mockResolvedValue({
			lockId: 'mlock-test',
			owner: 'test-owner',
			acquiredAt: Date.now(),
			source: 'memory'
		});
	});

	it('returns 409 for sweep-temporary when maintenance lock is busy', async () => {
		const { POST } = await import('./sweep-temporary/+server');
		const response = await POST(createPostEvent({ dryRun: false }) as Parameters<typeof POST>[0]);
		expect(response.status).toBe(409);
		const payload = await response.json();
		expect(payload.success).toBe(false);
		expect(payload.error).toContain('already running');
	});

	it('returns 409 for deduplicate when maintenance lock is busy', async () => {
		const { POST } = await import('./deduplicate/+server');
		const response = await POST(
			createPostEvent({ dryRun: false, forceRescan: true }) as Parameters<typeof POST>[0]
		);
		expect(response.status).toBe(409);
		const payload = await response.json();
		expect(payload.success).toBe(false);
		expect(payload.error).toContain('already running');
	});

	it('returns 409 for correct-and-deduplicate when maintenance lock is busy', async () => {
		const { POST } = await import('./correct-and-deduplicate/+server');
		const response = await POST(
			createPostEvent({ dryRun: false, forceRescan: true }) as Parameters<typeof POST>[0]
		);
		expect(response.status).toBe(409);
		const payload = await response.json();
		expect(payload.success).toBe(false);
		expect(payload.error).toContain('already running');
	});
});
