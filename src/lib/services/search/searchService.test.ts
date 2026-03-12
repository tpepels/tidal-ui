import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTabSearch, clearSearchCache } from './searchService';
import type { Album, Artist } from '$lib/types';

const mockSearchTracks = vi.fn();
const mockSearchAlbums = vi.fn();
const mockSearchArtists = vi.fn();
const mockGetArtist = vi.fn();

vi.mock('$lib/api', () => ({
	losslessAPI: {
		searchTracks: (...args: unknown[]) => mockSearchTracks(...args),
		searchAlbums: (...args: unknown[]) => mockSearchAlbums(...args),
		searchArtists: (...args: unknown[]) => mockSearchArtists(...args),
		getArtist: (...args: unknown[]) => mockGetArtist(...args)
	}
}));

describe('searchService', () => {
	const baseAlbum: Album = {
		id: 100,
		title: 'Random Access Memories',
		cover: '',
		videoCover: null,
		artist: { id: 10, name: 'Daft Punk', type: 'MAIN' }
	};
	const officialAlbum: Album = {
		id: 101,
		title: 'Random Access Memories (10th Anniversary Edition)',
		cover: '',
		videoCover: null,
		artist: { id: 10, name: 'Daft Punk', type: 'MAIN' },
		discographySource: 'official_tidal'
	};
	const artist: Artist = { id: 10, name: 'Daft Punk', type: 'MAIN' };

	beforeEach(() => {
		clearSearchCache();
		mockSearchTracks.mockResolvedValue({ items: [] });
		mockSearchAlbums.mockResolvedValue({ items: [] });
		mockSearchArtists.mockResolvedValue({ items: [] });
		mockGetArtist.mockResolvedValue({
			...artist,
			albums: [],
			tracks: []
		});
		vi.clearAllMocks();
	});

	it('does not dedupe requests across regions', async () => {
		await executeTabSearch('test', 'tracks', 'us');
		await executeTabSearch('test', 'tracks', 'eu');

		expect(mockSearchTracks).toHaveBeenCalledTimes(2);
		expect(mockSearchTracks).toHaveBeenNthCalledWith(1, 'test', 'us');
		expect(mockSearchTracks).toHaveBeenNthCalledWith(2, 'test', 'eu');
	});

	it('passes optional album artist filter and merges official catalog enrichment', async () => {
		mockSearchAlbums.mockResolvedValue({ items: [baseAlbum] });
		mockSearchArtists.mockResolvedValue({ items: [artist] });
		mockGetArtist.mockResolvedValue({
			...artist,
			albums: [officialAlbum],
			tracks: []
		});

		const result = await executeTabSearch('Random Access Memories', 'albums', 'us', {
			albumArtistQuery: 'Daft Punk'
		});

		expect(mockSearchAlbums).toHaveBeenCalledWith('Random Access Memories', 'us', 'Daft Punk');
		expect(mockSearchArtists).toHaveBeenCalledWith('Daft Punk', 'us');
		expect(mockGetArtist).toHaveBeenCalledWith(artist.id);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.results.albums.some((album) => album.id === officialAlbum.id)).toBe(true);
		}
	});
});
