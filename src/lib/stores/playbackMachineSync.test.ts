import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { createInitialState, transition } from '$lib/machines/playbackMachine';
import type { Track } from '$lib/types';
import { playerStore } from './player';
import type { SonglinkTrack } from '$lib/types';
import { syncPlayerStoreFromMachine } from './playbackMachineSync';

const mockTrack: Track = {
	id: 444,
	title: 'Consistency Track',
	duration: 180,
	version: null,
	popularity: 0,
	editable: false,
	explicit: false,
	trackNumber: 1,
	volumeNumber: 1,
	isrc: 'CONSISTENCY',
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

describe('syncPlayerStoreFromMachine', () => {
	beforeEach(() => {
		playerStore.reset();
	});

	it('syncs loading and play state from machine transitions', () => {
		playerStore.setTrack(mockTrack);
		const initial = createInitialState('LOSSLESS');
		const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTrack });
		syncPlayerStoreFromMachine(loading);

		let state = get(playerStore);
		expect(state.isLoading).toBe(true);
		expect(state.isPlaying).toBe(false);

		const loadingWithPlay = transition(loading, { type: 'PLAY' });
		syncPlayerStoreFromMachine(loadingWithPlay);
		state = get(playerStore);
		expect(state.isPlaying).toBe(true);

		const ready = transition(loadingWithPlay, {
			type: 'LOAD_COMPLETE',
			streamUrl: 'https://example.com/stream.m4a',
			quality: 'HIGH'
		});
		const playing = transition(ready, { type: 'PLAY' });
		syncPlayerStoreFromMachine(playing);
		state = get(playerStore);
		expect(state.isPlaying).toBe(true);

		const paused = transition(playing, { type: 'PAUSE' });
		syncPlayerStoreFromMachine(paused);
		state = get(playerStore);
		expect(state.isPlaying).toBe(false);
	});

	it('warns on machine/store track mismatch for non-songlink tracks', () => {
		const trackA = { ...mockTrack, id: 901, title: 'Track A' };
		const trackB = { ...mockTrack, id: 902, title: 'Track B' };

		playerStore.setTrack(trackA);
		const mismatchState = transition(createInitialState('LOSSLESS'), {
			type: 'LOAD_TRACK',
			track: trackB
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		syncPlayerStoreFromMachine(mismatchState);

		expect(warnSpy).toHaveBeenCalled();
		const warningMessages = warnSpy.mock.calls.map((call) => String(call[0]));
		expect(
			warningMessages.some((message) =>
				message.includes('Playback machine and player store track mismatch')
			)
		).toBe(true);

		warnSpy.mockRestore();
	});

	it('does not warn when one side has no current track', () => {
		const trackA = { ...mockTrack, id: 903, title: 'Track A' };
		playerStore.setTrack(trackA);

		const idleState = createInitialState('LOSSLESS');
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		syncPlayerStoreFromMachine(idleState);

		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('does not warn when either track is Songlink', () => {
		const trackA = { ...mockTrack, id: 904, title: 'Track A' };
		const songlinkTrack: SonglinkTrack = {
			id: 'spotify:track:sl-904',
			title: 'Songlink Track',
			artistName: 'Test Artist',
			duration: 180,
			thumbnailUrl: 'https://example.com/image.jpg',
			sourceUrl: 'https://open.spotify.com/track/sl-904',
			songlinkData: {
				entityUniqueId: 'sl-904',
				userCountry: 'US',
				pageUrl: 'https://song.link/sl-904',
				entitiesByUniqueId: {},
				linksByPlatform: {}
			},
			isSonglinkTrack: true,
			audioQuality: 'LOSSLESS'
		};

		playerStore.setTrack(trackA);
		const songlinkState = transition(createInitialState('LOSSLESS'), {
			type: 'LOAD_TRACK',
			track: songlinkTrack
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		syncPlayerStoreFromMachine(songlinkState);

		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	/**
	 * REGRESSION TEST: UI state desync during error recovery / fallback
	 *
	 * Bug: When lossless decode error triggered fallback:
	 * 1. Error occurred → AUDIO_ERROR → error state
	 * 2. Fallback triggered → FALLBACK_REQUESTED → loading state (autoPlay: true)
	 * 3. Sync saw loading + autoPlay → set isPlaying = true
	 * 4. UI showed "playing" but audio was actually stopped and reloading
	 *
	 * Fix: isRecovering flag prevents showing "playing" during fallback load
	 * This test ensures the fix is not regressed.
	 */
	describe('recovery state sync (regression tests)', () => {
		it('should NOT show playing during error recovery/fallback', () => {
			playerStore.setTrack(mockTrack);
			const initial = createInitialState('LOSSLESS');
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTrack });
			const ready = transition(loading, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.flac',
				quality: 'LOSSLESS'
			});
			const playing = transition(ready, { type: 'PLAY' });
			syncPlayerStoreFromMachine(playing);

			let state = get(playerStore);
			expect(state.isPlaying).toBe(true);

			// Simulate audio error
			const errored = transition(playing, { type: 'AUDIO_ERROR', error: new Event('error') });
			syncPlayerStoreFromMachine(errored);

			state = get(playerStore);
			expect(state.isPlaying).toBe(false);

			// Simulate fallback request (going back to loading with autoPlay)
			const fallback = transition(errored, {
				type: 'FALLBACK_REQUESTED',
				quality: 'HIGH',
				reason: 'decode error'
			});
			syncPlayerStoreFromMachine(fallback);

			// CRITICAL: Even though autoPlay is true and we're loading,
			// isPlaying should be false because isRecovering is true
			state = get(playerStore);
			expect(fallback.context.autoPlay).toBe(true);
			expect(fallback.context.isRecovering).toBe(true);
			expect(state.isPlaying).toBe(false); // <-- This is the key assertion
			expect(state.isLoading).toBe(true);
		});

		it('should show playing after recovery completes', () => {
			playerStore.setTrack(mockTrack);
			const initial = createInitialState('LOSSLESS');
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTrack });
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

			// Recovery/fallback load completes
			const recovered = transition(fallback, {
				type: 'LOAD_COMPLETE',
				streamUrl: 'https://example.com/stream.m4a',
				quality: 'HIGH'
			});
			syncPlayerStoreFromMachine(recovered);

			// Now we should show playing
			const state = get(playerStore);
			expect(recovered.state).toBe('playing');
			expect(recovered.context.isRecovering).toBe(false);
			expect(state.isPlaying).toBe(true);
			expect(state.isLoading).toBe(false);
		});

		it('should show playing during normal load with autoPlay (not recovery)', () => {
			playerStore.setTrack(mockTrack);
			const initial = createInitialState('LOSSLESS');
			const loading = transition(initial, { type: 'LOAD_TRACK', track: mockTrack });

			// User clicks play during loading
			const loadingWithPlay = transition(loading, { type: 'PLAY' });
			syncPlayerStoreFromMachine(loadingWithPlay);

			// Should show playing because this is NOT a recovery scenario
			const state = get(playerStore);
			expect(loadingWithPlay.context.autoPlay).toBe(true);
			expect(loadingWithPlay.context.isRecovering).toBe(false);
			expect(state.isPlaying).toBe(true);
		});
	});
});
