/**
 * Playlist Orchestrator Unit Tests
 *
 * Tests 8-phase state machine, progressive conversion, cancellation, and auto-clear.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlaylistOrchestrator } from './playlistOrchestrator';
import type { SonglinkTrack } from '$lib/types';

const {
	mockSearchStoreActions,
	mockSearchStore,
	mockConvertSpotifyPlaylistToTracks,
	mockIsSpotifyPlaylistUrl
} = vi.hoisted(() => ({
	mockSearchStoreActions: {
		commit: vi.fn()
	},
	mockSearchStore: {
		query: '',
		isPlaylistConversionMode: false
	},
	mockConvertSpotifyPlaylistToTracks: vi.fn(),
	mockIsSpotifyPlaylistUrl: vi.fn()
}));

// Mock modules
vi.mock('$lib/stores/searchStoreAdapter', () => ({
	searchStoreActions: mockSearchStoreActions,
	searchStore: mockSearchStore
}));

vi.mock('$lib/services/search/playlistConversionService', () => ({
	convertSpotifyPlaylistToTracks: mockConvertSpotifyPlaylistToTracks,
	isSpotifyPlaylistUrl: mockIsSpotifyPlaylistUrl
}));

vi.mock('svelte/store', () => ({
	get: vi.fn(() => mockSearchStore)
}));

describe('PlaylistOrchestrator', () => {
	let orchestrator: PlaylistOrchestrator;

	const mockTracks: SonglinkTrack[] = [
		{
			id: 'spotify:track:sl-1',
			title: 'Track 1',
			artistName: 'Artist 1',
			duration: 180,
			thumbnailUrl: 'https://song.link/1.jpg',
			sourceUrl: 'https://song.link/1',
			songlinkData: {
				entityUniqueId: 'sl-1',
				userCountry: 'US',
				pageUrl: 'https://song.link/1',
				entitiesByUniqueId: {},
				linksByPlatform: {}
			},
			isSonglinkTrack: true,
			audioQuality: 'LOSSLESS'
		},
		{
			id: 'spotify:track:sl-2',
			title: 'Track 2',
			artistName: 'Artist 2',
			duration: 200,
			thumbnailUrl: 'https://song.link/2.jpg',
			sourceUrl: 'https://song.link/2',
			songlinkData: {
				entityUniqueId: 'sl-2',
				userCountry: 'US',
				pageUrl: 'https://song.link/2',
				entitiesByUniqueId: {},
				linksByPlatform: {}
			},
			isSonglinkTrack: true,
			audioQuality: 'LOSSLESS'
		},
		{
			id: 'spotify:track:sl-3',
			title: 'Track 3',
			artistName: 'Artist 3',
			duration: 220,
			thumbnailUrl: 'https://song.link/3.jpg',
			sourceUrl: 'https://song.link/3',
			songlinkData: {
				entityUniqueId: 'sl-3',
				userCountry: 'US',
				pageUrl: 'https://song.link/3',
				entitiesByUniqueId: {},
				linksByPlatform: {}
			},
			isSonglinkTrack: true,
			audioQuality: 'LOSSLESS'
		}
	];

	beforeEach(() => {
		orchestrator = new PlaylistOrchestrator();
		vi.clearAllMocks();
		vi.useFakeTimers();

		// Default URL validation
		mockIsSpotifyPlaylistUrl.mockReturnValue(true);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('convertPlaylist()', () => {
		it('should convert playlist successfully with store updates', async () => {
			let progressCallback: any;

			mockConvertSpotifyPlaylistToTracks.mockImplementation(async (url, options) => {
				progressCallback = options.onProgress;

				// Simulate progress updates
				progressCallback({ loaded: 1, total: 3, successful: [mockTracks[0]], failed: [] });
				progressCallback({
					loaded: 2,
					total: 3,
					successful: [mockTracks[0], mockTracks[1]],
					failed: []
				});
				progressCallback({ loaded: 3, total: 3, successful: mockTracks, failed: [] });

				return {
					successful: mockTracks,
					failed: [],
					total: 3
				};
			});

			const result = await orchestrator.convertPlaylist(
				'https://open.spotify.com/playlist/123',
				{
					updateSearchStore: true,
					clearQueryOnComplete: false
				}
			);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.tracks).toHaveLength(3);
				expect(result.failed).toHaveLength(0);
				expect(result.total).toBe(3);
			}

			// Verify store updates: initialize, progress updates, finalize
			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					query: 'https://open.spotify.com/playlist/123',
					isLoading: true,
					isPlaylistConversionMode: true,
					playlistLoadingMessage: 'Loading playlist...'
				})
			);

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					playlistConversionTotal: 3,
					playlistLoadingMessage: expect.stringContaining('Loaded')
				})
			);

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					isLoading: false,
					isPlaylistConversionMode: false,
					results: expect.objectContaining({
						tracks: mockTracks
					})
				})
			);
		});

		it('should not update store when updateSearchStore is false', async () => {
			mockConvertSpotifyPlaylistToTracks.mockResolvedValue({
				successful: mockTracks,
				failed: [],
				total: 3
			});

			const result = await orchestrator.convertPlaylist(
				'https://open.spotify.com/playlist/123',
				{
					updateSearchStore: false
				}
			);

			expect(result.success).toBe(true);
			expect(mockSearchStoreActions.commit).not.toHaveBeenCalled();
		});

		it('should clear query when clearQueryOnComplete is true', async () => {
			mockConvertSpotifyPlaylistToTracks.mockResolvedValue({
				successful: mockTracks,
				failed: [],
				total: 3
			});

			await orchestrator.convertPlaylist('https://open.spotify.com/playlist/123', {
				updateSearchStore: true,
				clearQueryOnComplete: true
			});

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					query: ''
				})
			);
		});

		it('should fail for invalid URLs', async () => {
			mockIsSpotifyPlaylistUrl.mockReturnValue(false);

			const result = await orchestrator.convertPlaylist('https://invalid.com', {
				updateSearchStore: true
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe('INVALID_URL');
				expect(result.error.retry).toBe(false);
			}

			expect(mockConvertSpotifyPlaylistToTracks).not.toHaveBeenCalled();
		});

		it('should fail for empty URLs', async () => {
			const result = await orchestrator.convertPlaylist('   ', {
				updateSearchStore: true
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe('INVALID_URL');
			}
		});

		it('should handle empty playlists', async () => {
			mockConvertSpotifyPlaylistToTracks.mockResolvedValue({
				successful: [],
				failed: ['Track 1', 'Track 2'],
				total: 2
			});

			const result = await orchestrator.convertPlaylist(
				'https://open.spotify.com/playlist/123',
				{
					updateSearchStore: true
				}
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe('ALL_TRACKS_FAILED');
				expect(result.error.failedCount).toBe(2);
			}

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.stringContaining('Could not convert any tracks')
				})
			);
		});

		it('should handle conversion errors', async () => {
			mockConvertSpotifyPlaylistToTracks.mockRejectedValue(
				new Error('API rate limit exceeded')
			);

			const result = await orchestrator.convertPlaylist(
				'https://open.spotify.com/playlist/123',
				{
					updateSearchStore: true
				}
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe('FETCH_FAILED');
				expect(result.error.retry).toBe(true);
			}
		});

		it('should schedule auto-clear when autoClearAfterMs is set', async () => {
			mockConvertSpotifyPlaylistToTracks.mockResolvedValue({
				successful: mockTracks,
				failed: [],
				total: 3
			});

			await orchestrator.convertPlaylist('https://open.spotify.com/playlist/123', {
				updateSearchStore: true,
				autoClearAfterMs: 3000
			});

			// Fast-forward time
			vi.advanceTimersByTime(3000);

			// Should have cleared results
			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					query: '',
					results: null,
					isPlaylistConversionMode: false
				})
			);
		});

		it('should handle cancellation via AbortSignal', async () => {
			const abortController = new AbortController();

			mockConvertSpotifyPlaylistToTracks.mockImplementation(async (url, options) => {
				// Simulate progress
				options.onProgress({ loaded: 1, total: 10, successful: [mockTracks[0]], failed: [] });

				// Abort mid-conversion
				abortController.abort();

				// Next progress should throw
				if (abortController.signal.aborted) {
					throw new Error('CONVERSION_CANCELLED');
				}
			});

			const result = await orchestrator.convertPlaylist(
				'https://open.spotify.com/playlist/123',
				{
					updateSearchStore: true,
					signal: abortController.signal
				}
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe('CONVERSION_CANCELLED');
				expect(result.error.retry).toBe(false);
			}
		});
	});

	describe('cancelConversion()', () => {
		it('should cancel active conversion and reset store state', () => {
			mockSearchStore.isPlaylistConversionMode = true;

			orchestrator.cancelConversion();

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					isLoading: false,
					isPlaylistConversionMode: false,
					playlistLoadingMessage: null
				})
			);
		});

		it('should not update store if not in playlist conversion mode', () => {
			mockSearchStore.isPlaylistConversionMode = false;

			orchestrator.cancelConversion();

			expect(mockSearchStoreActions.commit).not.toHaveBeenCalled();
		});

		it('should clear auto-clear timer', async () => {
			mockConvertSpotifyPlaylistToTracks.mockResolvedValue({
				successful: mockTracks,
				failed: [],
				total: 3
			});

			await orchestrator.convertPlaylist('https://open.spotify.com/playlist/123', {
				updateSearchStore: true,
				autoClearAfterMs: 3000
			});

			// Cancel before timer fires
			orchestrator.cancelConversion();

			// Fast-forward time
			vi.advanceTimersByTime(5000);

			// Auto-clear should NOT have fired (timer was cancelled)
			const commitCalls = mockSearchStoreActions.commit.mock.calls;
			const autoClearCall = commitCalls.find(
				(call) =>
					Object.prototype.hasOwnProperty.call(call[0], 'results') && call[0].results === null
			);

			expect(autoClearCall).toBeUndefined();
		});
	});

	describe('clearPlaylistResults()', () => {
		it('should clear playlist state', () => {
			orchestrator.clearPlaylistResults();

			expect(mockSearchStoreActions.commit).toHaveBeenCalledWith(
				expect.objectContaining({
					query: '',
					results: null,
					isPlaylistConversionMode: false,
					playlistConversionTotal: 0,
					playlistLoadingMessage: null
				})
			);
		});

		it('should clear pending auto-clear timer', async () => {
			mockConvertSpotifyPlaylistToTracks.mockResolvedValue({
				successful: mockTracks,
				failed: [],
				total: 3
			});

			await orchestrator.convertPlaylist('https://open.spotify.com/playlist/123', {
				updateSearchStore: true,
				autoClearAfterMs: 3000
			});

			// Manually clear before timer fires
			orchestrator.clearPlaylistResults();

			// Fast-forward time
			vi.advanceTimersByTime(5000);

			// Should only have the manual clear, not the auto-clear
			const commitCalls = mockSearchStoreActions.commit.mock.calls;
			const clearCalls = commitCalls.filter(
				(call) => call[0].results === null && call[0].query === ''
			);

			expect(clearCalls.length).toBe(1);
		});
	});

	describe('convertPlaylistProgressive() - AsyncGenerator', () => {
		it('should yield progress states', async () => {
			mockConvertSpotifyPlaylistToTracks.mockImplementation(async (url, options) => {
				options.onProgress({ loaded: 1, total: 3, successful: [mockTracks[0]], failed: [] });
				options.onProgress({
					loaded: 2,
					total: 3,
					successful: [mockTracks[0], mockTracks[1]],
					failed: []
				});
				options.onProgress({ loaded: 3, total: 3, successful: mockTracks, failed: [] });

				return { successful: mockTracks, failed: [], total: 3 };
			});

			const states: any[] = [];

			for await (const state of orchestrator.convertPlaylistProgressive(
				'https://open.spotify.com/playlist/123'
			)) {
				states.push(state);
			}

			expect(states).toHaveLength(2); // initializing + completed
			expect(states[0].phase).toBe('initializing');
			expect(states[1].phase).toBe('completed');
			expect(states[1].successful).toHaveLength(3);
		});

		it('should yield failed state on error', async () => {
			mockConvertSpotifyPlaylistToTracks.mockRejectedValue(new Error('Conversion failed'));

			const states: any[] = [];

			for await (const state of orchestrator.convertPlaylistProgressive(
				'https://open.spotify.com/playlist/123'
			)) {
				states.push(state);
			}

			expect(states).toHaveLength(2); // initializing + failed
			expect(states[0].phase).toBe('initializing');
			expect(states[1].phase).toBe('failed');
		});

		it('should yield failed for invalid URLs', async () => {
			mockIsSpotifyPlaylistUrl.mockReturnValue(false);

			const states: any[] = [];

			for await (const state of orchestrator.convertPlaylistProgressive(
				'https://invalid.com'
			)) {
				states.push(state);
			}

			expect(states).toHaveLength(1);
			expect(states[0].phase).toBe('failed');
		});
	});

	describe('progress batching', () => {
		it('should use batching and throttling for convertPlaylist', async () => {
			mockConvertSpotifyPlaylistToTracks.mockResolvedValue({
				successful: mockTracks,
				failed: [],
				total: 3
			});

			await orchestrator.convertPlaylist('https://open.spotify.com/playlist/123', {
				updateSearchStore: true
			});

			const lastCall = mockConvertSpotifyPlaylistToTracks.mock.calls[0];
			const options = lastCall[1];

			expect(options.progressBatchSize).toBe(5);
			expect(options.progressThrottleMs).toBe(100);
		});

		it('should use no batching/throttling for convertPlaylistProgressive', async () => {
			mockConvertSpotifyPlaylistToTracks.mockResolvedValue({
				successful: mockTracks,
				failed: [],
				total: 3
			});

			const states: any[] = [];
			for await (const state of orchestrator.convertPlaylistProgressive(
				'https://open.spotify.com/playlist/123'
			)) {
				states.push(state);
			}

			const lastCall = mockConvertSpotifyPlaylistToTracks.mock.calls[0];
			const options = lastCall[1];

			expect(options.progressBatchSize).toBe(1);
			expect(options.progressThrottleMs).toBe(0);
		});
	});
});
