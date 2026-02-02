import { describe, it, expect } from 'vitest';
import {
	transition,
	createInitialState,
	deriveSideEffects,
	type PlaybackMachineState,
	type PlaybackEvent
} from './playbackMachine';
import type { Track, SonglinkTrack } from '$lib/types';

// Mock tracks
const mockTidalTrack: Track = {
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
	copyright: 'Test',
	url: 'https://example.com',
	artists: [],
	artist: { id: 1, name: 'Test Artist', type: 'MAIN', url: '', picture: '' },
	album: {
		id: 1,
		title: 'Test Album',
		numberOfTracks: 10,
		numberOfVolumes: 1,
		releaseDate: '2024-01-01',
		duration: 1800,
		cover: '',
		videoCover: null
	},
	allowStreaming: true,
	streamReady: true,
	audioQuality: 'LOSSLESS',
	audioModes: ['STEREO'],
	mediaMetadata: { tags: [] },
	peak: 0.95,
	premiumStreamingOnly: false
};

const mockSonglinkTrack: SonglinkTrack = {
	id: 'spotify:track:sl-123',
	title: 'Test Songlink Track',
	artistName: 'Test Artist',
	duration: 180,
	thumbnailUrl: 'https://example.com/image.jpg',
	sourceUrl: 'https://open.spotify.com/track/sl-123',
	songlinkData: {
		entityUniqueId: 'sl-123',
		userCountry: 'US',
		pageUrl: 'https://song.link/sl-123',
		entitiesByUniqueId: {},
		linksByPlatform: {}
	},
	isSonglinkTrack: true,
	audioQuality: 'LOSSLESS'
};

