import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	PlaybackStateMachine,
	type PlaybackState,
	type PlaybackEvent
} from '../../../test-utils/stateMachines/PlaybackStateMachine';

// Mock track data for testing
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

const mockSonglinkTrack = {
	id: 'spotify:track:3RiPr603aXAoi4GHyXx0uy',
	title: 'Test Songlink Track',
	artistName: 'Test Artist',
	duration: 180,
	thumbnailUrl: 'https://example.com/thumbnail.jpg',
	sourceUrl: 'https://open.spotify.com/track/3RiPr603aXAoi4GHyXx0uy',
	songlinkData: {} as any, // Mock SonglinkResponse
	isSonglinkTrack: true as const,
	audioQuality: 'LOSSLESS' as const
};

describe('PlaybackStateMachine', () => {
	let machine: PlaybackStateMachine;
	let stateChanges: Array<{ state: PlaybackState; previousState: PlaybackState }>;

	beforeEach(() => {
		machine = new PlaybackStateMachine();
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

		it('should return null for current track when idle', () => {
			expect(machine.getCurrentTrack()).toBeNull();
		});

		it('should indicate it can play when idle', () => {
			expect(machine.canPlay()).toBe(true);
		});

		it('should indicate it cannot pause when idle', () => {
			expect(machine.canPause()).toBe(false);
		});

		it('should not be playing when idle', () => {
			expect(machine.isPlaying()).toBe(false);
		});
	});

	describe('Idle State Transitions', () => {
		it('should transition to loading when LOAD_TRACK event is sent', () => {
			const success = machine.transition({ type: 'LOAD_TRACK', track: mockTrack });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('loading');
			expect((machine.currentState as any).track).toBe(mockTrack);
			expect(stateChanges).toHaveLength(1);
			expect(stateChanges[0].previousState.status).toBe('idle');
			expect(stateChanges[0].state.status).toBe('loading');
		});

		it('should stay idle when RESET event is sent', () => {
			const success = machine.transition({ type: 'RESET' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('idle');
			expect(stateChanges).toHaveLength(0); // No state change
		});

		it('should reject invalid transitions from idle', () => {
			const invalidEvents: PlaybackEvent[] = [
				{ type: 'PLAY' },
				{ type: 'PAUSE' },
				{ type: 'STOP' },
				{ type: 'SEEK', position: 30 },
				{ type: 'ERROR', error: new Error('test') }
			];

			for (const event of invalidEvents) {
				const success = machine.transition(event);
				expect(success).toBe(false);
				expect(machine.currentState.status).toBe('idle');
			}
		});
	});

	describe('Loading State Transitions', () => {
		beforeEach(() => {
			machine.transition({ type: 'LOAD_TRACK', track: mockTrack });
			// Clear state changes from setup
			stateChanges = [];
		});

		it('should accept PLAY event but stay in loading state', () => {
			const success = machine.transition({ type: 'PLAY' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('loading');
			expect(stateChanges).toHaveLength(0); // No state change
		});

		it('should transition to error state when ERROR event occurs', () => {
			const testError = new Error('Failed to load track');
			const success = machine.transition({ type: 'ERROR', error: testError });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('error');
			expect((machine.currentState as any).error).toBe(testError);
			expect((machine.currentState as any).canRetry).toBe(true);
			expect(stateChanges).toHaveLength(1);
		});

		it('should transition back to idle when STOP event occurs', () => {
			const success = machine.transition({ type: 'STOP' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('idle');
			expect(stateChanges).toHaveLength(1);
		});

		it('should reject invalid transitions from loading', () => {
			const invalidEvents: PlaybackEvent[] = [
				{ type: 'PAUSE' },
				{ type: 'SEEK', position: 30 },
				{ type: 'RESET' },
				{ type: 'LOAD_TRACK', track: mockTrack } // Can't load another track while loading
			];

			for (const event of invalidEvents) {
				const success = machine.transition(event);
				expect(success).toBe(false);
				expect(machine.currentState.status).toBe('loading');
			}
		});
	});

	describe('Playing State Transitions', () => {
		const playingState = {
			status: 'playing' as const,
			track: mockTrack,
			position: 45
		};

		beforeEach(() => {
			// Manually set state to playing for testing
			(machine as any).state = playingState;
			stateChanges = [];
		});

		it('should transition to paused when PAUSE event occurs', () => {
			const success = machine.transition({ type: 'PAUSE' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('paused');
			expect((machine.currentState as any).track).toBe(mockTrack);
			expect((machine.currentState as any).position).toBe(45);
			expect(stateChanges).toHaveLength(1);
		});

		it('should update position when SEEK event occurs', () => {
			const success = machine.transition({ type: 'SEEK', position: 120 });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('playing');
			expect((machine.currentState as any).position).toBe(120);
			expect(stateChanges).toHaveLength(1);
		});

		it('should transition to idle when STOP event occurs', () => {
			const success = machine.transition({ type: 'STOP' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('idle');
			expect(stateChanges).toHaveLength(1);
		});

		it('should transition to error when ERROR event occurs', () => {
			const testError = new Error('Playback failed');
			const success = machine.transition({ type: 'ERROR', error: testError });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('error');
			expect((machine.currentState as any).error).toBe(testError);
			expect(stateChanges).toHaveLength(1);
		});

		it('should reject invalid transitions from playing', () => {
			const invalidEvents: PlaybackEvent[] = [
				{ type: 'PLAY' },
				{ type: 'RESET' },
				{ type: 'LOAD_TRACK', track: mockTrack }
			];

			for (const event of invalidEvents) {
				const success = machine.transition(event);
				expect(success).toBe(false);
				expect(machine.currentState.status).toBe('playing');
			}
		});
	});

	describe('Paused State Transitions', () => {
		const pausedState = {
			status: 'paused' as const,
			track: mockTrack,
			position: 30
		};

		beforeEach(() => {
			// Manually set state to paused for testing
			(machine as any).state = pausedState;
			stateChanges = [];
		});

		it('should transition to playing when PLAY event occurs', () => {
			const success = machine.transition({ type: 'PLAY' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('playing');
			expect((machine.currentState as any).track).toBe(mockTrack);
			expect((machine.currentState as any).position).toBe(30);
			expect(stateChanges).toHaveLength(1);
		});

		it('should update position when SEEK event occurs', () => {
			const success = machine.transition({ type: 'SEEK', position: 90 });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('paused');
			expect((machine.currentState as any).position).toBe(90);
			expect(stateChanges).toHaveLength(1);
		});

		it('should transition to idle when STOP event occurs', () => {
			const success = machine.transition({ type: 'STOP' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('idle');
			expect(stateChanges).toHaveLength(1);
		});

		it('should transition to loading when LOAD_TRACK event occurs', () => {
			const success = machine.transition({ type: 'LOAD_TRACK', track: mockSonglinkTrack });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('loading');
			expect((machine.currentState as any).track).toBe(mockSonglinkTrack);
			expect(stateChanges).toHaveLength(1);
		});

		it('should reject invalid transitions from paused', () => {
			const invalidEvents: PlaybackEvent[] = [
				{ type: 'PAUSE' },
				{ type: 'RESET' },
				{ type: 'ERROR', error: new Error('test') }
			];

			for (const event of invalidEvents) {
				const success = machine.transition(event);
				expect(success).toBe(false);
				expect(machine.currentState.status).toBe('paused');
			}
		});
	});

	describe('Error State Transitions', () => {
		beforeEach(() => {
			// Set up error state
			machine.transition({ type: 'LOAD_TRACK', track: mockTrack });
			machine.transition({ type: 'ERROR', error: new Error('Test error') });
			stateChanges = [];
		});

		it('should transition to loading when LOAD_TRACK event occurs', () => {
			const success = machine.transition({ type: 'LOAD_TRACK', track: mockSonglinkTrack });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('loading');
			expect((machine.currentState as any).track).toBe(mockSonglinkTrack);
			expect(stateChanges).toHaveLength(1);
		});

		it('should transition to idle when RESET event occurs', () => {
			const success = machine.transition({ type: 'RESET' });
			expect(success).toBe(true);
			expect(machine.currentState.status).toBe('idle');
			expect(stateChanges).toHaveLength(1);
		});

		it('should reject invalid transitions from error', () => {
			const invalidEvents: PlaybackEvent[] = [
				{ type: 'PLAY' },
				{ type: 'PAUSE' },
				{ type: 'STOP' },
				{ type: 'SEEK', position: 30 },
				{ type: 'ERROR', error: new Error('another error') }
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
			expect(machine.canPlay()).toBe(true);
			expect(machine.canPause()).toBe(false);
			expect(machine.isPlaying()).toBe(false);

			// Loading state
			machine.transition({ type: 'LOAD_TRACK', track: mockTrack });
			expect(machine.canPlay()).toBe(false); // Loading, can't play again
			expect(machine.canPause()).toBe(false);
			expect(machine.isPlaying()).toBe(false);

			// Playing state (simulate)
			(machine as any).state = { status: 'playing', track: mockTrack, position: 0 };
			expect(machine.canPlay()).toBe(false);
			expect(machine.canPause()).toBe(true);
			expect(machine.isPlaying()).toBe(true);

			// Paused state (simulate)
			(machine as any).state = { status: 'paused', track: mockTrack, position: 30 };
			expect(machine.canPlay()).toBe(true);
			expect(machine.canPause()).toBe(false);
			expect(machine.isPlaying()).toBe(false);

			// Error state
			machine.transition({ type: 'LOAD_TRACK', track: mockTrack });
			machine.transition({ type: 'ERROR', error: new Error('test') });
			expect(machine.canPlay()).toBe(false);
			expect(machine.canPause()).toBe(false);
			expect(machine.isPlaying()).toBe(false);
		});

		it('should return correct current track for different states', () => {
			// Idle
			expect(machine.getCurrentTrack()).toBeNull();

			// Loading
			machine.transition({ type: 'LOAD_TRACK', track: mockTrack });
			expect(machine.getCurrentTrack()).toBe(mockTrack);

			// Playing (simulate)
			(machine as any).state = { status: 'playing', track: mockSonglinkTrack, position: 0 };
			expect(machine.getCurrentTrack()).toBe(mockSonglinkTrack);

			// Paused (simulate)
			(machine as any).state = { status: 'paused', track: mockTrack, position: 30 };
			expect(machine.getCurrentTrack()).toBe(mockTrack);

			// Error
			machine.transition({ type: 'LOAD_TRACK', track: mockTrack });
			machine.transition({ type: 'ERROR', error: new Error('test') });
			expect(machine.getCurrentTrack()).toBeNull();
		});
	});

	describe('Subscription System', () => {
		it('should notify subscribers of state changes', () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();

			const unsubscribe1 = machine.subscribe(listener1);
			const unsubscribe2 = machine.subscribe(listener2);

			machine.transition({ type: 'LOAD_TRACK', track: mockTrack });

			expect(listener1).toHaveBeenCalledTimes(1);
			expect(listener2).toHaveBeenCalledTimes(1);

			const call1 = listener1.mock.calls[0];
			expect(call1[0].status).toBe('loading'); // new state
			expect(call1[1].status).toBe('idle'); // previous state

			unsubscribe1();
			machine.transition({ type: 'STOP' });

			expect(listener1).toHaveBeenCalledTimes(1); // Should not be called again
			expect(listener2).toHaveBeenCalledTimes(2); // Should be called again
		});

		it('should return immutable state copies', () => {
			machine.transition({ type: 'LOAD_TRACK', track: mockTrack });
			const state1 = machine.currentState;
			const state2 = machine.currentState;

			expect(state1).toEqual(state2);
			expect(state1).not.toBe(state2); // Different objects
			expect((state1 as any).track).toBe((state2 as any).track); // But track reference is the same (intended)
		});
	});

	describe('Edge Cases and Error Handling', () => {
		it('should handle unknown state gracefully', () => {
			// Simulate unknown state (this shouldn't happen in practice)
			(machine as any).state = { status: 'unknown' as any };

			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const success = machine.transition({ type: 'PLAY' });

			expect(success).toBe(false);
			expect(consoleSpy).toHaveBeenCalledWith('[PlaybackStateMachine] Unknown state:', {
				status: 'unknown'
			});

			consoleSpy.mockRestore();
		});

		it('should handle rapid state transitions', () => {
			// Simulate a sequence of valid transitions
			expect(machine.transition({ type: 'LOAD_TRACK', track: mockTrack })).toBe(true);
			expect(machine.currentState.status).toBe('loading');

			expect(machine.transition({ type: 'STOP' })).toBe(true);
			expect(machine.currentState.status).toBe('idle');

			expect(machine.transition({ type: 'LOAD_TRACK', track: mockSonglinkTrack })).toBe(true);
			expect(machine.currentState.status).toBe('loading');
			expect((machine.currentState as any).track).toBe(mockSonglinkTrack);
		});

		it('should handle invalid event types gracefully', () => {
			// TypeScript would normally prevent this, but test runtime behavior
			const invalidEvent = { type: 'INVALID_EVENT' } as any;
			const success = machine.transition(invalidEvent);
			expect(success).toBe(false);
			expect(machine.currentState.status).toBe('idle');
		});
	});
});
