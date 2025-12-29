import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	SearchStateMachine,
	type SearchState,
	type SearchEvent,
	type SearchResults
} from '../../../test-utils/stateMachines/SearchStateMachine';

// Mock data for testing
const mockTrack = {
	id: 123,
	title: 'Test Track',
	duration: 180,
	replayGain: -6.5,
	peak: 0.8,
	allowStreaming: true,
	streamReady: true,
	streamStartDate: '2023-01-01',
	premiumStreamingOnly: false,
	trackNumber: 1,
	volumeNumber: 1,
	version: null,
	popularity: 85,
	copyright: '© 2023 Test Records',
	url: 'https://example.com/track/123',
	isrc: 'TEST123456789',
	editable: false,
	explicit: false,
	audioQuality: 'LOSSLESS',
	audioModes: ['STEREO'],
	artist: {
		id: 456,
		name: 'Test Artist',
		type: 'artist',
		picture: 'https://example.com/artist.jpg',
		url: 'https://example.com/artist/456'
	},
	artists: [
		{
			id: 456,
			name: 'Test Artist',
			type: 'artist',
			picture: 'https://example.com/artist.jpg',
			url: 'https://example.com/artist/456'
		}
	],
	album: {
		id: 789,
		title: 'Test Album',
		cover: 'https://example.com/album.jpg',
		videoCover: null,
		releaseDate: '2023-01-01',
		duration: 1800,
		numberOfTracks: 10,
		numberOfVideos: 0,
		numberOfVolumes: 1,
		explicit: false,
		popularity: 75,
		type: 'album',
		upc: '1234567890123',
		copyright: '© 2023 Test Records',
		artist: {
			id: 456,
			name: 'Test Artist',
			type: 'artist'
		},
		audioQuality: 'LOSSLESS',
		audioModes: ['STEREO'],
		url: 'https://example.com/album/789'
	}
};

const mockAlbum = {
	id: 789,
	title: 'Test Album',
	cover: 'https://example.com/album.jpg',
	videoCover: null,
	releaseDate: '2023-01-01',
	duration: 1800,
	numberOfTracks: 10,
	numberOfVideos: 0,
	numberOfVolumes: 1,
	explicit: false,
	popularity: 75,
	type: 'album',
	upc: '1234567890123',
	copyright: '© 2023 Test Records',
	artist: {
		id: 456,
		name: 'Test Artist',
		type: 'artist'
	},
	artists: [
		{
			id: 456,
			name: 'Test Artist',
			type: 'artist'
		}
	],
	audioQuality: 'LOSSLESS',
	audioModes: ['STEREO'],
	url: 'https://example.com/album/789'
};

const mockArtist = {
	id: 456,
	name: 'Test Artist',
	type: 'artist',
	picture: 'https://example.com/artist.jpg',
	url: 'https://example.com/artist/456',
	popularity: 80,
	artistTypes: ['ARTIST'],
	artistRoles: [
		{
			category: 'Artist',
			categoryId: 1
		}
	]
};

const mockPlaylist = {
	uuid: 'playlist-123',
	title: 'Test Playlist',
	description: 'A test playlist',
	image: 'https://example.com/playlist.jpg',
	squareImage: 'https://example.com/playlist-square.jpg',
	duration: 3600,
	numberOfTracks: 20,
	numberOfVideos: 0,
	creator: {
		id: 999,
		name: 'Test User',
		picture: null
	},
	created: '2023-01-01',
	lastUpdated: '2023-01-01',
	type: 'playlist',
	publicPlaylist: true,
	url: 'https://example.com/playlist/playlist-123',
	popularity: 65
};

const mockSearchResults: SearchResults = {
	tracks: [mockTrack],
	albums: [mockAlbum],
	artists: [mockArtist],
	playlists: [mockPlaylist]
};

