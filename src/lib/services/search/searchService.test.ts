import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTabSearch, clearSearchCache } from './searchService';

const mockSearchTracks = vi.fn();

vi.mock('$lib/api', () => ({
	losslessAPI: {
		searchTracks: (...args: unknown[]) => mockSearchTracks(...args)
	}
}));

describe('searchService', () => {
	beforeEach(() => {
		clearSearchCache();
		mockSearchTracks.mockResolvedValue({ items: [] });
		vi.clearAllMocks();
	});

	it('does not dedupe requests across regions', async () => {
		await executeTabSearch('test', 'tracks', 'us');
		await executeTabSearch('test', 'tracks', 'eu');

		expect(mockSearchTracks).toHaveBeenCalledTimes(2);
		expect(mockSearchTracks).toHaveBeenNthCalledWith(1, 'test', 'us');
		expect(mockSearchTracks).toHaveBeenNthCalledWith(2, 'test', 'eu');
	});
});
