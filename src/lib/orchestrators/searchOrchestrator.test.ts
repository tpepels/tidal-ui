/**
 * Search Orchestrator Unit Tests
 *
 * Tests URL type detection, workflow routing, and store coordination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchOrchestrator } from './searchOrchestrator';
import type { Track, Album, Playlist } from '$lib/types';

const {
	mockSearchStoreActions,
	mockToasts,
	mockExecuteTabSearch,
	mockConvertStreamingUrl,
	mockPlaylistOrchestrator,
	mockIsTidalUrl,
	mockIsSupportedStreamingUrl,
	mockIsSpotifyPlaylistUrl,
	mockPrecacheTrackStream,
	mockPlaybackFacade,
	mockPlaybackMachine
} = vi.hoisted(() => ({
	mockSearchStoreActions: {
		search: vi.fn(),
		commit: vi.fn()
	},
	mockToasts: {
		error: vi.fn(),
		success: vi.fn()
	},
	mockExecuteTabSearch: vi.fn(),
	mockConvertStreamingUrl: vi.fn(),
	mockPlaylistOrchestrator: {
		convertPlaylist: vi.fn()
	},
	mockIsTidalUrl: vi.fn(),
	mockIsSupportedStreamingUrl: vi.fn(),
	mockIsSpotifyPlaylistUrl: vi.fn(),
	mockPrecacheTrackStream: vi.fn(),
	mockPlaybackFacade: {
		play: vi.fn(),
		pause: vi.fn(),
		loadQueue: vi.fn()
	},
	mockPlaybackMachine: {
		quality: 'LOSSLESS'
	}
}));

// Mock modules
vi.mock('$lib/stores/searchStoreAdapter', () => ({
	searchStoreActions: mockSearchStoreActions
}));

vi.mock('$lib/stores/playbackMachine.svelte', () => ({
	playbackMachine: mockPlaybackMachine
}));

vi.mock('$lib/stores/toasts', () => ({
	toasts: mockToasts
}));

vi.mock('$lib/services/search/searchService', () => ({
	executeTabSearch: mockExecuteTabSearch
}));

vi.mock('$lib/services/search/streamingUrlConversionService', () => ({
	convertStreamingUrl: mockConvertStreamingUrl,
	precacheTrackStream: mockPrecacheTrackStream
}));

vi.mock('./playlistOrchestrator', () => ({
	playlistOrchestrator: mockPlaylistOrchestrator
}));

vi.mock('$lib/utils/urlParser', () => ({
	isTidalUrl: mockIsTidalUrl
}));

vi.mock('$lib/utils/songlink', () => ({
	isSupportedStreamingUrl: mockIsSupportedStreamingUrl,
	isSpotifyPlaylistUrl: mockIsSpotifyPlaylistUrl
}));

vi.mock('$lib/controllers/playbackFacade', () => ({
	playbackFacade: mockPlaybackFacade
}));


describe('SearchOrchestrator', () => {
	let orchestrator: SearchOrchestrator;

	const mockTrack: Track = {
		id: 123,
		title: 'Test Track',
		duration: 180,
		version: null,
		popularity: 0,
		editable: false,
		explicit: false,
		trackNumber: 1,
		volumeNumber: 1,
		isrc: 'TEST123',
		url: 'https://example.com',
		audioQuality: 'LOSSLESS',
		audioModes: ['STEREO'],
		allowStreaming: true,
		streamReady: true,
		streamStartDate: '2020-01-01',
		premiumStreamingOnly: false,
		replayGain: -6.5,
		peak: 0.95,
		artist: { id: 1, name: 'Test Artist', type: 'MAIN', url: '', picture: '' },
		artists: [{ id: 1, name: 'Test Artist', type: 'MAIN', url: '', picture: '' }],
		album: {
			id: 1,
			title: 'Test Album',
			cover: '',
			videoCover: null,
			releaseDate: '2020-01-01',
			numberOfTracks: 10,
			numberOfVolumes: 1,
			duration: 1800
		}
	};

	const mockAlbum: Album = {
		id: 1,
		title: 'Test Album',
		cover: 'https://example.com/cover.jpg',
		videoCover: null,
		releaseDate: '2020-01-01',
		numberOfTracks: 10,
		numberOfVolumes: 1,
		duration: 1800
	};

	const mockPlaylist: Playlist = {
		uuid: 'pl-123',
		title: 'Test Playlist',
		description: 'Test playlist',
		numberOfTracks: 5,
		numberOfVideos: 0,
		duration: 900,
		image: 'https://example.com/playlist.jpg',
		squareImage: 'https://example.com/playlist-square.jpg',
		url: 'https://tidal.com/playlist/pl-123',
		creator: { id: 1, name: 'Test User', picture: null },
		created: '2024-01-01',
		lastUpdated: '2024-01-02',
		type: 'playlist',
		publicPlaylist: true,
		popularity: 0
	};

	beforeEach(() => {
		orchestrator = new SearchOrchestrator();
		vi.clearAllMocks();

		// Default URL detection behavior
		mockIsTidalUrl.mockReturnValue(false);
		mockIsSupportedStreamingUrl.mockReturnValue(false);
		mockIsSpotifyPlaylistUrl.mockReturnValue(false);
	});

	describe('detectUrlType()', () => {
		it('should detect Spotify playlist URLs', () => {
			mockIsSpotifyPlaylistUrl.mockReturnValue(true);

			const result = orchestrator.detectUrlType('https://open.spotify.com/playlist/123');

			expect(result).toBe('spotify-playlist');
			expect(mockIsSpotifyPlaylistUrl).toHaveBeenCalledWith('https://open.spotify.com/playlist/123');
		});

		it('should detect streaming URLs (Spotify track, Apple Music, etc.)', () => {
			mockIsSupportedStreamingUrl.mockReturnValue(true);

			const result = orchestrator.detectUrlType('https://open.spotify.com/track/123');

			expect(result).toBe('streaming');
		});

		it('should detect TIDAL URLs', () => {
			mockIsTidalUrl.mockReturnValue(true);

			const result = orchestrator.detectUrlType('https://tidal.com/track/123');

			expect(result).toBe('tidal');
		});

		it('should return "none" for regular search queries', () => {
			const result = orchestrator.detectUrlType('search query');

			expect(result).toBe('none');
		});

		it('should return "none" for empty strings', () => {
			const result = orchestrator.detectUrlType('');

			expect(result).toBe('none');
		});
	});

	describe('search() - Standard Search Workflow', () => {
		it('should execute standard search successfully', async () => {
			mockExecuteTabSearch.mockResolvedValue({
				success: true,
				results: {
					tracks: [mockTrack],
					albums: [],
					artists: [],
					playlists: []
				}
			});

			const result = await orchestrator.search('test query', 'tracks', {
				region: 'us',
				showErrorToasts: true
			});

			expect(result.workflow).toBe('standard');
			expect(result.success).toBe(true);

			if (result.workflow === 'standard' && result.success) {
				expect(result.results.tracks).toHaveLength(1);
			}

			expect(mockSearchStoreActions.search).toHaveBeenCalledWith('test query', 'tracks');
			expect(mockExecuteTabSearch).toHaveBeenCalledWith('test query', 'tracks', 'us');
			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					results: expect.any(Object),
					isLoading: false,
					error: null
				})
			);
		});

		it('ignores stale results when a newer search completes', async () => {
			let resolveFirst: (value: any) => void;
			let resolveSecond: (value: any) => void;
			const firstPromise = new Promise((resolve) => {
				resolveFirst = resolve;
			});
			const secondPromise = new Promise((resolve) => {
				resolveSecond = resolve;
			});

			mockExecuteTabSearch.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

			const firstSearch = orchestrator.search('first', 'tracks', { region: 'us' });
			const secondSearch = orchestrator.search('second', 'tracks', { region: 'us' });

			resolveSecond!({
				success: true,
				results: {
					tracks: [{ ...mockTrack, id: 200 }],
					albums: [],
					artists: [],
					playlists: []
				}
			});

			resolveFirst!({
				success: true,
				results: {
					tracks: [{ ...mockTrack, id: 100 }],
					albums: [],
					artists: [],
					playlists: []
				}
			});

			await Promise.all([firstSearch, secondSearch]);

			const resultCommits = mockSearchStoreActions.commit.mock.calls
				.map((call) => call[0])
				.filter((payload) => payload?.results?.tracks?.length);
			const committedTrackIds = resultCommits.map(
				(payload) => payload.results.tracks[0]?.id
			);

			expect(committedTrackIds).toContain(200);
			expect(committedTrackIds).not.toContain(100);
		});

		it('should handle search errors with toast notification', async () => {
			mockExecuteTabSearch.mockResolvedValue({
				success: false,
				error: {
					code: 'NETWORK_ERROR',
					retry: true,
					message: 'Network error occurred'
				}
			});

			const result = await orchestrator.search('test query', 'tracks', {
				showErrorToasts: true
			});

			expect(result.workflow).toBe('standard');
			expect(result.success).toBe(false);

			if (result.workflow === 'standard' && !result.success) {
				expect(result.error.code).toBe('NETWORK_ERROR');
			}

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Network error occurred',
					isLoading: false
				})
			);

			expect(mockToasts.error).toHaveBeenCalledWith(
				expect.stringContaining('Network error'),
				expect.objectContaining({
					action: expect.objectContaining({ label: 'Retry' })
				})
			);
		});

		it('should return error for empty query', async () => {
			const result = await orchestrator.search('', 'tracks');

			expect(result.workflow).toBe('standard');
			expect(result.success).toBe(false);

			if (result.workflow === 'standard' && !result.success) {
				expect(result.error.code).toBe('INVALID_QUERY');
			}

			expect(mockExecuteTabSearch).not.toHaveBeenCalled();
		});
	});

	describe('search() - Streaming URL Workflow', () => {
		beforeEach(() => {
			mockIsSupportedStreamingUrl.mockReturnValue(true);
		});

		it('should convert track URL and auto-play', async () => {
			mockConvertStreamingUrl.mockResolvedValue({
				success: true,
				data: {
					type: 'track',
					track: mockTrack
				}
			});

			mockPrecacheTrackStream.mockResolvedValue(undefined);

			const result = await orchestrator.search('https://open.spotify.com/track/123', 'tracks');

			expect(result.workflow).toBe('streamingUrl');
			expect(result.success).toBe(true);

			if (result.workflow === 'streamingUrl' && result.success) {
				expect(result.action).toBe('play');
				expect(result.data).toEqual(mockTrack);
			}

			expect(mockPrecacheTrackStream).toHaveBeenCalledWith(123, 'LOSSLESS');
			expect(mockPlaybackFacade.loadQueue).toHaveBeenCalledWith([mockTrack], 0);
			expect(mockPlaybackFacade.play).toHaveBeenCalled();
			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					query: '',
					isLoading: false
				})
			);
		});

		it('should convert album URL and show in results', async () => {
			mockConvertStreamingUrl.mockResolvedValue({
				success: true,
				data: {
					type: 'album',
					album: mockAlbum
				}
			});

			const result = await orchestrator.search('https://open.spotify.com/album/123', 'albums');

			expect(result.workflow).toBe('streamingUrl');
			expect(result.success).toBe(true);

			if (result.workflow === 'streamingUrl' && result.success) {
				expect(result.action).toBe('showAlbum');
				expect(result.data).toEqual(mockAlbum);
			}

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					activeTab: 'albums',
					results: expect.objectContaining({
						albums: [mockAlbum]
					}),
					query: '',
					isLoading: false
				})
			);
		});

		it('should convert playlist URL and show in results', async () => {
			mockConvertStreamingUrl.mockResolvedValue({
				success: true,
				data: {
					type: 'playlist',
					playlist: mockPlaylist
				}
			});

			const result = await orchestrator.search('https://open.spotify.com/playlist/123', 'playlists');

			expect(result.workflow).toBe('streamingUrl');
			expect(result.success).toBe(true);

			if (result.workflow === 'streamingUrl' && result.success) {
				expect(result.action).toBe('showPlaylist');
				expect(result.data).toEqual(mockPlaylist);
			}

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					activeTab: 'playlists',
					results: expect.objectContaining({
						playlists: [mockPlaylist]
					})
				})
			);
		});

		it('should handle streaming URL conversion errors', async () => {
			mockConvertStreamingUrl.mockResolvedValue({
				success: false,
				error: {
					code: 'NOT_FOUND_ON_TIDAL',
					retry: false,
					message: 'Track not found on TIDAL'
				}
			});

			const result = await orchestrator.search('https://open.spotify.com/track/123', 'tracks');

			expect(result.workflow).toBe('streamingUrl');
			expect(result.success).toBe(false);

			if (result.workflow === 'streamingUrl' && !result.success) {
				expect(result.error.code).toBe('NOT_FOUND_ON_TIDAL');
			}

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Track not found on TIDAL',
					isLoading: false
				})
			);
		});
	});

	describe('search() - Spotify Playlist Workflow', () => {
		beforeEach(() => {
			mockIsSpotifyPlaylistUrl.mockReturnValue(true);
		});

		it('should delegate to playlistOrchestrator', async () => {
			mockPlaylistOrchestrator.convertPlaylist.mockResolvedValue({
				success: true,
				tracks: [mockTrack],
				failed: [],
				total: 1
			});

			const result = await orchestrator.search(
				'https://open.spotify.com/playlist/123',
				'tracks'
			);

			expect(result.workflow).toBe('playlist');
			expect(result.success).toBe(true);

			if (result.workflow === 'playlist' && result.success) {
				expect(result.delegated).toBe(true);
			}

			expect(mockPlaylistOrchestrator.convertPlaylist).toHaveBeenCalledWith(
				'https://open.spotify.com/playlist/123',
				expect.objectContaining({
					updateSearchStore: true,
					clearQueryOnComplete: true,
					autoClearAfterMs: 3000
				})
			);
		});

		it('should handle playlist conversion errors', async () => {
			mockPlaylistOrchestrator.convertPlaylist.mockResolvedValue({
				success: false,
				error: {
					code: 'EMPTY_PLAYLIST',
					retry: false,
					message: 'Playlist is empty'
				}
			});

			const result = await orchestrator.search(
				'https://open.spotify.com/playlist/123',
				'tracks'
			);

			expect(result.workflow).toBe('playlist');
			expect(result.success).toBe(false);
		});
	});

	describe('changeTab()', () => {
		it('should update active tab in store', () => {
			orchestrator.changeTab('albums');

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith({
				activeTab: 'albums'
			});
		});
	});

	describe('clear()', () => {
		it('should reset search state', () => {
			orchestrator.clear();

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					query: '',
					results: null,
					error: null,
					isLoading: false,
					tabLoading: expect.objectContaining({
						tracks: false,
						albums: false,
						artists: false,
						playlists: false
					})
				})
			);
		});
	});
});