describe('playbackMachine', () => {
	describe('transition', () => {
		it('should start in idle state', () => {
			const state = createInitialState();
			expect(state.state).toBe('idle');
			expect(state.context.currentTrack).toBeNull();
			expect(state.context.streamUrl).toBeNull();
		});

		it('should transition to loading when TIDAL track loaded', () => {
			const initial = createInitialState();
			const next = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });

			expect(next.state).toBe('loading');
			expect(next.context.currentTrack).toBe(mockTidalTrack);
			expect(next.context.loadRequestId).toBe(1);
		});

		it('should transition to converting when Songlink track loaded', () => {
			const initial = createInitialState();
			const next = transition(initial, { type: 'LOAD_TRACK', track: mockSonglinkTrack });

			expect(next.state).toBe('converting');
			expect(next.context.currentTrack).toBe(mockSonglinkTrack);
			expect(next.context.loadRequestId).toBe(1);
		});

		it('should transition from converting to loading on conversion complete', () => {
			const initial = createInitialState();
			const converting = transition(initial, {
				type: 'LOAD_TRACK',
				track: mockSonglinkTrack
			});
			const next = transition(converting, {
				type: 'CONVERSION_COMPLETE',
				track: mockTidalTrack
			});

			expect(next.state).toBe('loading');
			expect(next.context.currentTrack).toBe(mockTidalTrack);
		});

		it('should transition from converting to error on conversion error', () => {
			const initial = createInitialState();
			const converting = transition(initial, {
				type: 'LOAD_TRACK',
				track: mockSonglinkTrack
			});
			const error = new Error('Conversion failed');
			const next = transition(converting, { type: 'CONVERSION_ERROR', error });

			expect(next.state).toBe('error');
			expect(next.context.error).toBe(error);
		});

		it('should transition from loading to ready on load complete', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const next = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});

			expect(next.state).toBe('ready');
			expect(next.context.streamUrl).toBe('https://example.com/stream.m4a');
			expect(next.context.quality).toBe('HIGH');
		});

		it('should autoplay after load when play requested during loading', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const requested = transition(loading, { type: 'PLAY' });
			const next = transition(requested, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});

			expect(next.state).toBe('playing');
			expect(next.context.streamUrl).toBe('https://example.com/stream.m4a');
		});

		it('should transition from loading to error on load error', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const error = new Error('Load failed');
			const next = transition(loading, { type: 'LOAD_ERROR', error });

			expect(next.state).toBe('error');
			expect(next.context.error).toBe(error);
		});

		it('should allow play to retry load from error state', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const errored = transition(loading, { type: 'LOAD_ERROR', error: new Error('Load failed') });
			const next = transition(errored, { type: 'PLAY' });

			expect(next.state).toBe('loading');
			expect(next.context.autoPlay).toBe(true);
			expect(next.context.loadRequestId).toBe(errored.context.loadRequestId + 1);
		});

		it('should transition from ready to playing on play', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const next = transition(ready, { type: 'PLAY' });

			expect(next.state).toBe('playing');
		});

		it('should transition from playing to paused on pause', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const playing = transition(ready, { type: 'PLAY' });
			const next = transition(playing, { type: 'PAUSE' });

			expect(next.state).toBe('paused');
		});

		it('should transition from paused back to playing on play', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const playing = transition(ready, { type: 'PLAY' });
			const paused = transition(playing, { type: 'PAUSE' });
			const next = transition(paused, { type: 'PLAY' });

			expect(next.state).toBe('playing');
		});

		it('should transition from playing to buffering on audio waiting', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const playing = transition(ready, { type: 'PLAY' });
			const next = transition(playing, { type: 'AUDIO_WAITING' });

			expect(next.state).toBe('buffering');
		});

		it('should transition from buffering back to playing on audio playing', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const playing = transition(ready, { type: 'PLAY' });
			const buffering = transition(playing, { type: 'AUDIO_WAITING' });
			const next = transition(buffering, { type: 'AUDIO_PLAYING' });

			expect(next.state).toBe('playing');
		});

		it('should transition to error on audio error', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const playing = transition(ready, { type: 'PLAY' });
			const next = transition(playing, { type: 'AUDIO_ERROR', error: new Event('error') });

			expect(next.state).toBe('error');
		});

		it('should transition from playing to idle on track end', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const playing = transition(ready, { type: 'PLAY' });
			const next = transition(playing, { type: 'TRACK_END' });

			expect(next.state).toBe('idle');
			expect(next.context.currentTime).toBe(0);
		});

		it('should reload track when quality changes', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const loadRequestId = ready.context.loadRequestId;
			const next = transition(ready, { type: 'CHANGE_QUALITY', quality: 'LOSSLESS' });

			expect(next.state).toBe('loading');
			expect(next.context.quality).toBe('LOSSLESS');
			expect(next.context.streamUrl).toBeNull();
			expect(next.context.loadRequestId).toBe(loadRequestId + 1);
		});

		it('clears stream URL and increments loadRequestId on quality change from ready state', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const loadRequestId = ready.context.loadRequestId;
			const next = transition(ready, { type: 'CHANGE_QUALITY', quality: 'LOW' });

			expect(next.state).toBe('loading');
			expect(next.context.streamUrl).toBeNull();
			expect(next.context.loadRequestId).toBe(loadRequestId + 1);
		});

		it('should increment loadRequestId on each new load', () => {
			const initial = createInitialState();
			expect(initial.context.loadRequestId).toBe(0);

			const first = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			expect(first.context.loadRequestId).toBe(1);

			const second = transition(first, { type: 'LOAD_TRACK', track: mockTidalTrack });
			expect(second.context.loadRequestId).toBe(2);

			const third = transition(second, { type: 'LOAD_TRACK', track: mockTidalTrack });
			expect(third.context.loadRequestId).toBe(3);
		});

		it('should not allow play from idle state', () => {
			const initial = createInitialState();
			const next = transition(initial, { type: 'PLAY' });

			expect(next.state).toBe('idle'); // No transition
		});

		it('should not allow play from loading state', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const next = transition(loading, { type: 'PLAY' });

			expect(next.state).toBe('loading'); // No transition
		});

		it('stores queue state without changing playback state', () => {
			const initial = createInitialState();
			const queueTrack = { ...mockTidalTrack, id: 9001 };
			const next = transition(initial, {
				type: 'SET_QUEUE',
				queue: [queueTrack],
				queueIndex: 0
			});

			expect(next.state).toBe('idle');
			expect(next.context.queue).toHaveLength(1);
			expect(next.context.queueIndex).toBe(0);
		});

		it('should update quality without loading when idle', () => {
			const initial = createInitialState();
			const next = transition(initial, { type: 'CHANGE_QUALITY', quality: 'LOW' });

			expect(next.state).toBe('idle');
			expect(next.context.quality).toBe('LOW');
			expect(next.context.streamUrl).toBeNull();
		});

		it('should move to loading when fallback requested', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'LOSSLESS'
			});
			const playing = transition(ready, { type: 'PLAY' });
			const next = transition(playing, {
				type: 'FALLBACK_REQUESTED',
				quality: 'HIGH',
				reason: 'lossless-playback'
			});

			expect(next.state).toBe('loading');
			expect(next.context.quality).toBe('HIGH');
			expect(next.context.streamUrl).toBeNull();
			expect(next.context.autoPlay).toBe(true);
		});

		it('should ignore load completion when not loading', () => {
			const initial = createInitialState();
			const next = transition(initial, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});

			expect(next.state).toBe('idle');
			expect(next.context.streamUrl).toBeNull();
		});

		it('should update seek position in context', () => {
			const initial = createInitialState();
			const next = transition(initial, { type: 'SEEK', position: 45.5 });

			expect(next.context.currentTime).toBe(45.5);
			expect(next.state).toBe('idle'); // State doesn't change
		});
	});

	describe('deriveSideEffects', () => {
		it('should derive CONVERT_SONGLINK effect when entering converting state', () => {
			const initial = createInitialState();
			const next = transition(initial, { type: 'LOAD_TRACK', track: mockSonglinkTrack });
			const effects = deriveSideEffects(initial, next, {
				type: 'LOAD_TRACK',
				track: mockSonglinkTrack
			});

			expect(effects).toHaveLength(1);
			expect(effects[0]).toMatchObject({ type: 'CONVERT_SONGLINK', track: mockSonglinkTrack });
			expect(effects[0]).toHaveProperty('attemptId');
		});

		it('should derive SYNC_PLAYER_TRACK effect on conversion complete', () => {
			const initial = createInitialState();
			const converting = transition(initial, { type: 'LOAD_TRACK', track: mockSonglinkTrack });
			const next = transition(converting, { type: 'CONVERSION_COMPLETE', track: mockTidalTrack });
			const effects = deriveSideEffects(converting, next, {
				type: 'CONVERSION_COMPLETE',
				track: mockTidalTrack
			});

			expect(effects).toContainEqual({ type: 'SYNC_PLAYER_TRACK', track: mockTidalTrack });
		});

		it('should derive LOAD_STREAM effect when entering loading state', () => {
			const initial = createInitialState();
			const next = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const effects = deriveSideEffects(initial, next, {
				type: 'LOAD_TRACK',
				track: mockTidalTrack
			});

			expect(effects).toHaveLength(1);
			expect(effects[0]).toMatchObject({
				type: 'LOAD_STREAM',
				track: mockTidalTrack,
				quality: 'HIGH'
			});
		});

		it('should derive LOAD_STREAM effect on quality change that reloads', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const next = transition(ready, { type: 'CHANGE_QUALITY', quality: 'LOSSLESS' });
			const effects = deriveSideEffects(ready, next, {
				type: 'CHANGE_QUALITY',
				quality: 'LOSSLESS'
			});

			expect(effects).toContainEqual(
				expect.objectContaining({
					type: 'LOAD_STREAM',
					track: mockTidalTrack,
					quality: 'LOSSLESS'
				})
			);
		});

		it('should not derive LOAD_STREAM when fallback controller already loads', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'LOSSLESS'
			});
			const playing = transition(ready, { type: 'PLAY' });
			const next = transition(playing, {
				type: 'FALLBACK_REQUESTED',
				quality: 'HIGH',
				reason: 'lossless-playback'
			});
			const effects = deriveSideEffects(playing, next, {
				type: 'FALLBACK_REQUESTED',
				quality: 'HIGH',
				reason: 'lossless-playback'
			});

			expect(next.state).toBe('loading');
			expect(effects.find((effect) => effect.type === 'LOAD_STREAM')).toBeUndefined();
		});

		it('should derive SET_AUDIO_SRC effect when entering ready state', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const effects = deriveSideEffects(loading, ready, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});

			expect(effects).toContainEqual(
				expect.objectContaining({
					type: 'SET_AUDIO_SRC',
					url: 'https://example.com/stream.m4a'
				})
			);
		});

		it('should derive PLAY_AUDIO effect when entering playing state', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const playing = transition(ready, { type: 'PLAY' });
			const effects = deriveSideEffects(ready, playing, { type: 'PLAY' });

			expect(effects).toContainEqual({ type: 'PLAY_AUDIO' });
		});

		it('should derive PAUSE_AUDIO effect when entering paused state', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const playing = transition(ready, { type: 'PLAY' });
			const paused = transition(playing, { type: 'PAUSE' });
			const effects = deriveSideEffects(playing, paused, { type: 'PAUSE' });

			expect(effects).toContainEqual({ type: 'PAUSE_AUDIO' });
		});

		it('should derive SHOW_ERROR effect when entering error state', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const error = new Error('Test error');
			const errorState = transition(loading, { type: 'LOAD_ERROR', error });
			const effects = deriveSideEffects(loading, errorState, { type: 'LOAD_ERROR', error });

			expect(effects).toContainEqual({ type: 'SHOW_ERROR', error });
		});

		it('should derive SEEK_AUDIO effect on seek event', () => {
			const initial = createInitialState();
			const next = transition(initial, { type: 'SEEK', position: 45.5 });
			const effects = deriveSideEffects(initial, next, { type: 'SEEK', position: 45.5 });

			expect(effects).toContainEqual({ type: 'SEEK_AUDIO', position: 45.5 });
		});

		it('should not derive effects when state does not change', () => {
			const initial = createInitialState();
			const next = transition(initial, { type: 'PLAY' }); // Invalid transition
			const effects = deriveSideEffects(initial, next, { type: 'PLAY' });

			expect(effects).toHaveLength(0);
		});
	});

	describe('race condition prevention', () => {
		it('should handle rapid track changes with increasing request IDs', () => {
			const initial = createInitialState();

			const load1 = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			expect(load1.context.loadRequestId).toBe(1);

			const load2 = transition(load1, {
				type: 'LOAD_TRACK',
				track: { ...mockTidalTrack, id: 456 }
			});
			expect(load2.context.loadRequestId).toBe(2);

			const load3 = transition(load2, {
				type: 'LOAD_TRACK',
				track: { ...mockTidalTrack, id: 789 }
			});
			expect(load3.context.loadRequestId).toBe(3);
		});

		it('should handle rapid quality changes with increasing request IDs', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});

			const changeToLossless = transition(ready, {
				type: 'CHANGE_QUALITY',
				quality: 'LOSSLESS'
			});
			expect(changeToLossless.context.loadRequestId).toBe(2);

			const changeToHiRes = transition(changeToLossless, {
				type: 'CHANGE_QUALITY',
				quality: 'HI_RES_LOSSLESS'
			});
			expect(changeToHiRes.context.loadRequestId).toBe(3);
		});
	});

	describe('recovery state management', () => {
		/**
		 * REGRESSION TEST: UI state desync during fallback
		 *
		 * Previously, when a lossless decode error triggered a fallback:
		 * 1. AUDIO_ERROR → error state
		 * 2. FALLBACK_REQUESTED → loading state with autoPlay: true
		 * 3. syncPlayerStore sees loading + autoPlay → sets isPlaying = true
		 * 4. UI shows "playing" but audio is actually loading fallback
		 *
		 * Fix: isRecovering flag prevents showing "playing" during fallback load
		 */
		it('should set isRecovering when fallback requested', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.flac',
				quality: 'LOSSLESS'
			});
			const playing = transition(ready, { type: 'PLAY' });

			// Simulate lossless decode error followed by fallback
			const errored = transition(playing, { type: 'AUDIO_ERROR', error: new Event('error') });
			expect(errored.state).toBe('error');
			expect(errored.context.isRecovering).toBe(false);

			const fallback = transition(errored, {
				type: 'FALLBACK_REQUESTED',
				quality: 'HIGH',
				reason: 'decode error'
			});

			expect(fallback.state).toBe('loading');
			expect(fallback.context.autoPlay).toBe(true);
			expect(fallback.context.isRecovering).toBe(true);
		});

		it('should set isRecovering when retrying from error state via PLAY', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const errored = transition(loading, { type: 'LOAD_ERROR', error: new Error('Network error') });

			expect(errored.state).toBe('error');
			expect(errored.context.isRecovering).toBe(false);

			const retry = transition(errored, { type: 'PLAY' });

			expect(retry.state).toBe('loading');
			expect(retry.context.autoPlay).toBe(true);
			expect(retry.context.isRecovering).toBe(true);
		});

		it('should clear isRecovering on successful load completion', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.flac',
				quality: 'LOSSLESS'
			});
			const playing = transition(ready, { type: 'PLAY' });
			const errored = transition(playing, { type: 'AUDIO_ERROR', error: new Event('error') });
			const fallback = transition(errored, {
				type: 'FALLBACK_REQUESTED',
				quality: 'HIGH',
				reason: 'decode error'
			});

			expect(fallback.context.isRecovering).toBe(true);

			const recovered = transition(fallback, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});

			expect(recovered.state).toBe('playing'); // autoPlay was true
			expect(recovered.context.isRecovering).toBe(false);
		});

		it('should clear isRecovering on new track load', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const errored = transition(loading, { type: 'LOAD_ERROR', error: new Error('Network error') });
			const retry = transition(errored, { type: 'PLAY' });

			expect(retry.context.isRecovering).toBe(true);

			const newTrack = transition(retry, {
				type: 'LOAD_TRACK',
				track: { ...mockTidalTrack, id: 456 }
			});

			expect(newTrack.context.isRecovering).toBe(false);
		});

		it('should not set isRecovering on normal track load', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });

			expect(loading.context.isRecovering).toBe(false);
		});

		it('should clear isRecovering when entering playing state via PLAY', () => {
			const initial = createInitialState();
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTidalTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			const playing = transition(ready, { type: 'PLAY' });

			expect(playing.state).toBe('playing');
			expect(playing.context.isRecovering).toBe(false);
		});
	});
});
