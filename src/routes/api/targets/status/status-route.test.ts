import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRefreshApiTargetsIfStale = vi.fn();
const mockRefreshApiTargets = vi.fn();
const mockGetApiTargetRefreshState = vi.fn();

vi.mock('$lib/config/targets', () => ({
	API_CONFIG: {
		targets: [
			{
				name: 'browse-1',
				baseUrl: 'https://api.monochrome.tf',
				weight: 15,
				requiresProxy: false,
				category: 'auto-only'
			}
		],
		browseTargets: [
			{
				name: 't1',
				baseUrl: 'https://api.monochrome.tf',
				weight: 15,
				requiresProxy: false,
				category: 'auto-only'
			}
		],
		streamTargets: [
			{
				name: 't2',
				baseUrl: 'https://hifi-one.spotisaver.net',
				weight: 15,
				requiresProxy: false,
				category: 'auto-only'
			}
		],
		qobuzTargets: [
			{
				name: 'q1',
				baseUrl: 'https://qdl-api.monochrome.tf',
				weight: 15,
				requiresProxy: false,
				category: 'auto-only'
			}
		]
	},
	refreshApiTargetsIfStale: mockRefreshApiTargetsIfStale,
	refreshApiTargets: mockRefreshApiTargets,
	getApiTargetRefreshState: mockGetApiTargetRefreshState
}));

describe('GET /api/targets/status', () => {
	beforeEach(() => {
		mockRefreshApiTargetsIfStale.mockReset();
		mockRefreshApiTargets.mockReset();
		mockGetApiTargetRefreshState.mockReset();

		mockRefreshApiTargetsIfStale.mockResolvedValue({
			updated: false,
			count: 2,
			source: 'uptime'
		});
		mockRefreshApiTargets.mockResolvedValue({
			updated: true,
			count: 2,
			source: 'uptime',
			lastUpdated: '2026-03-06T22:40:49.638Z'
		});
		mockGetApiTargetRefreshState.mockReturnValue({
			lastSuccessfulRefreshAt: Date.parse('2026-03-06T22:40:49.638Z'),
			source: 'uptime',
			targetCount: 3,
			browseTargetCount: 1,
			streamTargetCount: 1,
			qobuzTargetCount: 1
		});
	});

	it('returns current target refresh state', async () => {
		const { GET } = await import('./+server');
		const response = await GET({
			url: new URL('http://localhost/api/targets/status')
		} as Parameters<typeof GET>[0]);

		expect(response.status).toBe(200);
		expect(mockRefreshApiTargetsIfStale).toHaveBeenCalledTimes(1);
		expect(mockRefreshApiTargets).not.toHaveBeenCalled();

		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.source).toBe('uptime');
		expect(body.lastSuccessfulRefreshIso).toBe('2026-03-06T22:40:49.638Z');
		expect(body.targetCount).toBe(3);
		expect(body.browseTargetCount).toBe(1);
		expect(body.streamTargetCount).toBe(1);
		expect(body.qobuzTargetCount).toBe(1);
		expect(body.targets).toHaveLength(1);
		expect(body.browseTargets).toHaveLength(1);
		expect(body.streamTargets).toHaveLength(1);
		expect(body.qobuzTargets).toHaveLength(1);
	});

	it('forces refresh when refresh query param is set', async () => {
		const { GET } = await import('./+server');
		const response = await GET({
			url: new URL('http://localhost/api/targets/status?refresh=1')
		} as Parameters<typeof GET>[0]);

		expect(response.status).toBe(200);
		expect(mockRefreshApiTargets).toHaveBeenCalledWith({ force: true });
		expect(mockRefreshApiTargetsIfStale).not.toHaveBeenCalled();
	});
});