describe('SearchStateMachine', () => {
	let machine: SearchStateMachine;
	let stateChanges: Array<{ state: SearchState; previousState: SearchState }>;

	beforeEach(() => {
		machine = new SearchStateMachine();
		stateChanges = [];
		const unsubscribe = machine.subscribe((state, previousState) => {
			stateChanges.push({ state, previousState });
		});
		// Don't unsubscribe as we want to track all changes during the test
	});

	describe('Initial State', () => {
		it('should start in idle state', () => {
			expect(machine.currentState.status).toBe('idle');
		});

		it('should return null for current query and tab when idle', () => {
			expect(machine.getCurrentQuery()).toBeNull();
			expect(machine.getCurrentTab()).toBeNull();
		});

		it('should return null for results and error when idle', () => {
			expect(machine.getResults()).toBeNull();
			expect(machine.getError()).toBeNull();
		});

		it('should indicate it can search when idle', () => {
			expect(machine.canSearch()).toBe(true);
		});

		it('should not be searching when idle', () => {
			expect(machine.isSearching()).toBe(false);
		});
	});

	describe('Idle State Transitions', () => {
		it('should transition to searching when SEARCH event is sent', () => {
			const success = machine.transition({ type: 'SEARCH', query: 'test query', tab: 'tracks' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('searching');
			expect((machine.currentState as any).query).toBe('test query');
			expect((machine.currentState as any).tab).toBe('tracks');
			expect((machine.currentState as any).abortController).toBeInstanceOf(AbortController);
			expect(stateChanges).toHaveLength(1);
		});

		it('should stay idle when RESET event is sent', () => {
			const success = machine.transition({ type: 'RESET' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('idle');
			expect(stateChanges).toHaveLength(0); // No state change
		});

		it('should reject invalid transitions from idle', () => {
			const invalidEvents: SearchEvent[] = [
				{ type: 'CHANGE_TAB', tab: 'albums' },
				{ type: 'RESULTS', results: mockSearchResults },
				{ type: 'ERROR', error: new Error('test') },
				{ type: 'CANCEL' }
			];

			for (const event of invalidEvents) {
				const success = machine.transition(event);
				expect(success).toBe(false);
				expect(machine.currentState.status).toBe('idle');
			}
		});
	});

	describe('Searching State Transitions', () => {
		beforeEach(() => {
			machine.transition({ type: 'SEARCH', query: 'test query', tab: 'tracks' });
			// Clear state changes from setup
			stateChanges = [];
		});

		it('should start new search when SEARCH event occurs', () => {
			const success = machine.transition({ type: 'SEARCH', query: 'new query', tab: 'albums' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('searching');
			expect((machine.currentState as any).query).toBe('new query');
			expect((machine.currentState as any).tab).toBe('albums');
			expect((machine.currentState as any).abortController).toBeInstanceOf(AbortController);
			expect(stateChanges).toHaveLength(1);
		});

		it('should change tab while searching when CHANGE_TAB event occurs', () => {
			const success = machine.transition({ type: 'CHANGE_TAB', tab: 'artists' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('searching');
			expect((machine.currentState as any).tab).toBe('artists');
			expect((machine.currentState as any).query).toBe('test query'); // Query unchanged
			expect(stateChanges).toHaveLength(1);
		});

		it('should transition to results when RESULTS event occurs', () => {
			const success = machine.transition({ type: 'RESULTS', results: mockSearchResults });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('results');
			expect((machine.currentState as any).query).toBe('test query');
			expect((machine.currentState as any).results).toBe(mockSearchResults);
			expect((machine.currentState as any).tab).toBe('tracks');
			expect(stateChanges).toHaveLength(1);
		});

		it('should transition to error when ERROR event occurs', () => {
			const testError = new Error('Search failed');
			const success = machine.transition({ type: 'ERROR', error: testError });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('error');
			expect((machine.currentState as any).error).toBe(testError);
			expect((machine.currentState as any).canRetry).toBe(true);
			expect((machine.currentState as any).query).toBe('test query');
			expect((machine.currentState as any).tab).toBe('tracks');
			expect(stateChanges).toHaveLength(1);
		});

		it('should transition to idle when CANCEL event occurs', () => {
			const success = machine.transition({ type: 'CANCEL' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('idle');
			expect(stateChanges).toHaveLength(1);
		});

		it('should cancel abort controller when CANCEL event occurs', () => {
			const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
			machine.transition({ type: 'CANCEL' });
			expect(abortSpy).toHaveBeenCalled();
			abortSpy.mockRestore();
		});

		it('should reject invalid transitions from searching', () => {
			const invalidEvents: SearchEvent[] = [{ type: 'RESET' }];

			for (const event of invalidEvents) {
				const success = machine.transition(event);
				expect(success).toBe(false);
				expect(machine.currentState.status).toBe('searching');
			}
		});
	});

	describe('Results State Transitions', () => {
		beforeEach(() => {
			// Set up results state
			machine.transition({ type: 'SEARCH', query: 'test query', tab: 'tracks' });
			machine.transition({ type: 'RESULTS', results: mockSearchResults });
			stateChanges = [];
		});

		it('should start new search when SEARCH event occurs', () => {
			const success = machine.transition({ type: 'SEARCH', query: 'new query', tab: 'albums' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('searching');
			expect((machine.currentState as any).query).toBe('new query');
			expect((machine.currentState as any).tab).toBe('albums');
			expect(stateChanges).toHaveLength(1);
		});

		it('should change tab when CHANGE_TAB event occurs', () => {
			const success = machine.transition({ type: 'CHANGE_TAB', tab: 'playlists' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('results');
			expect((machine.currentState as any).tab).toBe('playlists');
			expect((machine.currentState as any).query).toBe('test query'); // Query unchanged
			expect((machine.currentState as any).results).toBe(mockSearchResults); // Results unchanged
			expect(stateChanges).toHaveLength(1);
		});

		it('should transition to idle when RESET event occurs', () => {
			const success = machine.transition({ type: 'RESET' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('idle');
			expect(stateChanges).toHaveLength(1);
		});

		it('should reject invalid transitions from results', () => {
			const invalidEvents: SearchEvent[] = [
				{ type: 'RESULTS', results: mockSearchResults },
				{ type: 'ERROR', error: new Error('test') },
				{ type: 'CANCEL' }
			];

			for (const event of invalidEvents) {
				const success = machine.transition(event);
				expect(success).toBe(false);
				expect(machine.currentState.status).toBe('results');
			}
		});
	});

	describe('Error State Transitions', () => {
		beforeEach(() => {
			// Set up error state
			machine.transition({ type: 'SEARCH', query: 'test query', tab: 'tracks' });
			machine.transition({ type: 'ERROR', error: new Error('Test error') });
			stateChanges = [];
		});

		it('should start new search when SEARCH event occurs', () => {
			const success = machine.transition({ type: 'SEARCH', query: 'new query', tab: 'artists' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('searching');
			expect((machine.currentState as any).query).toBe('new query');
			expect((machine.currentState as any).tab).toBe('artists');
			expect(stateChanges).toHaveLength(1);
		});

		it('should transition to idle when RESET event occurs', () => {
			const success = machine.transition({ type: 'RESET' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('idle');
			expect(stateChanges).toHaveLength(1);
		});

		it('should reject invalid transitions from error', () => {
			const invalidEvents: SearchEvent[] = [
				{ type: 'CHANGE_TAB', tab: 'albums' },
				{ type: 'RESULTS', results: mockSearchResults },
				{ type: 'ERROR', error: new Error('another error') },
				{ type: 'CANCEL' }
			];

			for (const event of invalidEvents) {
				const success = machine.transition(event);
				expect(success).toBe(false);
				expect(machine.currentState.status).toBe('error');
			}
		});
	});

	describe('Convenience Methods', () => {
		it('should correctly report capabilities in different states', () => {
			// Idle state
			expect(machine.canSearch()).toBe(true);
			expect(machine.isSearching()).toBe(false);

			// Searching state
			machine.transition({ type: 'SEARCH', query: 'test', tab: 'tracks' });
			expect(machine.canSearch()).toBe(false); // Can't search while searching
			expect(machine.isSearching()).toBe(true);

			// Results state
			machine.transition({ type: 'RESULTS', results: mockSearchResults });
			expect(machine.canSearch()).toBe(true); // Can search from results
			expect(machine.isSearching()).toBe(false);

			// Error state
			machine.transition({ type: 'SEARCH', query: 'test', tab: 'tracks' });
			machine.transition({ type: 'ERROR', error: new Error('test') });
			expect(machine.canSearch()).toBe(true); // Can search from error
			expect(machine.isSearching()).toBe(false);
		});

		it('should return correct current query for different states', () => {
			// Idle
			expect(machine.getCurrentQuery()).toBeNull();

			// Searching
			machine.transition({ type: 'SEARCH', query: 'test query', tab: 'tracks' });
			expect(machine.getCurrentQuery()).toBe('test query');

			// Results
			machine.transition({ type: 'RESULTS', results: mockSearchResults });
			expect(machine.getCurrentQuery()).toBe('test query');

			// Error
			machine.transition({ type: 'SEARCH', query: 'another query', tab: 'tracks' });
			machine.transition({ type: 'ERROR', error: new Error('test') });
			expect(machine.getCurrentQuery()).toBe('another query');
		});

		it('should return correct current tab for different states', () => {
			// Idle
			expect(machine.getCurrentTab()).toBeNull();

			// Searching
			machine.transition({ type: 'SEARCH', query: 'test', tab: 'albums' });
			expect(machine.getCurrentTab()).toBe('albums');

			// Results
			machine.transition({ type: 'RESULTS', results: mockSearchResults });
			expect(machine.getCurrentTab()).toBe('albums');

			// Error
			machine.transition({ type: 'SEARCH', query: 'test', tab: 'artists' });
			machine.transition({ type: 'ERROR', error: new Error('test') });
			expect(machine.getCurrentTab()).toBe('artists');
		});

		it('should return correct results and error for different states', () => {
			// Idle
			expect(machine.getResults()).toBeNull();
			expect(machine.getError()).toBeNull();

			// Searching
			machine.transition({ type: 'SEARCH', query: 'test', tab: 'tracks' });
			expect(machine.getResults()).toBeNull();
			expect(machine.getError()).toBeNull();

			// Results
			machine.transition({ type: 'RESULTS', results: mockSearchResults });
			expect(machine.getResults()).toEqual(mockSearchResults);
			expect(machine.getError()).toBeNull();

			// Error
			const testError = new Error('Search failed');
			machine.transition({ type: 'SEARCH', query: 'test', tab: 'tracks' });
			machine.transition({ type: 'ERROR', error: testError });
			expect(machine.getResults()).toBeNull();
			expect(machine.getError()).toBe(testError);
		});
	});

	describe('Cancel Current Search', () => {
		it('should cancel search when in searching state', () => {
			machine.transition({ type: 'SEARCH', query: 'test', tab: 'tracks' });
			expect(machine.currentState.status).toBe('searching');

			const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
			machine.cancelCurrentSearch();

			expect(abortSpy).toHaveBeenCalled();
			expect(machine.currentState.status).toBe('idle');
			abortSpy.mockRestore();
		});

		it('should do nothing when not in searching state', () => {
			// Idle state
			machine.cancelCurrentSearch();
			expect(machine.currentState.status).toBe('idle');

			// Results state
			machine.transition({ type: 'SEARCH', query: 'test', tab: 'tracks' });
			machine.transition({ type: 'RESULTS', results: mockSearchResults });
			machine.cancelCurrentSearch();
			expect(machine.currentState.status).toBe('results');
		});
	});

	describe('Subscription System', () => {
		it('should notify subscribers of state changes', () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();

			const unsubscribe1 = machine.subscribe(listener1);
			const unsubscribe2 = machine.subscribe(listener2);

			machine.transition({ type: 'SEARCH', query: 'test', tab: 'tracks' });

			expect(listener1).toHaveBeenCalledTimes(1);
			expect(listener2).toHaveBeenCalledTimes(1);

			const call1 = listener1.mock.calls[0];
			expect(call1[0].status).toBe('searching'); // new state
			expect(call1[1].status).toBe('idle'); // previous state

			unsubscribe1();
			machine.transition({ type: 'CANCEL' });

			expect(listener1).toHaveBeenCalledTimes(1); // Should not be called again
			expect(listener2).toHaveBeenCalledTimes(2); // Should be called again
		});

		it('should return immutable state copies', () => {
			machine.transition({ type: 'SEARCH', query: 'test', tab: 'tracks' });
			const state1 = machine.currentState;
			const state2 = machine.currentState;

			expect(state1).toEqual(state2);
			expect(state1).not.toBe(state2); // Different objects
		});
	});

	describe('Edge Cases and Error Handling', () => {
		it('should handle unknown state gracefully', () => {
			// Simulate unknown state (this shouldn't happen in practice)
			(machine as any).state = { status: 'unknown' as any };

			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const success = machine.transition({ type: 'SEARCH', query: 'test', tab: 'tracks' });

			expect(success).toBe(false);
			expect(consoleSpy).toHaveBeenCalledWith('[SearchStateMachine] Unknown state:', {
				status: 'unknown'
			});

			consoleSpy.mockRestore();
		});

		it('should handle rapid state transitions', () => {
			// Simulate a sequence of valid transitions
			expect(machine.transition({ type: 'SEARCH', query: 'query1', tab: 'tracks' })).toBe(true);
			expect(machine.currentState.status).toBe('searching');

			expect(machine.transition({ type: 'RESULTS', results: mockSearchResults })).toBe(true);
			expect(machine.currentState.status).toBe('results');

			expect(machine.transition({ type: 'SEARCH', query: 'query2', tab: 'albums' })).toBe(true);
			expect(machine.currentState.status).toBe('searching');
			expect((machine.currentState as any).query).toBe('query2');
			expect((machine.currentState as any).tab).toBe('albums');
		});

		it('should handle invalid event types gracefully', () => {
			// TypeScript would normally prevent this, but test runtime behavior
			const invalidEvent = { type: 'INVALID_EVENT' } as any;
			const success = machine.transition(invalidEvent);
			expect(success).toBe(false);
			expect(machine.currentState.status).toBe('idle');
		});

		it('should handle abort controller cancellation in search replacement', () => {
			machine.transition({ type: 'SEARCH', query: 'first query', tab: 'tracks' });
			const firstController = (machine.currentState as any).abortController;

			const abortSpy = vi.spyOn(firstController, 'abort');
			machine.transition({ type: 'SEARCH', query: 'second query', tab: 'albums' });

			expect(abortSpy).toHaveBeenCalled();
			expect((machine.currentState as any).query).toBe('second query');
			expect((machine.currentState as any).tab).toBe('albums');
			expect((machine.currentState as any).abortController).not.toBe(firstController);

			abortSpy.mockRestore();
		});
	});
});
